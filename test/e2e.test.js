// Runs the bundled main service (plugin/app.js) the way Ulanzi Studio does, against a fake host and a fake helper
// (test/fixtures/fake-helper.js), so no real microphone is touched.
// Set PLUGIN_NODE to run it with another Node.js, e.g. the one bundled with Ulanzi Studio:
//   PLUGIN_NODE="/Applications/Ulanzi Studio.app/Contents/MacOS/NodeJS/node" npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { PLUGIN_DIR } from '../scripts/lib/paths.mjs';
import { ACTION_UUID, MESSAGES, PLUGIN_UUID, STATES, UNAVAILABLE_ICON } from '../src/plugin.js';
import { startFakeHost } from './fake-host.js';

const node = process.env.PLUGIN_NODE || process.execPath;
const fakeHelper = fileURLToPath(new URL('./fixtures/fake-helper.js', import.meta.url));
const japanese = JSON.parse(readFileSync(path.join(PLUGIN_DIR, 'ja_JP.json'), 'utf8')).Localization;
const key = { uuid: ACTION_UUID, key: '0_0', actionid: 'e2e' };

const receiver = {
  uid: 'AppleUSBAudioEngine:Shenzhen Maono Technology Co.,Ltd.:Maono Wireless Mic RX:MCT000000001:2',
  name: 'Maono Wireless Mic RX',
  manufacturer: 'Shenzhen Maono Technology Co.,Ltd.',
  transport: 'usb',
  isDefault: true,
  canMute: true,
  muted: false,
};
const builtIn = {
  uid: 'BuiltInMicrophoneDevice',
  name: 'MacBook Pro Microphone',
  manufacturer: 'Apple Inc.',
  transport: 'builtin',
  isDefault: false,
  canMute: true,
  muted: false,
};

/** The icon the plugin last set on the test key, as { type, state } or { type, path } */
const icon = (message) => {
  if (message.cmd !== 'state') return undefined;
  const [entry] = message.param.statelist;
  return entry.key === key.key ? entry : undefined;
};

describe('plugin/app.js against a fake Ulanzi Studio', () => {
  let dir;
  let devicesFile;
  let host;
  let plugin;
  let output = '';

  const setDevices = (devices) => writeFileSync(devicesFile, JSON.stringify(devices));
  const readDevices = () => JSON.parse(readFileSync(devicesFile, 'utf8'));

  before(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'maono-mute-e2e-'));
    devicesFile = path.join(dir, 'devices.json');
    setDevices([builtIn, receiver]);
    host = await startFakeHost();
    plugin = spawn(
      node,
      [path.join(PLUGIN_DIR, 'plugin', 'app.js'), '127.0.0.1', String(host.port), 'ja-JP', '3.3.9'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MAONO_MUTE_HELPER: fakeHelper, FAKE_HELPER_STATE: devicesFile },
      },
    );
    plugin.stdout.on('data', (chunk) => (output += chunk));
    plugin.stderr.on('data', (chunk) => (output += chunk));
  });

  after(async () => {
    if (plugin.exitCode === null) plugin.kill();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('connects as the main service', async () => {
    const message = await host.waitFor((m) => m.cmd === 'connected');
    assert.equal(message.uuid, PLUGIN_UUID);
  });

  it('shows whether the Maono microphone is muted on a new key', async () => {
    const from = host.received.length;
    host.send({ cmd: 'add', ...key, param: {} });
    const message = await host.waitFor((m) => icon(m)?.type === 0, { from });
    assert.equal(icon(message).state, STATES.live);
  });

  it('mutes the microphone when the key runs', async () => {
    const from = host.received.length;
    host.send({ cmd: 'run', ...key, param: {} });
    await host.waitFor((m) => icon(m)?.state === STATES.muted, { from });
    assert.deepEqual(
      readDevices().map((device) => [device.name, device.muted]),
      [[builtIn.name, false], [receiver.name, true]],
    );
  });

  it('follows a change made by another app', async () => {
    const from = host.received.length;
    setDevices([builtIn, { ...receiver, muted: false }]);
    await host.waitFor((m) => icon(m)?.state === STATES.live, { from });
  });

  it('answers the property inspector', async () => {
    const from = host.received.length;
    host.send({ cmd: 'sendToPlugin', ...key, payload: { type: 'inspect' } });
    const reply = await host.waitFor((m) => m.cmd === 'sendToPropertyInspector', { from });
    assert.deepEqual(
      { key: reply.key, actionid: reply.actionid, payload: reply.payload },
      {
        key: key.key,
        actionid: key.actionid,
        payload: { type: 'devices', status: 'ready', devices: [builtIn, receiver], target: receiver.uid },
      },
    );
  });

  it('shows the unavailable icon and alerts in the host language when the microphone is unplugged', async () => {
    let from = host.received.length;
    setDevices([builtIn]);
    const message = await host.waitFor((m) => icon(m)?.type === 2, { from });
    assert.equal(icon(message).path, UNAVAILABLE_ICON);

    from = host.received.length;
    host.send({ cmd: 'run', ...key, param: {} });
    await host.waitFor((m) => m.cmd === 'showAlert' && m.key === key.key, { from });
    const toast = await host.waitFor((m) => m.cmd === 'toast', { from });
    assert.equal(toast.msg, japanese[MESSAGES['no-maono']]);
  });

  it('exits when the connection to Ulanzi Studio closes', async () => {
    const exited = once(plugin, 'exit');
    await host.close();
    const [code] = await exited;
    assert.equal(code, 0, output);
  });
});
