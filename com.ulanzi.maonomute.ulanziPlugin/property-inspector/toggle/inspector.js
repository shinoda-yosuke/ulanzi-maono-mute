/* global $UD */
// Property inspector of the "Toggle Mute" action. Ulanzi Studio stores what is sent with sendParamFromPlugin
// and hands it to the main service (plugin/app.js) as the key's settings. The main service answers "inspect"
// with the state of each mute method, and sends it again whenever it changes.

const ACTION_UUID = 'com.ulanzi.ulanzistudio.maonomute.toggle';
const DEFAULT_PRIORITY = 'link-hid';

const wrapper = document.querySelector('.uspi-wrapper');
const prioritySelect = document.getElementById('priority');
const statusBox = document.getElementById('status');

/** @type {{ priority?: string, pos?: number }} */
let settings = {};
/** The latest "status" message of the main service */
let report;

const priority = () => settings.priority || DEFAULT_PRIORITY;
const label = (name) => (name === 'maono-link' ? $UD.t('Maono Link') : $UD.t('USB (direct)'));

function methodStatus(method) {
  if (method.name === 'maono-link' && !method.available) return { text: $UD.t('not running'), kind: 'off' };
  if (method.name === 'hid' && !method.available) return { text: $UD.t('microphone not connected'), kind: 'off' };
  if (method.muted === true) return { text: $UD.t('available') + ' · ' + $UD.t('Muted'), kind: 'ok' };
  if (method.muted === false) return { text: $UD.t('available') + ' · ' + $UD.t('On'), kind: 'ok' };
  return { text: $UD.t('available'), kind: 'ok' };
}

function renderStatus() {
  statusBox.replaceChildren();
  if (!report) {
    const row = document.createElement('div');
    row.className = 'method';
    row.textContent = $UD.t('Loading…');
    statusBox.append(row);
    return;
  }
  for (const method of report.methods) {
    const { text, kind } = methodStatus(method);
    const row = document.createElement('div');
    row.className = 'method';
    const name = document.createElement('span');
    name.className = 'label';
    name.textContent = label(method.name);
    const value = document.createElement('span');
    value.className = `value ${kind}`;
    value.textContent = text;
    row.append(name, value);
    statusBox.append(row);
  }
}

function load(message) {
  settings = message.param && typeof message.param === 'object' ? { ...message.param } : {};
  prioritySelect.value = priority();
  renderStatus();
}

$UD.connect(ACTION_UUID);

$UD.onConnected(async () => {
  // Options this script localizes need the localization loaded first
  await $UD.localizeUI();
  prioritySelect.value = priority();
  renderStatus();
  wrapper.classList.remove('hidden');
  $UD.sendToPlugin({ type: 'inspect' });
});
$UD.onAdd(load);
$UD.onParamFromApp(load);

$UD.onSendToPropertyInspector(({ payload }) => {
  if (payload?.type !== 'status') return;
  report = payload;
  renderStatus();
});

prioritySelect.addEventListener('change', () => {
  settings = { ...settings, priority: prioritySelect.value };
  $UD.sendParamFromPlugin(settings);
});
