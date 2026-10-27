// Builds, validates and packages the plugin into dist/<plugin>.zip (the zip contains the plugin folder).
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildPlugin } from './build.mjs';
import { DIST_DIR, isMain, PLUGIN_DIR, PLUGIN_NAME, ROOT } from './lib/paths.mjs';
import { validatePlugin } from './lib/validate-plugin.mjs';

/** Builds the plugin and copies the files that ship to dist/<plugin>/. */
export async function stagePlugin() {
  await buildPlugin();

  const { manifest, problems } = validatePlugin(PLUGIN_DIR);
  const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (manifest.Version !== version) {
    problems.push(`manifest.json Version (${manifest.Version}) differs from package.json version (${version})`);
  }
  if (problems.length > 0) throw new Error(`The plugin is invalid:\n- ${problems.join('\n- ')}`);

  const staged = path.join(DIST_DIR, PLUGIN_NAME);
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });
  cpSync(PLUGIN_DIR, staged, { recursive: true, filter: (source) => path.basename(source) !== '.DS_Store' });
  copyFileSync(path.join(ROOT, 'LICENSE'), path.join(staged, 'LICENSE'));
  return { staged, manifest };
}

async function main() {
  const { manifest } = await stagePlugin();
  const zipName = `${PLUGIN_NAME}.zip`;
  rmSync(path.join(DIST_DIR, zipName), { force: true });

  // Windows 10+ ships bsdtar, which writes zip archives with -a
  const [command, args] =
    process.platform === 'win32'
      ? ['tar', ['-a', '-c', '-f', zipName, PLUGIN_NAME]]
      : ['zip', ['-r', '-X', '-q', zipName, PLUGIN_NAME]];
  const result = spawnSync(command, args, { cwd: DIST_DIR, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.error?.message ?? `exit code ${result.status}`})`);

  console.log(`Packaged ${manifest.Name} ${manifest.Version}: ${path.relative(ROOT, path.join(DIST_DIR, zipName))}`);
}

if (isMain(import.meta.url)) await main();
