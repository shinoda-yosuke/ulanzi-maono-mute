import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { accessSync, chmodSync, constants } from 'node:fs';

/**
 * @typedef {object} HidDevice
 * @property {string} name
 * @property {boolean} controllable false while Maono Link holds the microphone exclusively
 * @property {boolean | null} muted as last set over HID, or null if never set
 */

export class HidError extends Error {
  /** @param {string} code "no-device" | "busy" | "failed" | "bad-request" | "not-running" | "timeout" */
  constructor(message, code) {
    super(message);
    this.name = 'HidError';
    this.code = code;
  }
}

/** Delays before restarting a helper that stopped, in ms; the last one repeats. */
const RESTART_DELAYS = [1000, 2000, 5000, 15000, 30000];
/** A helper that ran this long counts as healthy again, so its next restart is quick. */
const HEALTHY_RUN = 60_000;

/**
 * Runs micmute-helper (native/micmute-helper.swift) and mutes a Maono microphone over HID through it.
 * Emits "change" whenever the devices it reports change. A helper that stops is restarted after a delay.
 *
 * The plugin addresses "pos" (a Maono Link device position), but the helper targets the single Maono HID
 * microphone, so pos is currently ignored here.
 */
export class HidMute extends EventEmitter {
  /** @type {HidDevice[]} */
  devices = [];

  #command;
  #log;
  #spawn;
  #restartDelays;
  #requestTimeout;
  /** @type {import('node:child_process').ChildProcess | null} */
  #child = null;
  #pending = new Map();
  #nextId = 1;
  #failures = 0;
  #restartTimer = null;
  #stopped = true;

  /**
   * @param {object} options
   * @param {string} options.command path of the helper executable
   * @param {(message: string, level: 'info' | 'warn' | 'error') => void} options.log
   * @param {typeof spawn} [options.spawnProcess] replaced in tests
   * @param {number[]} [options.restartDelays]
   * @param {number} [options.requestTimeout] ms
   */
  constructor({ command, log, spawnProcess = spawn, restartDelays = RESTART_DELAYS, requestTimeout = 5000 }) {
    super();
    this.#command = command;
    this.#log = log;
    this.#spawn = spawnProcess;
    this.#restartDelays = restartDelays;
    this.#requestTimeout = requestTimeout;
  }

  /** Whether a Maono microphone is present and can be driven over HID right now. */
  get available() {
    return this.devices.some((device) => device.controllable);
  }

  /** The mute the microphone was last set to over HID, or null if unknown. pos is ignored (single device). */
  isMuted() {
    return this.devices[0]?.muted ?? null;
  }

  start() {
    if (this.#child || this.#restartTimer) return;
    this.#stopped = false;
    this.#launch();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
    const child = this.#child;
    this.#child = null;
    child?.kill();
    this.#rejectPending('not-running', 'The helper was stopped');
    this.#setDevices([]);
  }

  /**
   * Mutes or unmutes the Maono microphone over HID.
   * @param {number} _pos ignored; the helper targets the single Maono microphone
   * @param {boolean} muted
   * @returns {Promise<boolean>}
   */
  async setMute(_pos, muted) {
    const reply = await this.#request({ cmd: 'setMute', muted });
    return reply.muted;
  }

  #request(command) {
    const child = this.#child;
    if (!child) return Promise.reject(new HidError(`Cannot send ${command.cmd}: the helper is not running`, 'not-running'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new HidError(`No answer to ${command.cmd} within ${this.#requestTimeout} ms`, 'timeout'));
      }, this.#requestTimeout);
      this.#pending.set(id, { command, resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  #launch() {
    this.#ensureExecutable();
    const startedAt = Date.now();
    const child = this.#spawn(this.#command, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.#child = child;

    let gone = false;
    const onGone = (reason) => {
      if (gone || this.#child !== child) return;
      gone = true;
      this.#child = null;
      this.#rejectPending('not-running', `The helper stopped: ${reason}`);
      this.#setDevices([]);
      if (this.#stopped) return;
      this.#failures = Date.now() - startedAt >= HEALTHY_RUN ? 1 : this.#failures + 1;
      const delay = this.#restartDelays[Math.min(this.#failures, this.#restartDelays.length) - 1];
      this.#log(`micmute-helper stopped (${reason}); restarting in ${delay} ms`, 'error');
      this.#restartTimer = setTimeout(() => {
        this.#restartTimer = null;
        this.#launch();
      }, delay);
    };
    child.on('error', (error) => onGone(error.message));
    child.on('close', (code, signal) => onGone(signal ? `killed by ${signal}` : `exit code ${code}`));
    child.stdin.on('error', (error) => this.#log(`Cannot write to micmute-helper: ${error.message}`, 'warn'));
    // Parse the helper's line-delimited JSON ourselves rather than with node:readline, which esbuild's bundle
    // does not wire up reliably for a child's stdout.
    this.#readLines(child.stdout, (line) => this.#receive(line));
    this.#readLines(child.stderr, (line) => this.#log(line, 'warn'));
  }

  /** Calls `onLine` for each newline-delimited line of a stream. */
  #readLines(stream, onLine) {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) onLine(line);
      }
    });
  }

  /** Unpacking a zip can drop the executable bit. A missing helper is left to spawn to report. */
  #ensureExecutable() {
    try {
      accessSync(this.#command, constants.X_OK);
      return;
    } catch (error) {
      if (error.code !== 'EACCES') return;
    }
    try {
      chmodSync(this.#command, 0o755);
      this.#log(`Made ${this.#command} executable`, 'info');
    } catch (error) {
      this.#log(`Cannot make ${this.#command} executable: ${error.message}`, 'error');
    }
  }

  #receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#log(`micmute-helper sent a line that is not JSON: ${line}`, 'error');
      return;
    }
    if (message.event === 'devices') {
      this.#setDevices(message.devices);
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) {
      this.#log(`micmute-helper answered an unknown request: ${line}`, 'warn');
      return;
    }
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) {
      pending.resolve(message);
    } else {
      const status = message.status === undefined ? '' : ` (status ${message.status})`;
      pending.reject(new HidError(`${pending.command.cmd} failed: ${message.error}${status}`, message.error));
    }
  }

  #rejectPending(code, reason) {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(new HidError(reason, code));
    }
    this.#pending.clear();
  }

  #setDevices(devices) {
    const next = JSON.stringify(devices);
    if (next === JSON.stringify(this.devices)) return;
    this.devices = devices;
    this.emit('change');
  }
}
