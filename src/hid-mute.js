import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { accessSync, chmodSync, constants } from 'node:fs';

export class HidError extends Error {
  /** @param {string} code "not-found" | "ambiguous" | "busy" | "failed" | "bad-reply" | "spawn" */
  constructor(message, code) {
    super(message);
    this.name = 'HidError';
    this.code = code;
  }
}

/**
 * @typedef {object} Receiver a Maono receiver the helper found
 * @property {string} id "sn:<USB serial number>", or "loc:<USB location>" for one that reports no serial
 * @property {string} product the name it reports, e.g. "Maono Wireless Mic RX"
 * @property {string} serial its USB serial number, or "" if it reports none
 * @property {string} location the USB location (port) it is plugged into, in hex
 * @property {boolean} busy another app holds it exclusively (Maono Link does while its panel shows it)
 * @property {boolean | null} muted as last read or set; null if unknown
 */

/** One entry of the helper's "status", with only the fields the plugin relies on; null if it has no id. */
function toReceiver(entry) {
  if (typeof entry?.id !== 'string' || !entry.id) return null;
  const text = (value) => (typeof value === 'string' ? value : '');
  return {
    id: entry.id,
    product: text(entry.product),
    serial: text(entry.serial),
    location: text(entry.location),
    busy: entry.busy === true,
    muted: typeof entry.muted === 'boolean' ? entry.muted : null,
  };
}

/**
 * Drives the microphone's real mute (the one that lights its LED) over HID, without Maono Link, by running
 * the maono-hid helper once per action: it opens a receiver, wakes it, reads or writes the mute register,
 * then closes. The mute latches, so nothing is kept resident — and the device is free for Maono Link whenever
 * it wants it. Several receivers can be connected; each is addressed by its id. Emits "change" when the
 * receivers or their mutes (as last probed or set) change.
 */
export class HidMute extends EventEmitter {
  #command;
  #log;
  #run;
  #timeout;
  /** @type {Receiver[]} */
  #receivers = [];

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

  /** The receivers found by the last probe, in a stable order (by USB location). */
  get receivers() {
    return this.#receivers;
  }

  /** Lists the connected receivers and reads their mutes; updates state and emits change. */
  async probe() {
    try {
      const reply = await this.#call(['status']);
      if (!Array.isArray(reply.devices)) {
        throw new HidError(`maono-hid status has no device list: ${JSON.stringify(reply).slice(0, 200)}`, 'bad-reply');
      }
      this.#update(reply.devices.map(toReceiver).filter(Boolean));
    } catch (error) {
      this.#log(`maono-hid status failed: ${error.message}`, 'warn');
      this.#update([]);
    }
    return this.#receivers;
  }

  /**
   * Mutes or unmutes one receiver over HID.
   * @param {string} id the receiver's id
   * @param {boolean} muted
   * @returns {Promise<boolean>} the resulting mute
   */
  async setMute(id, muted) {
    const reply = await this.#call(['set', muted ? '1' : '0', id]);
    if (!reply.ok) {
      throw new HidError(`Could not set the mute of ${id} over HID: ${reply.reason ?? 'unknown'}`, reply.reason ?? 'failed');
    }
    const result = reply.muted === true;
    this.#update(this.#receivers.map((receiver) => (receiver.id === id ? { ...receiver, busy: false, muted: result } : receiver)));
    return result;
  }

  #update(receivers) {
    if (JSON.stringify(receivers) === JSON.stringify(this.#receivers)) return;
    this.#receivers = receivers;
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
