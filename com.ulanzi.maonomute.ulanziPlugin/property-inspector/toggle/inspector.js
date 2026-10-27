/* global $UD */
// Property inspector of the "Toggle Mute" action. Ulanzi Studio stores what is sent with sendParamFromPlugin
// and hands it to the main service (plugin/app.js) as the key's settings. The main service answers "inspect"
// with the input devices and the one this key mutes, and sends them again whenever they change.

const ACTION_UUID = 'com.ulanzi.ulanzistudio.maonomute.toggle';
// Same value as AUTO in src/devices.js
const AUTO = 'auto';

const wrapper = document.querySelector('.uspi-wrapper');
const deviceSelect = document.getElementById('device');
const statusText = document.getElementById('status');

/** @type {{ device?: string, deviceName?: string }} */
let settings = {};
/** The latest "devices" message of the main service */
let report;

const selection = () => settings.device || AUTO;

function renderDevices() {
  const options = [new Option($UD.t('Automatic (Maono)'), AUTO)];
  for (const device of report?.devices ?? []) {
    const option = new Option(device.name, device.uid);
    if (!device.canMute) {
      option.text = $UD.t('{name} (cannot be muted)').replace('{name}', device.name);
      option.disabled = device.uid !== selection();
    }
    options.push(option);
  }
  // Keep a saved microphone that is unplugged right now
  if (!options.some((option) => option.value === selection())) {
    const name = settings.deviceName || selection();
    options.push(new Option($UD.t('{name} (not connected)').replace('{name}', name), selection()));
  }
  deviceSelect.replaceChildren(...options);
  deviceSelect.value = selection();
}

function showStatus(text, kind) {
  statusText.textContent = text;
  statusText.className = kind ? `status ${kind}` : 'status';
}

function renderStatus() {
  if (!report || report.status === 'starting') return showStatus($UD.t('Loading…'));
  if (report.status !== 'ready') return showStatus($UD.t('Cannot access the audio devices.'), 'error');
  const target = report.devices.find((device) => device.uid === report.target);
  if (!target) {
    return showStatus(
      selection() === AUTO
        ? $UD.t('No Maono microphone that can be muted is connected.')
        : $UD.t('The selected microphone is not connected.'),
      'error',
    );
  }
  if (!target.canMute) return showStatus($UD.t('This microphone cannot be muted from the computer.'), 'error');
  if (typeof target.muted !== 'boolean') return showStatus($UD.t('Cannot access the audio devices.'), 'error');
  if (target.muted) showStatus(`${target.name}: ${$UD.t('Muted')}`, 'muted');
  else showStatus(`${target.name}: ${$UD.t('On')}`, 'live');
}

function render() {
  renderDevices();
  renderStatus();
}

function load(message) {
  settings = message.param && typeof message.param === 'object' ? { ...message.param } : {};
  render();
}

$UD.connect(ACTION_UUID);

$UD.onConnected(async () => {
  // Texts made by this script need the localization loaded first
  await $UD.localizeUI();
  render();
  wrapper.classList.remove('hidden');
  $UD.sendToPlugin({ type: 'inspect' });
});
$UD.onAdd(load);
$UD.onParamFromApp(load);

$UD.onSendToPropertyInspector(({ payload }) => {
  if (payload?.type !== 'devices') return;
  report = payload;
  render();
});

deviceSelect.addEventListener('change', () => {
  const uid = deviceSelect.value;
  const device = report?.devices.find((candidate) => candidate.uid === uid);
  settings = uid === AUTO ? { device: AUTO } : { device: uid, deviceName: device?.name ?? settings.deviceName };
  // The main service answers with the new target once Ulanzi Studio has passed the settings on
  $UD.sendParamFromPlugin(settings);
});
