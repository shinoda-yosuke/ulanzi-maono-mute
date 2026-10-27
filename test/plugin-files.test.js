// Consistency checks for the files that ship in the plugin folder.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PLUGIN_DIR, ROOT } from '../scripts/lib/paths.mjs';
import { validatePlugin } from '../scripts/lib/validate-plugin.mjs';
import { ACTION_UUID, MESSAGES, PLUGIN_UUID, STATES, UNAVAILABLE_ICON } from '../src/plugin.js';

const read = (...segments) => readFileSync(path.join(PLUGIN_DIR, ...segments), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const english = JSON.parse(read('en.json')).Localization;
const inspectorHtml = read('property-inspector', 'toggle', 'inspector.html');
const inspectorScript = read('property-inspector', 'toggle', 'inspector.js');

describe('plugin folder', () => {
  it('passes the manifest and localization checks', () => {
    assert.deepEqual(validatePlugin(PLUGIN_DIR).problems, []);
  });

  it('uses the UUIDs of the main service', () => {
    assert.equal(manifest.UUID, PLUGIN_UUID);
    assert.deepEqual(manifest.Actions.map((action) => action.UUID), [ACTION_UUID]);
    assert.match(inspectorScript, new RegExp(`'${ACTION_UUID.replaceAll('.', '\\.')}'`));
  });

  it('declares the states the main service sets, and leaves switching them to it', () => {
    const [action] = manifest.Actions;
    assert.equal(action.States.length, Object.keys(STATES).length);
    assert.deepEqual(
      Object.entries(STATES).map(([name, index]) => [name, path.basename(action.States[index].Image)]),
      [['live', 'key-live.png'], ['muted', 'key-muted.png']],
    );
    assert.equal(action.DisableAutomaticStates, true);
    assert.ok(existsSync(path.join(PLUGIN_DIR, UNAVAILABLE_ICON)), UNAVAILABLE_ICON);
  });

  it('runs on macOS only, where Maono Link runs', () => {
    assert.deepEqual(manifest.OS.map((os) => os.Platform), ['mac']);
  });

  it('keeps manifest.json and package.json versions in sync', () => {
    const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(manifest.Version, version);
  });

  it('has an English text for every message of the main service', () => {
    for (const message of Object.values(MESSAGES)) assert.ok(message in english, message);
  });

  it('has an English text for every string the property inspector localizes', () => {
    const texts = [
      ...[...inspectorHtml.matchAll(/<\w+[^>]*\sdata-localize[^>]*>([^<]*)</g)].map((match) => match[1].trim()),
      ...[...inspectorScript.matchAll(/\$UD\.t\('([^']+)'\)/g)].map((match) => match[1]),
    ].filter(Boolean);
    assert.ok(texts.length >= 6, `found only ${texts.length} texts`);
    for (const text of texts) assert.ok(text in english, text);
  });
});
