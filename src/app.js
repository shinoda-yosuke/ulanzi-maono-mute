// Main service entry. Ulanzi Studio starts it as `node plugin/app.js <address> <port> <language> <version>`.
import path from 'node:path';
import UlanziApi from './vendor/plugin-common-node/index.js';
import { HidMute } from './hid-mute.js';
import { MaonoLink } from './maono-link.js';
import { MuteController } from './mute-controller.js';
import { PLUGIN_UUID, registerMuteAction } from './plugin.js';

const $UD = new UlanziApi();
const log = (message, level) => $UD.logMessage(message, level);

// The real microphone mute, the one that lights the device LED: through Maono Link's local IPC when its
// panel shows the microphone, or straight to the receiver over HID (via the maono-hid helper) when it does not.
const link = new MaonoLink({ log });
const hid = new HidMute({
  // scripts/build.mjs builds the helper next to app.js; the tests point MAONO_MUTE_HELPER at a fake one
  command: process.env.MAONO_MUTE_HELPER || path.join(path.dirname(process.argv[1]), 'bin', 'maono-hid'),
  log,
});
const controller = new MuteController({ link, hid });

registerMuteAction({ api: $UD, controller });

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
