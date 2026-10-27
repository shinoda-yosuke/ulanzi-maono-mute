export const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.maonomute';
export const ACTION_UUID = `${PLUGIN_UUID}.toggle`;

/** Indexes into the action's "States" in manifest.json */
export const STATES = Object.freeze({ live: 0, muted: 1 });
/** Shown instead of a state when nothing can mute the microphone */
export const UNAVAILABLE_ICON = 'assets/icons/key-unavailable.png';

// How the two mute methods are ordered for a key. "maono-link" drives Maono Link (same as its mute button),
// "hid" talks to the microphone over USB directly. Default: prefer Maono Link, fall back to HID.
export const PRIORITIES = Object.freeze({
  'link-hid': ['maono-link', 'hid'],
  'hid-link': ['hid', 'maono-link'],
  link: ['maono-link'],
  hid: ['hid'],
});
export const DEFAULT_PRIORITY = 'link-hid';

// English texts double as localization keys (see the "Localization" section of <language>.json),
// following the SDK convention, so an untranslated language still gets readable messages.
export const MESSAGES = Object.freeze({
  'maono-link-down': 'Maono Link is not running.',
  'hid-unavailable': 'The microphone is not connected.',
  unavailable: 'No way to mute the microphone is available.',
  failed: 'Could not change the mute of the microphone.',
});

const priorityOf = (param) => (typeof param?.priority === 'string' && PRIORITIES[param.priority] ? param.priority : DEFAULT_PRIORITY);
const posOf = (param) => (Number.isInteger(param?.pos) ? param.pos : 0);

/**
 * Wires the "Toggle Mute" action to a connection with Ulanzi Studio.
 *
 * @param {object} options
 * @param {import('./vendor/plugin-common-node/libs/ulanziApi.js').default} options.api
 * @param {import('./methods.js').Method[]} options.methods mute methods, each keyed by its name
 */
export function registerMuteAction({ api, methods }) {
  const byName = new Map(methods.map((method) => [method.name, method]));
  /** Keys showing this action, keyed by context: their settings and the view they last showed. */
  const keys = new Map();
  /** Context of the property inspector that asked for a report last; only one is open at a time. */
  let inspector;

  /** The methods a key uses, in the order it prefers them. */
  const methodsFor = (key) => PRIORITIES[key.priority].map((name) => byName.get(name)).filter(Boolean);

  /** The first method that can act for this key right now, or undefined. */
  const activeMethod = (key) => methodsFor(key).find((method) => method.available);

  /** What a key shows: null (nothing new yet), "live", "muted", or "unavailable". */
  const viewOf = (key) => {
    const method = activeMethod(key);
    if (!method) return methodsFor(key).some((m) => m.pending) ? null : 'unavailable';
    const muted = method.isMuted(key.pos);
    if (muted === null) return null;
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
    const key = keys.get(context);
    const report = {
      type: 'status',
      priority: key.priority,
      pos: key.pos,
      methods: methods.map((method) => ({ name: method.name, available: method.available, muted: method.isMuted(key.pos) })),
      devices: byName.get('maono-link')?.devices?.() ?? [],
    };
    api.sendToPropertyInspector(report, context);
  };

  /** Keeps track of a key and its settings; every key needs the methods running. */
  const remember = ({ context, param }) => {
    const key = keys.get(context) ?? { priority: DEFAULT_PRIORITY, pos: 0 };
    if (param && typeof param === 'object') {
      key.priority = priorityOf(param);
      key.pos = posOf(param);
    }
    keys.set(context, key);
    for (const method of methods) method.start();
  };

  /** @returns {Promise<keyof typeof MESSAGES | null>} what went wrong, if anything */
  const toggle = async (key) => {
    const ordered = methodsFor(key);
    const method = ordered.find((m) => m.available);
    if (!method) {
      // Report the most specific reason the preferred method is out
      const preferred = ordered[0]?.name;
      if (preferred === 'maono-link') return 'maono-link-down';
      if (preferred === 'hid') return 'hid-unavailable';
      return 'unavailable';
    }
    const desired = !(method.isMuted(key.pos) ?? false);
    try {
      await method.setMute(key.pos, desired);
      return null;
    } catch (error) {
      api.logMessage(`${method.name} could not mute pos ${key.pos}: ${error.message}`, 'error');
      // Fall back to the next available method
      const fallback = ordered.find((m) => m !== method && m.available);
      if (fallback) {
        try {
          await fallback.setMute(key.pos, desired);
          return null;
        } catch (fallbackError) {
          api.logMessage(`${fallback.name} could not mute pos ${key.pos}: ${fallbackError.message}`, 'error');
        }
      }
      return 'failed';
    }
  };

  const onChange = () => {
    for (const context of keys.keys()) render(context);
    if (inspector) describeTo(inspector);
  };
  for (const method of methods) method.on('change', onChange);

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
    const problem = await toggle(keys.get(message.context));
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
