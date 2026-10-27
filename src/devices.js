/**
 * An audio input device as reported by micmute-helper.
 * @typedef {object} Device
 * @property {string} uid CoreAudio device UID; stays the same across reconnects
 * @property {string} name
 * @property {string} manufacturer
 * @property {'usb' | 'builtin' | 'bluetooth' | 'virtual' | 'aggregate' | 'other'} transport
 * @property {boolean} isDefault whether it is the system's default input
 * @property {boolean} canMute
 * @property {boolean | null} muted null when the device cannot be muted or its mute could not be read
 */

/** Device selection that follows whichever Maono microphone is connected. */
export const AUTO = 'auto';

const isMaono = (device) => /maono/i.test(`${device.name} ${device.manufacturer}`);

// Apple's USB audio driver publishes the microphone itself. Maono Link adds "Maono AI Microphone", a virtual
// device that reports a USB transport too, so the transport cannot tell them apart.
const isUsbMicrophone = (device) => device.uid.startsWith('AppleUSBAudioEngine:');

/**
 * The device a key mutes. `selection` is a device UID, or AUTO to pick a Maono microphone that can be muted:
 * the USB microphone itself before virtual devices, then the default input.
 * @param {Device[]} devices
 * @param {string} selection
 * @returns {Device | undefined}
 */
export function findTarget(devices, selection) {
  if (selection !== AUTO) return devices.find((device) => device.uid === selection);
  const rank = (device) => (isUsbMicrophone(device) ? 0 : 2) + (device.isDefault ? 0 : 1);
  return devices
    .filter((device) => isMaono(device) && device.canMute)
    .sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * What a key shows: "live", "muted", "unavailable" (no such device, it cannot be muted, or the helper is down),
 * or null while the helper has not reported yet.
 * @param {import('./helper.js').HelperState} state
 * @param {string} selection
 * @returns {'live' | 'muted' | 'unavailable' | null}
 */
export function keyView(state, selection) {
  if (state.status === 'starting') return null;
  if (state.status !== 'ready') return 'unavailable';
  const muted = findTarget(state.devices, selection)?.muted;
  if (typeof muted !== 'boolean') return 'unavailable';
  return muted ? 'muted' : 'live';
}
