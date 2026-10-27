/* global $UD */
// Property inspector of the "Toggle Mute" action. The main service (plugin/app.js) answers "inspect" with the
// state of the Maono Link connection and the microphone's mute, and sends it again whenever it changes.

const ACTION_UUID = 'com.ulanzi.ulanzistudio.maonomute.toggle';

const wrapper = document.querySelector('.uspi-wrapper');
const statusText = document.getElementById('status');

/** The latest "status" message of the main service */
let report;

function showStatus(text, kind) {
  statusText.textContent = text;
  statusText.className = kind ? `status ${kind}` : 'status';
}

function renderStatus() {
  if (!report) return showStatus($UD.t('Loading…'));
  if (!report.available) {
    return showStatus($UD.t('The microphone is not connected, and Maono Link is not open.'), 'error');
  }
  if (report.muted === true) return showStatus($UD.t('Muted'), 'muted');
  if (report.muted === false) return showStatus($UD.t('On'), 'live');
  return showStatus($UD.t('Loading…'));
}

$UD.connect(ACTION_UUID);

$UD.onConnected(async () => {
  // Texts this script localizes need the localization loaded first
  await $UD.localizeUI();
  renderStatus();
  wrapper.classList.remove('hidden');
  $UD.sendToPlugin({ type: 'inspect' });
});

$UD.onSendToPropertyInspector(({ payload }) => {
  if (payload?.type !== 'status') return;
  report = payload;
  renderStatus();
});
