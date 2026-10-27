import { AUTO, findTarget, keyView } from './devices.js';

export const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.maonomute';
export const ACTION_UUID = `${PLUGIN_UUID}.toggle`;

/** Indexes into the action's "States" in manifest.json */
export const STATES = Object.freeze({ live: 0, muted: 1 });
/** Shown instead of a state when there is nothing to mute */
export const UNAVAILABLE_ICON = 'assets/icons/key-unavailable.png';

// English texts double as localization keys (see the "Localization" section of <language>.json),
// following the SDK convention, so an untranslated language still gets readable messages.
export const MESSAGES = Object.freeze({
  'no-maono': 'No Maono microphone that can be muted is connected.',
  'not-found': 'The selected microphone is not connected.',
  'not-supported': 'This microphone cannot be muted from the computer.',
  'helper-down': 'Cannot access the audio devices.',
  failed: 'Could not change the mute of the microphone.',
});

const selectionOf = (param) => (typeof param?.device === 'string' && param.device) || AUTO;

/**
 * Wires the "Toggle Mute" action to a connection with Ulanzi Studio.
 *
 * @param {object} options
 * @param {import('./vendor/plugin-common-node/libs/ulanziApi.js').default} options.api
 * @param {import('./helper.js').MuteHelper} options.helper
 */
export function registerMuteAction({ api, helper }) {
  /** Keys showing this action, keyed by context: the device they mute and the view they show. */
  const keys = new Map();
  /** Context of the property inspector that asked for devices last; only one is open at a time. */
  let inspector;

  const render = (context, { force = false } = {}) => {
    const key = keys.get(context);
    const view = keyView(helper.state, key.selection);
    // Until the helper reports, the key keeps the default image from manifest.json
    if (view === null || (view === key.view && !force)) return;
    key.view = view;
    if (view === 'unavailable') api.setPathIcon(context, UNAVAILABLE_ICON);
    else api.setStateIcon(context, STATES[view]);
  };

  const describeTo = (context) => {
    const { status, devices } = helper.state;
    const target = findTarget(devices, keys.get(context)?.selection ?? AUTO);
    api.sendToPropertyInspector({ type: 'devices', status, devices, target: target?.uid ?? null }, context);
  };

  /** Keeps track of a key and its settings; any key needs the helper. */
  const remember = ({ context, param }) => {
    const key = keys.get(context) ?? { selection: AUTO };
    if (param && typeof param === 'object') key.selection = selectionOf(param);
    keys.set(context, key);
    helper.start();
  };

  /** @returns {Promise<keyof typeof MESSAGES | null>} what went wrong, if anything */
  const toggle = async (selection) => {
    if (helper.state.status !== 'ready') return 'helper-down';
    const target = findTarget(helper.state.devices, selection);
    if (!target) return selection === AUTO ? 'no-maono' : 'not-found';
    if (!target.canMute) return 'not-supported';
    try {
      // The new state arrives as a "devices" event, which updates every key
      await helper.request({ cmd: 'toggleMute', uid: target.uid });
      return null;
    } catch (error) {
      api.logMessage(`Toggling the mute of ${target.uid} failed: ${error.message}`, 'error');
      return error.code === 'not-found' || error.code === 'not-supported' ? error.code : 'failed';
    }
  };

  helper.on('change', () => {
    for (const context of keys.keys()) render(context);
    if (inspector) describeTo(inspector);
  });

  api.onAdd((message) => {
    remember(message);
    render(message.context, { force: true });
  });

  const onSettings = (message) => {
    remember(message);
    render(message.context);
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
    const problem = await toggle(keys.get(message.context).selection);
    if (problem) {
      api.showAlert(message.context);
      api.toast(api.t(MESSAGES[problem]));
    }
  });

  api.onSendToPlugin(({ context, payload }) => {
    if (payload?.type !== 'inspect') return;
    inspector = context;
    describeTo(context);
  });
}
