// Installs the plugin into Ulanzi Studio's plugin folder.
//   (default)    copy a packaged build (stays working after this checkout moves or is deleted)
//   --link       symlink this checkout's plugin folder instead, for development
//   --uninstall  remove the installed plugin
import { cpSync, lstatSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { buildPlugin } from './build.mjs';
import { PLUGIN_DIR, PLUGIN_NAME, ulanziPluginsDir } from './lib/paths.mjs';
import { stagePlugin } from './package.mjs';

const mode = process.argv.includes('--uninstall') ? 'uninstall' : process.argv.includes('--link') ? 'link' : 'copy';
const pluginsDir = ulanziPluginsDir();
const target = path.join(pluginsDir, PLUGIN_NAME);

/** Removes the installed plugin. A link made by --link is unlinked, never followed. */
function removeInstalled() {
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (stat.isSymbolicLink()) unlinkSync(target);
  else rmSync(target, { recursive: true, force: true });
  return true;
}

if (mode === 'uninstall') {
  console.log(removeInstalled() ? `Removed ${target}` : `Nothing installed at ${target}`);
} else {
  if (mode === 'link') await buildPlugin();
  const { staged } = mode === 'copy' ? await stagePlugin() : {};

  mkdirSync(pluginsDir, { recursive: true });
  removeInstalled();
  if (mode === 'link') {
    symlinkSync(PLUGIN_DIR, target, 'dir');
    console.log(`Linked ${target} -> ${PLUGIN_DIR}`);
  } else {
    cpSync(staged, target, { recursive: true });
    console.log(`Installed ${target}`);
  }
  console.log('Restart Ulanzi Studio if the "Maono Mic Mute" category does not show up (or still runs the old version).');
}
