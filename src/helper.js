import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { accessSync, chmodSync, constants } from 'node:fs';
import readline from 'node:readline';

/**
 * @typedef {object} HelperState
 * @property {'stopped' | 'starting' | 'ready' | 'failed'} status
 * @property {import('./devices.js').Device[]} devices empty unless ready
 * @property {string} [error] why the helper stopped (status "failed")
 */

export class MuteHelperError extends Error {
  /**
   * @param {string} message
   * @param {string} code an error of the helper ("not-found", "not-supported", "failed", "bad-request"),
   *   "not-running" or "timeout"
   */
  constructor(message, code) {
    super(message);
    this.name = 'MuteHelperError';
    this.code = code;
  }
}

/** Delays before restarting a helper that stopped, in ms; the last one repeats. */
const RESTART_DELAYS = [1000, 2000, 5000, 15000, 30000];
/** A helper that ran this long counts as healthy again, so its next restart is quick. */
const HEALTHY_RUN = 60_000;

/**
 * Runs micmute-helper (native/micmute-helper.swift), keeps the input devices it reports and sends it commands.
 * Emits "change" with the new state whenever `state` changes. A helper that stops is restarted after a delay.
 */
export class MuteHelper extends EventEmitter {
  /** @type {HelperState} */
  state = { status: 'stopped', devices: [] };

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

  /** Starts the helper unless it is running or waiting to restart. */
  start() {
    if (this.#child || this.#restartTimer) return;
    this.#launch();
  }

  /** Stops the helper without restarting it. */
  stop() {
    clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
    const child = this.#child;
    this.#child = null;
    child?.kill();
    this.#rejectPending('not-running', 'The helper was stopped');
    this.#setState({ status: 'stopped', devices: [] });
  }

  /**
   * Sends a command to the helper and resolves with its answer; rejects with a MuteHelperError.
   * @param {{ cmd: string } & Record<string, unknown>} command
   * @returns {Promise<Record<string, unknown>>}
   */
  request(command) {
    const child = this.#child;
    if (!child || this.state.status !== 'ready') {
      return Promise.reject(new MuteHelperError(`Cannot send ${command.cmd}: the helper is not running`, 'not-running'));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new MuteHelperError(`No answer to ${command.cmd} within ${this.#requestTimeout} ms`, 'timeout'));
      }, this.#requestTimeout);
      this.#pending.set(id, { command, resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  #launch() {
    this.#ensureExecutable();
    this.#setState({ status: 'starting', devices: [] });
    const startedAt = Date.now();
    const child = this.#spawn(this.#command, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.#child = child;

    let gone = false;
    const onGone = (reason) => {
      if (gone) return;
      gone = true;
      // stop() already cleaned up
      if (this.#child !== child) return;
      this.#child = null;
      this.#rejectPending('not-running', `The helper stopped: ${reason}`);
      this.#failures = Date.now() - startedAt >= HEALTHY_RUN ? 1 : this.#failures + 1;
      const delay = this.#restartDelays[Math.min(this.#failures, this.#restartDelays.length) - 1];
      this.#log(`micmute-helper stopped (${reason}); restarting in ${delay} ms`, 'error');
      this.#setState({ status: 'failed', devices: [], error: reason });
      this.#restartTimer = setTimeout(() => {
        this.#restartTimer = null;
        this.#launch();
      }, delay);
    };
    // "error" covers a helper that could not be started (missing, not executable); "exit" may or may not follow it.
    // "close" comes after the output has been read, so no answer is lost.
    child.on('error', (error) => onGone(error.message));
    child.on('close', (code, signal) => onGone(signal ? `killed by ${signal}` : `exit code ${code}`));
    child.stdin.on('error', (error) => this.#log(`Cannot write to micmute-helper: ${error.message}`, 'warn'));
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.#receive(line));
    readline.createInterface({ input: child.stderr }).on('line', (line) => this.#log(line, 'warn'));
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
      this.#setState({ status: 'ready', devices: message.devices });
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
      const status = message.status === undefined ? '' : ` (OSStatus ${message.status})`;
      pending.reject(new MuteHelperError(`${pending.command.cmd} failed: ${message.error}${status}`, message.error));
    }
  }

  #rejectPending(code, reason) {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(new MuteHelperError(reason, code));
    }
    this.#pending.clear();
  }

  #setState(state) {
    this.state = state;
    this.emit('change', state);
  }
}
