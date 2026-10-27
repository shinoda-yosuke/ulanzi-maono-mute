import { EventEmitter } from 'node:events';

/**
 * A mute method, as the plugin uses it. Both Maono Link (IPC) and HID expose this shape so the plugin can
 * try them in a key's preferred order.
 *
 * @typedef {object} Method
 * @property {string} name "maono-link" or "hid"
 * @property {boolean} available whether it can act right now
 * @property {boolean} pending true until it first reports, so a key keeps its default icon instead of flashing
 * @property {() => void} start
 * @property {() => void} stop
 * @property {(pos: number) => boolean | null} isMuted null when unknown
 * @property {(pos: number, muted: boolean) => Promise<boolean>} setMute resolves to the resulting mute; rejects on failure
 * @property {(event: 'change', listener: () => void) => void} on
 * @property {() => Array<{ pos: number, name: string }>} [devices] device positions to offer (Maono Link only)
 */

// A method is "pending" until it first reports or this long passes, whichever comes first.
const SETTLE_MS = 2000;

/**
 * Adapts a {@link import('./maono-link.js').MaonoLink} to the Method interface.
 * @param {import('./maono-link.js').MaonoLink} link
 * @returns {Method}
 */
export function maonoLinkMethod(link) {
  const emitter = new EventEmitter();
  let pending = true;
  let settleTimer = null;

  const settled = () => {
    if (!pending) return;
    pending = false;
    clearTimeout(settleTimer);
  };

  link.on('change', () => {
    settled();
    emitter.emit('change');
  });

  return {
    name: 'maono-link',
    get available() {
      return link.state.available;
    },
    get pending() {
      return pending;
    },
    start() {
      if (settleTimer === null && pending) settleTimer = setTimeout(settled, SETTLE_MS).unref?.() ?? settleTimer;
      link.start();
    },
    stop() {
      link.stop();
    },
    isMuted(pos) {
      return link.isMuted(pos);
    },
    setMute(pos, muted) {
      return link.setMute(pos, muted);
    },
    devices() {
      // Maono Link reports a current position; offer at least that one, named for the UI
      const positions = [...link.state.muted.keys()];
      if (link.state.currentPos !== null && !positions.includes(link.state.currentPos)) {
        positions.unshift(link.state.currentPos);
      }
      if (positions.length === 0 && link.state.available) positions.push(0);
      return positions.sort((a, b) => a - b).map((pos) => ({ pos, name: `Maono #${pos + 1}` }));
    },
    on: (event, listener) => emitter.on(event, listener),
  };
}

/**
 * Adapts a {@link import('./hid.js').HidMute} to the Method interface.
 * @param {import('./hid.js').HidMute} hid
 * @returns {Method}
 */
export function hidMethod(hid) {
  const emitter = new EventEmitter();
  let pending = true;
  let settleTimer = null;

  const settled = () => {
    if (!pending) return;
    pending = false;
    clearTimeout(settleTimer);
  };

  hid.on('change', () => {
    settled();
    emitter.emit('change');
  });

  return {
    name: 'hid',
    get available() {
      return hid.available;
    },
    get pending() {
      return pending;
    },
    start() {
      if (settleTimer === null && pending) settleTimer = setTimeout(settled, SETTLE_MS).unref?.() ?? settleTimer;
      hid.start();
    },
    stop() {
      hid.stop();
    },
    isMuted(pos) {
      return hid.isMuted(pos);
    },
    setMute(pos, muted) {
      return hid.setMute(pos, muted);
    },
    on: (event, listener) => emitter.on(event, listener),
  };
}
