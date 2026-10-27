import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PLUGIN_NAME = 'com.ulanzi.maonomute.ulanziPlugin';
export const PLUGIN_DIR = path.join(ROOT, PLUGIN_NAME);
export const DIST_DIR = path.join(ROOT, 'dist');
export const HELPER_SOURCE = path.join(ROOT, 'native', 'micmute-helper.swift');
/** Where the main service (plugin/app.js) looks for the helper */
export const HELPER_BINARY = path.join(PLUGIN_DIR, 'plugin', 'bin', 'micmute-helper');

/** True when the module at `metaUrl` is the script node was started with. */
export function isMain(metaUrl) {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
}

/**
 * Folder Ulanzi Studio loads plugins from. Set ULANZI_PLUGINS_DIR to override.
 * @param {NodeJS.Platform} [platform]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function ulanziPluginsDir(platform = process.platform, env = process.env) {
  if (env.ULANZI_PLUGINS_DIR) return env.ULANZI_PLUGINS_DIR;
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Ulanzi', 'UlanziDeck', 'Plugins');
  }
  throw new Error('This plugin supports macOS only; set ULANZI_PLUGINS_DIR to install elsewhere.');
}
