// Main service entry. Ulanzi Studio starts it as `node plugin/app.js <address> <port> <language> <version>`.
import UlanziApi from './vendor/plugin-common-node/index.js';
import { MaonoLink } from './maono-link.js';
import { PLUGIN_UUID, registerMuteAction } from './plugin.js';

const $UD = new UlanziApi();

// The microphone mute goes through Maono Link's local IPC, so it is the real mute (the device LED lights).
const link = new MaonoLink({ log: (message, level) => $UD.logMessage(message, level) });

registerMuteAction({ api: $UD, link });

// EventEmitter throws on an "error" event nobody listens to
$UD.onError((error) => console.error(error));
// Ulanzi Studio owns this process; exit once the connection is gone
$UD.onClose(() => process.exit(0));

process.on('unhandledRejection', (error) => {
  $UD.logMessage(`Unhandled rejection: ${error?.stack ?? error}`, 'error');
});

$UD.connect(PLUGIN_UUID);
// The Node SDK leaves localization to the plugin; load <language>.json so toasts follow the host language
$UD.localizeUI();
