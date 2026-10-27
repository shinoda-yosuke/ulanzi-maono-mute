import { EventEmitter } from 'node:events';

/**
 * @typedef {object} MuteControllerState
 * @property {boolean} available whether the microphone can be muted right now
 * @property {'maono-link' | 'hid' | null} method which backend is in use
 */

/**
 * One mute interface over two backends, with the same shape the plugin expects from {@link MaonoLink}
 * (`state.available`, `isMuted`, `toggleMute`, `start`/`stop`, a "change" event).
 *
 * It prefers Maono Link's IPC when its device panel is open, and falls back to the HID helper otherwise
 * (Maono Link closed, or running without the panel). IPC is preferred because an open panel means Maono Link
 * holds the microphone, so HID could not open it anyway; with the panel closed the device is free for HID.
 * While IPC is in use the HID device is left untouched, so the two never fight over it.
 */
export class MuteController extends EventEmitter {
  /** @type {MuteControllerState} */
  state = { available: false, method: null };

  #link;
  #hid;
  #pollMs;
  #timer = null;
  #stopped = true;
  #lastKey = '';
  /** Guards against overlapping HID probes when one runs longer than the poll interval. */
  #probing = false;

  /**
   * @param {object} options
   * @param {import('./maono-link.js').MaonoLink} options.link
   * @param {import('./hid-mute.js').HidMute} options.hid
   * @param {number} [options.pollInterval] ms between HID probes while Maono Link's IPC is unavailable
   */
  constructor({ link, hid, pollInterval = 5000 }) {
    super();
    this.#link = link;
    this.#hid = hid;
    this.#pollMs = pollInterval;
    link.on('change', () => this.#sync());
    hid.on('change', () => this.#sync());
  }

  /** Starts Maono Link's IPC and the HID poll loop; keeps running until stop(). */
  start() {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#link.start();
    this.#tick();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#link.stop();
  }

  /** Last known mute of a position, or null if unknown. HID ignores pos (single device). */
  isMuted(pos) {
    if (this.state.method === 'maono-link') return this.#link.isMuted(pos);
    if (this.state.method === 'hid') return this.#hid.isMuted();
    return null;
  }

  /**
   * Toggles the mute through the active backend; resolves to the resulting mute.
   * @param {number} pos
   * @returns {Promise<boolean>}
   */
  async toggleMute(pos) {
    if (this.state.method === 'maono-link') return this.#link.toggleMute(pos);
    if (this.state.method === 'hid') {
      const muted = await this.#hid.setMute(pos, !(this.#hid.isMuted() ?? false));
      this.#sync();
      return muted;
    }
    throw new Error('No way to mute the microphone is available');
  }

  /** Re-derives availability and the active method from the backends; emits change when it moves. */
  #sync() {
    let method = null;
    if (this.#link.state.available) method = 'maono-link';
    else if (this.#hid.available) method = 'hid';

    this.state.method = method;
    this.state.available = method !== null;

    const mute =
      method === 'maono-link' ? JSON.stringify([...this.#link.state.muted]) : method === 'hid' ? String(this.#hid.isMuted()) : '';
    const key = `${this.state.available}|${method}|${mute}`;
    if (key === this.#lastKey) return;
    this.#lastKey = key;
    this.emit('change', this.state);
  }

  /** While Maono Link's IPC is down, probe the HID device so the key follows it; idle while IPC is up. */
  async #tick() {
    if (this.#stopped) return;
    if (!this.#link.state.available && !this.#probing) {
      this.#probing = true;
      try {
        await this.#hid.probe();
      } finally {
        this.#probing = false;
      }
    }
    this.#sync();
    if (this.#stopped) return;
    this.#timer = setTimeout(() => this.#tick(), this.#pollMs);
    this.#timer.unref?.();
  }
}
