// Main service entry. Ulanzi Studio starts it as `node plugin/app.js <address> <port> <language> <version>`.
import path from 'node:path';
import UlanziApi from './vendor/plugin-common-node/index.js';
import { MuteHelper } from './helper.js';
import { PLUGIN_UUID, registerMuteAction } from './plugin.js';

const $UD = new UlanziApi();

const helper = new MuteHelper({
  // scripts/build.mjs builds the helper next to app.js; the tests point MAONO_MUTE_HELPER at a fake one
  command: process.env.MAONO_MUTE_HELPER || path.join(path.dirname(process.argv[1]), 'bin', 'micmute-helper'),
  log: (message, level) => $UD.logMessage(message, level),
});

registerMuteAction({ api: $UD, helper });

// EventEmitter throws on an "error" event nobody listens to
$UD.onError((error) => console.error(error));
// Ulanzi Studio owns this process; exit once the connection is gone. The helper exits when its stdin closes.
$UD.onClose(() => process.exit(0));

process.on('unhandledRejection', (error) => {
  $UD.logMessage(`Unhandled rejection: ${error?.stack ?? error}`, 'error');
});

$UD.connect(PLUGIN_UUID);
// The Node SDK leaves localization to the plugin; load <language>.json so toasts follow the host language
$UD.localizeUI();
