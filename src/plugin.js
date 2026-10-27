export const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.maonomute';
export const ACTION_UUID = `${PLUGIN_UUID}.toggle`;

/** Indexes into the action's "States" in manifest.json */
export const STATES = Object.freeze({ live: 0, muted: 1 });
/** Shown instead of a state when the mute cannot be reached (microphone not connected, nor Maono Link open) */
export const UNAVAILABLE_ICON = 'assets/icons/key-unavailable.png';

// English texts double as localization keys (see the "Localization" section of <language>.json),
// following the SDK convention, so an untranslated language still gets readable messages.
export const MESSAGES = Object.freeze({
  unavailable: 'Connect your Maono microphone, or open Maono Link, so the key can mute it.',
  failed: 'Could not change the mute of the microphone.',
});

const posOf = (param) => (Number.isInteger(param?.pos) ? param.pos : 0);

/**
 * Wires the "Toggle Mute" action to a connection with Ulanzi Studio. The mute is the real microphone mute
 * (the device's LED lights): through Maono Link's IPC when its panel is open, or straight to the receiver over
 * HID otherwise. Both are presented by the one controller passed as `link`.
 *
 * @param {object} options
 * @param {import('./vendor/plugin-common-node/libs/ulanziApi.js').default} options.api
 * @param {import('./mute-controller.js').MuteController} options.link the mute controller (MaonoLink-shaped)
 */
export function registerMuteAction({ api, link }) {
  /** Keys showing this action, keyed by context: the device position they mute and the view they last showed. */
  const keys = new Map();
  /** Context of the property inspector that is open, if any. */
  let inspector;

  /** What a key shows: null (nothing new yet), "live", "muted", or "unavailable". */
  const viewOf = (key) => {
    if (!link.state.available) return 'unavailable';
    const muted = link.isMuted(key.pos);
    if (muted === null) return null; // connected, but the mute has not been read back yet
    return muted ? 'muted' : 'live';
  };

  const render = (context, { force = false } = {}) => {
    const key = keys.get(context);
    const view = viewOf(key);
    if (view === null || (view === key.view && !force)) return;
    key.view = view;
    if (view === 'unavailable') api.setPathIcon(context, UNAVAILABLE_ICON);
    else api.setStateIcon(context, STATES[view]);
  };

  const describeTo = (context) => {
    const key = keys.get(context) ?? { pos: 0 };
    api.sendToPropertyInspector(
      { type: 'status', available: link.state.available, muted: link.isMuted(key.pos), pos: key.pos },
      context,
    );
  };

  /** Keeps a key's settings and makes sure the connection to Maono Link is running. */
  const remember = ({ context, param }) => {
    const key = keys.get(context) ?? { pos: 0 };
    if (param && typeof param === 'object') key.pos = posOf(param);
    keys.set(context, key);
    link.start();
  };

  link.on('change', () => {
    for (const context of keys.keys()) render(context);
    if (inspector) describeTo(inspector);
  });

  api.onAdd((message) => {
    remember(message);
    render(message.context, { force: true });
  });

  const onSettings = (message) => {
    remember(message);
    render(message.context, { force: true });
    if (message.context === inspector) describeTo(inspector);
  };
  api.onParamFromApp(onSettings);
  api.onParamFromPlugin(onSettings);

  // Show the current state again when a key becomes active, e.g. when its page is shown again
  api.onSetActive(({ context, active }) => {
    if (active && keys.has(context)) render(context, { force: true });
  });

  api.onClear(({ param }) => {
    for (const { context } of param ?? []) {
      keys.delete(context);
      if (context === inspector) inspector = undefined;
    }
  });

  api.onRun(async (message) => {
    // run carries the saved settings too; prefer them in case an earlier event was missed
    remember(message);
    const { pos } = keys.get(message.context);
    if (!link.state.available) {
      api.showAlert(message.context);
      api.toast(api.t(MESSAGES.unavailable));
      return;
    }
    try {
      // The new state arrives as an "update"/ack, which updates every key
      await link.toggleMute(pos);
    } catch (error) {
      api.logMessage(`Toggling the mute of pos ${pos} failed: ${error.message}`, 'error');
      api.showAlert(message.context);
      api.toast(api.t(MESSAGES.failed));
    }
  });

  api.onSendToPlugin(({ context, payload }) => {
    if (payload?.type !== 'inspect') return;
    inspector = context;
    // The panel may open before any key event started the connection; make sure it is running
    link.start();
    describeTo(context);
  });
}
