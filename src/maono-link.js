import net from 'node:net';
import { EventEmitter } from 'node:events';
import { readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Maono Link's microphone mute — the one that lights the device's mute LED — is "type 5" of its local IPC
// (it maps to device register 0x207d). We send it through Maono Link's socket so the mute reaches the microphone
// exactly the way its own mute button does, LED and all. "type 8" is only a signal mute (no LED), so we avoid it.
// "pos" is the device position (0 is the active device).
const MUTE_TYPE = 5;
// Maono Link publishes a busy stream of type-9 updates (level meter); we only care about mute.

export class MaonoLinkError extends Error {
  /** @param {string} code "not-running" | "timeout" | "rejected" */
  constructor(message, code) {
    super(message);
    this.name = 'MaonoLinkError';
    this.code = code;
  }
}

/**
 * The server socket Maono Link listens on, or null when it is not running.
 * Its name is device-family specific (e.g. "PD200XWIPCSERVER"), so match the suffix rather than a fixed name.
 * MAONO_LINK_SOCKET overrides the path (used by the tests).
 * @param {string} [dir] the per-user temp dir, same for every process of the user
 */
export function findSocketPath(dir = os.tmpdir()) {
  if (process.env.MAONO_LINK_SOCKET) return process.env.MAONO_LINK_SOCKET;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.endsWith('IPCSERVER')) continue;
    const full = path.join(dir, entry);
    try {
      if (statSync(full).isSocket()) return full;
    } catch {
      // vanished between readdir and stat
    }
  }
  return null;
}

/**
 * @typedef {object} MaonoLinkState
 * @property {boolean} available whether Maono Link is reachable
 * @property {Map<number, boolean>} muted mute by device position, as last seen
 * @property {number | null} currentPos the device Maono Link shows as active
 */

/**
 * Talks to Maono Link's local IPC: reads and sets the mute of a device position, and follows changes made
 * in Maono Link or on the device. Reconnects on its own; emits "change" whenever the state changes.
 */
export class MaonoLink extends EventEmitter {
  /** @type {MaonoLinkState} */
  state = { available: false, muted: new Map(), currentPos: null };

  #connect;
  #findSocket;
  #log;
  #reconnectDelay;
  #requestTimeout;
  /** @type {net.Socket | null} */
  #socket = null;
  #buffer = '';
  #pending = new Map();
  #nextSeq = 1;
  #reconnectTimer = null;
  #stopped = true;

  /**
   * @param {object} [options]
   * @param {(message: string, level: 'info' | 'warn' | 'error') => void} [options.log]
   * @param {() => string | null} [options.findSocket] replaced in tests
   * @param {(socketPath: string) => net.Socket} [options.connect] replaced in tests
   * @param {number} [options.reconnectDelay] ms between connection attempts
   * @param {number} [options.requestTimeout] ms
   */
  constructor({
    log = () => {},
    findSocket = findSocketPath,
    connect = (socketPath) => net.createConnection(socketPath),
    reconnectDelay = 2000,
    requestTimeout = 4000,
  } = {}) {
    super();
    this.#log = log;
    this.#findSocket = findSocket;
    this.#connect = connect;
    this.#reconnectDelay = reconnectDelay;
    this.#requestTimeout = requestTimeout;
  }

  /** Starts connecting (and keeps reconnecting) until stop(). */
  start() {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#open();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#teardown('stopped');
  }

  /** Last known mute of a device position, or null if never seen. */
  isMuted(pos) {
    return this.state.muted.has(pos) ? this.state.muted.get(pos) : null;
  }

  /**
   * Sets the mute of a device position; resolves once Maono Link acknowledges.
   * @param {number} pos
   * @param {boolean} muted
   * @returns {Promise<boolean>} the mute Maono Link reports after the change
   */
  setMute(pos, muted) {
    return this.#request({ cmd: 'set', pos, type: MUTE_TYPE, value: muted ? 1 : 0 });
  }

  /** @param {number} pos @returns {Promise<boolean>} */
  toggleMute(pos) {
    return this.setMute(pos, !(this.isMuted(pos) ?? false));
  }

  /** Asks for the current mute of a position; the answer arrives as a "reply" and updates the state. */
  refresh(pos) {
    this.#socket?.write(`${JSON.stringify({ cmd: 'get', pos, type: MUTE_TYPE })}\n`);
  }

  #open() {
    const socketPath = this.#findSocket();
    if (!socketPath) {
      // Maono Link is not running; try again later
      this.#setAvailable(false);
      this.#scheduleReconnect();
      return;
    }

    const socket = this.#connect(socketPath);
    this.#socket = socket;
    socket.setEncoding('utf8');

    socket.on('connect', () => this.#log(`Connected to Maono Link at ${socketPath}`, 'info'));
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('error', (error) => this.#log(`Maono Link socket error: ${error.message}`, 'warn'));
    socket.on('close', () => {
      if (this.#socket !== socket) return;
      this.#teardown('closed');
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect() {
    if (this.#stopped || this.#reconnectTimer) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#open();
    }, this.#reconnectDelay);
  }

  #teardown(reason) {
    const socket = this.#socket;
    this.#socket = null;
    this.#buffer = '';
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
    }
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(new MaonoLinkError(`Maono Link ${reason}`, 'not-running'));
    }
    this.#pending.clear();
    this.#setAvailable(false);
  }

  #onData(chunk) {
    this.#buffer += chunk;
    let index;
    while ((index = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line) this.#onLine(line);
    }
  }

  #onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#log(`Maono Link sent a line that is not JSON: ${line.slice(0, 200)}`, 'warn');
      return;
    }
    // Any valid line means Maono Link is up and talking
    let changed = this.#setAvailable(true, { silent: true });

    if (message.event === 'scene_context') {
      if (typeof message.current_pos === 'number' && message.current_pos !== this.state.currentPos) {
        this.state.currentPos = message.current_pos;
        changed = true;
        // Maono Link does not volunteer the mute until asked; learn it so the key shows the right icon
        if (this.isMuted(message.current_pos) === null) this.refresh(message.current_pos);
      }
    }
    if ((message.event === 'update' || message.event === 'reply') && message.type === MUTE_TYPE) {
      changed = this.#recordMute(message.pos, message.value) || changed;
    }
    if (message.event === 'ack') {
      const pending = this.#pending.get(message.seq);
      if (pending) {
        this.#pending.delete(message.seq);
        clearTimeout(pending.timer);
        const muted = message.current_value === 1;
        this.#recordMute(message.pos, message.current_value);
        pending.resolve(muted);
        changed = true;
      }
    }
    if (changed) this.emit('change', this.state);
  }

  #recordMute(pos, value) {
    if (typeof pos !== 'number' || (value !== 0 && value !== 1)) return false;
    const muted = value === 1;
    if (this.state.muted.get(pos) === muted) return false;
    this.state.muted.set(pos, muted);
    return true;
  }

  #request(message) {
    const socket = this.#socket;
    if (!socket || !this.state.available) {
      return Promise.reject(new MaonoLinkError('Maono Link is not running', 'not-running'));
    }
    const seq = this.#nextSeq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(seq);
        reject(new MaonoLinkError(`Maono Link did not acknowledge within ${this.#requestTimeout} ms`, 'timeout'));
      }, this.#requestTimeout);
      this.#pending.set(seq, { resolve, reject, timer });
      socket.write(`${JSON.stringify({ ...message, seq })}\n`);
    });
  }

  #setAvailable(available, { silent = false } = {}) {
    if (this.state.available === available) return false;
    this.state.available = available;
    if (!available) {
      this.state.muted.clear();
      this.state.currentPos = null;
    }
    if (!silent) this.emit('change', this.state);
    return true;
  }
}
