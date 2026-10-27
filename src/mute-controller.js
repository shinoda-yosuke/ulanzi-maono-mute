import { EventEmitter } from 'node:events';

/**
 * @typedef {object} Target the microphone a key mutes
 * @property {string | null} [device] id of the receiver chosen for the key, or null for the only one connected
 * @property {number} [pos] the Maono Link device position, for when the mute goes through Maono Link
 */

/**
 * @typedef {'no-device' | 'choose' | 'not-found' | 'busy'} UnavailableReason why a target cannot be muted:
 * nothing to mute; several receivers but none chosen; the chosen one is not connected; Maono Link holds it
 * but its IPC cannot be used for it
 */

/**
 * @typedef {object} Route how a target can be muted right now
 * @property {'hid' | 'maono-link' | null} method null when it cannot be muted
 * @property {boolean | null} muted its mute, or null if not known (yet)
 * @property {UnavailableReason | null} reason why it cannot be muted, when method is null
 * @property {string} [device] the receiver id, when method is "hid"
 */

export class MuteUnavailableError extends Error {
  /** @param {UnavailableReason} reason */
  constructor(reason) {
    super(`The microphone cannot be muted right now (${reason})`);
    this.name = 'MuteUnavailableError';
    this.reason = reason;
  }
}

/** @param {UnavailableReason} reason @returns {Route} */
const unavailable = (reason) => ({ method: null, muted: null, reason });

/**
 * One mute interface over two backends: Maono Link's IPC, and the HID helper, which can address each of several
 * connected receivers. A key names its microphone with a {@link Target}, and {@link MuteController#route}
 * decides how to reach it:
 *
 * - A receiver HID can open is muted over HID, even while Maono Link is open: Maono Link only holds the
 *   microphone its panel shows, so a free receiver is not the one its IPC would reach.
 * - A receiver another app holds ("busy") is the one Maono Link's panel shows, so it goes through Maono Link's
 *   IPC — but only when it is the only busy receiver, so the IPC cannot reach a different microphone.
 * - With no receiver found (none connected, or a model the helper does not know), the IPC is used when it is
 *   available, as Maono Link drives other Maono models too.
 * - With no receiver chosen, the key follows the only one connected; with several, it must choose.
 */
export class MuteController extends EventEmitter {
  #link;
  #hid;
  #pollMs;
  #timer = null;
  #stopped = true;
  #lastKey = '';
  #ipcAvailable = false;
  /** Guards against overlapping HID probes when one runs longer than the poll interval. */
  #probing = false;
  /** Set when a probe is asked for while one runs: what it reads may already be out of date. */
  #probeAgain = false;

  /**
   * @param {object} options
   * @param {import('./maono-link.js').MaonoLink} options.link
   * @param {import('./hid-mute.js').HidMute} options.hid
   * @param {number} [options.pollInterval] ms between HID probes
   */
  constructor({ link, hid, pollInterval = 5000 }) {
    super();
    this.#link = link;
    this.#hid = hid;
    this.#pollMs = pollInterval;
    link.on('change', () => {
      // Maono Link opening or closing its panel takes or frees a receiver; look again now, not at the next poll
      if (link.state.available !== this.#ipcAvailable) {
        this.#ipcAvailable = link.state.available;
        if (!this.#stopped) this.#probe();
      }
      this.#sync();
    });
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

  /** The receivers HID found, in a stable order, to choose a key's microphone from. */
  get receivers() {
    return this.#hid.receivers;
  }

  /**
   * How the target's microphone can be muted right now.
   * @param {Target} target
   * @returns {Route}
   */
  route({ device = null, pos = 0 } = {}) {
    const receivers = this.#hid.receivers;
    let receiver;
    if (device) {
      receiver = receivers.find((candidate) => candidate.id === device);
      if (!receiver) return unavailable('not-found');
    } else if (receivers.length > 1) {
      return unavailable('choose');
    } else {
      [receiver] = receivers;
    }

    if (receiver && !receiver.busy) return { method: 'hid', device: receiver.id, muted: receiver.muted, reason: null };
    const ipcReachesIt = !receiver || receivers.filter((candidate) => candidate.busy).length === 1;
    if (this.#link.state.available && ipcReachesIt) {
      return { method: 'maono-link', muted: this.#link.isMuted(pos), reason: null };
    }
    return unavailable(receiver ? 'busy' : 'no-device');
  }

  /**
   * Toggles the mute of the target's microphone; resolves to the resulting mute.
   * @param {Target} target
   * @returns {Promise<boolean>}
   */
  async toggleMute(target) {
    const route = this.route(target);
    if (route.method === 'maono-link') return this.#link.toggleMute(target.pos ?? 0);
    if (route.method === 'hid') {
      try {
        return await this.#hid.setMute(route.device, !(route.muted ?? false));
      } catch (error) {
        // The receiver may have been unplugged or taken by Maono Link since the last poll; catch up now
        this.#probe();
        throw error;
      }
    }
    throw new MuteUnavailableError(route.reason);
  }

  /** Emits change when anything a route depends on moved. */
  #sync() {
    const key = JSON.stringify([this.#link.state.available, [...this.#link.state.muted], this.#hid.receivers]);
    if (key === this.#lastKey) return;
    this.#lastKey = key;
    this.emit('change');
  }

  async #probe() {
    if (this.#probing) {
      this.#probeAgain = true;
      return;
    }
    this.#probing = true;
    try {
      do {
        this.#probeAgain = false;
        await this.#hid.probe();
      } while (this.#probeAgain && !this.#stopped);
    } finally {
      this.#probing = false;
    }
  }

  /** Probes the receivers on a timer so keys follow them: plugged in, unplugged, taken by Maono Link, muted. */
  async #tick() {
    if (this.#stopped) return;
    await this.#probe();
    this.#sync();
    if (this.#stopped) return;
    this.#timer = setTimeout(() => this.#tick(), this.#pollMs);
    this.#timer.unref?.();
  }
}
