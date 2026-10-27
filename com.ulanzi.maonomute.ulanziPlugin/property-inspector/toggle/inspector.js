/* global $UD */
// Property inspector of the "Toggle Mute" action. The main service (plugin/app.js) answers "inspect" with the
// connected receivers and the state of this key's microphone, and sends it again whenever that changes.
// The microphone chosen here is saved with sendParamFromPlugin; Ulanzi Studio hands it to the main service as
// the key's settings.

const ACTION_UUID = 'com.ulanzi.ulanzistudio.maonomute.toggle';

const wrapper = document.querySelector('.uspi-wrapper');
const deviceSelect = document.getElementById('device');
const statusText = document.getElementById('status');

/** The key's saved settings */
let settings = {};
/** The latest "status" message of the main service */
let report;
/** The options the list shows, so it is rebuilt only when they change (rebuilding closes an open list) */
let shownOptions = '';

function showStatus(text, kind) {
  statusText.textContent = text;
  statusText.className = kind ? `status ${kind}` : 'status';
}

function unavailableText(reason) {
  switch (reason) {
    case 'choose':
      return $UD.t('Several Maono microphones are connected. Choose which one this key mutes.');
    case 'not-found':
      return $UD.t('The microphone chosen for this key is not connected.');
    case 'busy':
      return $UD.t('Maono Link is using the microphone. Open its microphone panel, or quit Maono Link.');
    default:
      return $UD.t('The microphone is not connected, and Maono Link is not open.');
  }
}

function renderStatus() {
  if (!report) return showStatus($UD.t('Loading…'));
  if (!report.available) return showStatus(unavailableText(report.reason), 'error');
  if (report.muted === true) return showStatus($UD.t('Muted'), 'muted');
  if (report.muted === false) return showStatus($UD.t('On'), 'live');
  return showStatus($UD.t('Loading…'));
}

/** e.g. "Maono Wireless Mic RX (MCT250728274)"; one without a serial is told apart by its USB port */
const labelOf = (device) => `${device.product || 'Maono'} (${device.serial || `USB ${device.location}`})`;

function renderDevices() {
  const chosen = typeof settings.device === 'string' ? settings.device : '';
  const devices = report?.devices ?? [];
  const options = [['', $UD.t('Automatic')], ...devices.map((device) => [device.id, labelOf(device)])];
  // Keep a chosen microphone that is not connected right now, so the choice stays visible
  if (chosen && !devices.some((device) => device.id === chosen)) {
    options.push([chosen, `${chosen.replace(/^[a-z]+:/, '')} (${$UD.t('Not connected')})`]);
  }
  const key = JSON.stringify(options);
  if (key !== shownOptions) {
    shownOptions = key;
    deviceSelect.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  }
  deviceSelect.value = chosen;
}

function load(message) {
  settings = message.param && typeof message.param === 'object' ? { ...message.param } : {};
  renderDevices();
}

$UD.connect(ACTION_UUID);

$UD.onConnected(async () => {
  // Texts this script localizes need the localization loaded first
  await $UD.localizeUI();
  renderStatus();
  renderDevices();
  wrapper.classList.remove('hidden');
  $UD.sendToPlugin({ type: 'inspect' });
});
$UD.onAdd(load);
$UD.onParamFromApp(load);

$UD.onSendToPropertyInspector(({ payload }) => {
  if (payload?.type !== 'status') return;
  report = payload;
  renderStatus();
  renderDevices();
});

deviceSelect.addEventListener('change', () => {
  settings = { ...settings, device: deviceSelect.value };
  $UD.sendParamFromPlugin(settings);
});
