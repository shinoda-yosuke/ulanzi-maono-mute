export const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.maonomute';
export const ACTION_UUID = `${PLUGIN_UUID}.toggle`;

/** Indexes into the action's "States" in manifest.json */
export const STATES = Object.freeze({ live: 0, muted: 1 });
/** Shown instead of a state when the key cannot reach the mute (e.g. microphone not connected, nor Maono Link open) */
export const UNAVAILABLE_ICON = 'assets/icons/key-unavailable.png';

// English texts double as localization keys (see the "Localization" section of <language>.json),
// following the SDK convention, so an untranslated language still gets readable messages.
export const MESSAGES = Object.freeze({
  unavailable: 'Connect your Maono microphone, or open Maono Link, so the key can mute it.',
  choose: 'Several Maono microphones are connected. Choose which one this key mutes.',
  notFound: 'The microphone chosen for this key is not connected.',
  busy: 'Maono Link is using the microphone. Open its microphone panel, or quit Maono Link.',
  failed: 'Could not change the mute of the microphone.',
});

/** What to tell the user when a key cannot mute, by the reason the controller gives. */
const UNAVAILABLE_MESSAGES = Object.freeze({
  'no-device': MESSAGES.unavailable,
  choose: MESSAGES.choose,
  'not-found': MESSAGES.notFound,
  busy: MESSAGES.busy,
});

const posOf = (param) => (Number.isInteger(param?.pos) ? param.pos : 0);
/** The receiver chosen in a key's settings, or null to follow the only one connected. */
const deviceOf = (param) => (typeof param?.device === 'string' && param.device ? param.device : null);

/**
 * Wires the "Toggle Mute" action to a connection with Ulanzi Studio. The mute is the real microphone mute
 * (the device's LED lights): through Maono Link's IPC when its panel shows the microphone, or straight to the
 * receiver over HID otherwise. Each key mutes the receiver chosen in its settings, or the only one connected.
 *
 * @param {object} options
 * @param {import('./vendor/plugin-common-node/libs/ulanziApi.js').default} options.api
 * @param {import('./mute-controller.js').MuteController} options.controller
 */
export function registerMuteAction({ api, controller }) {
  /** Keys showing this action, keyed by context: the microphone they mute (a Target) and the view they last showed. */
  const keys = new Map();
  /** Context of the property inspector that is open, if any. */
  let inspector;

  const targetOf = (context) => keys.get(context) ?? { device: null, pos: 0 };

  /** What a key shows: null (nothing new yet), "live", "muted", or "unavailable". */
  const viewOf = (key) => {
    const route = controller.route(key);
    if (!route.method) return 'unavailable';
    if (route.muted === null) return null; // reachable, but the mute has not been read back yet
    return route.muted ? 'muted' : 'live';
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
    const route = controller.route(targetOf(context));
    api.sendToPropertyInspector(
      {
        type: 'status',
        available: route.method !== null,
        muted: route.muted,
        reason: route.reason,
        devices: controller.receivers.map(({ id, product, serial, location }) => ({ id, product, serial, location })),
      },
      context,
    );
  };

  /** Keeps a key's settings and makes sure the controller is running. */
  const remember = ({ context, param }) => {
    const key = keys.get(context) ?? { device: null, pos: 0 };
    if (param && typeof param === 'object') {
      key.pos = posOf(param);
      key.device = deviceOf(param);
    }
    keys.set(context, key);
    controller.start();
  };

  controller.on('change', () => {
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
    const key = keys.get(message.context);
    const { method, reason } = controller.route(key);
    if (!method) {
      api.showAlert(message.context);
      api.toast(api.t(UNAVAILABLE_MESSAGES[reason] ?? MESSAGES.unavailable));
      return;
    }
    try {
      // The new state comes back as a change of the controller, which updates every key
      await controller.toggleMute(key);
    } catch (error) {
      api.logMessage(`Toggling the mute of ${key.device ?? 'the microphone'} (pos ${key.pos}) failed: ${error.message}`, 'error');
      api.showAlert(message.context);
      api.toast(api.t(MESSAGES.failed));
    }
  });

  api.onSendToPlugin(({ context, payload }) => {
    if (payload?.type !== 'inspect') return;
    inspector = context;
    // The panel may open before any key event started the controller; make sure it is running
    controller.start();
    describeTo(context);
  });
}
