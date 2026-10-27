import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { accessSync, chmodSync, constants } from 'node:fs';

export class HidError extends Error {
  /** @param {string} code "no-device" | "busy" | "failed" | "bad-reply" | "spawn" */
  constructor(message, code) {
    super(message);
    this.name = 'HidError';
    this.code = code;
  }
}

/**
 * Drives the microphone's real mute (the one that lights its LED) over HID, without Maono Link, by running
 * the maono-hid helper once per action: it opens the receiver, wakes it, reads or writes the mute register,
 * then closes. The mute latches, so nothing is kept resident — and the device is free for Maono Link whenever
 * it wants it. Emits "change" when availability or the mute (as last probed or set) changes.
 *
 * The plugin addresses "pos" (a Maono Link device position), but the helper targets the single Maono HID
 * microphone, so pos is ignored here.
 */
export class HidMute extends EventEmitter {
  #command;
  #log;
  #run;
  #timeout;
  #available = false;
  /** @type {boolean | null} */
  #muted = null;

  /**
   * @param {object} options
   * @param {string} options.command path of the maono-hid helper
   * @param {(message: string, level: 'info' | 'warn' | 'error') => void} [options.log]
   * @param {(args: string[]) => Promise<string>} [options.run] replaced in tests; resolves to the helper's stdout
   * @param {number} [options.requestTimeout] ms
   */
  constructor({ command, log = () => {}, run, requestTimeout = 6000 }) {
    super();
    this.#command = command;
    this.#log = log;
    this.#timeout = requestTimeout;
    this.#run = run ?? ((args) => this.#spawn(args));
  }

  /** Whether a Maono microphone is present and drivable over HID right now (false while Maono Link holds it). */
  get available() {
    return this.#available;
  }

  /** The mute the microphone was last probed or set to, or null if unknown. pos is ignored (single device). */
  isMuted() {
    return this.#muted;
  }

  /** Reads availability and the current mute from the device; updates state and emits change. */
  async probe() {
    try {
      const reply = await this.#call(['get']);
      this.#update(reply.available === true, reply.available === true ? reply.muted ?? null : null);
    } catch (error) {
      this.#log(`maono-hid get failed: ${error.message}`, 'warn');
      this.#update(false, null);
    }
    return { available: this.#available, muted: this.#muted };
  }

  /**
   * Mutes or unmutes the microphone over HID.
   * @param {number} _pos ignored; the helper targets the single Maono microphone
   * @param {boolean} muted
   * @returns {Promise<boolean>} the resulting mute
   */
  async setMute(_pos, muted) {
    const reply = await this.#call(['set', muted ? '1' : '0']);
    if (!reply.ok) throw new HidError(`Could not set the mute over HID: ${reply.reason ?? 'unknown'}`, reply.reason ?? 'failed');
    this.#update(true, reply.muted === true);
    return this.#muted;
  }

  #update(available, muted) {
    if (available === this.#available && muted === this.#muted) return;
    this.#available = available;
    this.#muted = muted;
    this.emit('change');
  }

  /** Runs the helper and parses its one JSON line. */
  async #call(args) {
    const stdout = await this.#run(args);
    const line = stdout.trim().split('\n').pop() ?? '';
    try {
      return JSON.parse(line);
    } catch {
      throw new HidError(`maono-hid did not answer with JSON: ${line.slice(0, 200)}`, 'bad-reply');
    }
  }

  #spawn(args) {
    this.#ensureExecutable();
    return new Promise((resolve, reject) => {
      execFile(this.#command, args, { timeout: this.#timeout }, (error, stdout) => {
        // The helper prints its answer (even failures) and exits 0; a real spawn error has no stdout
        if (error && !stdout) reject(new HidError(`Could not run maono-hid ${args[0]}: ${error.message}`, 'spawn'));
        else resolve(stdout ?? '');
      });
    });
  }

  /** Unpacking a zip can drop the executable bit; restore it so the helper can run. */
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
}
