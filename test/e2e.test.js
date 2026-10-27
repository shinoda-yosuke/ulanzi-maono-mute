// Runs the bundled main service (plugin/app.js) the way Ulanzi Studio does, against a fake host, a fake
// Maono Link IPC server and a fake HID helper — so no real app or microphone is touched.
// Set PLUGIN_NODE to run it with another Node.js, e.g. the one bundled with Ulanzi Studio:
//   PLUGIN_NODE="/Applications/Ulanzi Studio.app/Contents/MacOS/NodeJS/node" npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { PLUGIN_DIR } from '../scripts/lib/paths.mjs';
import { ACTION_UUID, PLUGIN_UUID, STATES, UNAVAILABLE_ICON } from '../src/plugin.js';
import { startFakeHost } from './fake-host.js';

const node = process.env.PLUGIN_NODE || process.execPath;
const fakeHelperScript = fileURLToPath(new URL('./fixtures/fake-helper.js', import.meta.url));
const maonoLinkServer = fileURLToPath(new URL('./fixtures/maono-link-server.mjs', import.meta.url));

/** Writes an executable wrapper that runs the fake helper with this Node.js, so it needs no node on PATH. */
function writeFakeHelper(dir) {
  const wrapper = path.join(dir, 'fake-helper');
  writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeHelperScript)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  return wrapper;
}

/**
 * Runs the fake Maono Link as its own process (not the test process, which is the plugin's parent), waits until
 * it is listening, and returns a handle to drive and stop it.
 */
async function startMaonoLinkProcess(socketPath) {
  const server = spawn(node, [maonoLinkServer, socketPath], { stdio: ['pipe', 'pipe', 'inherit'] });
  // Capture the exit once: a process killed by a signal keeps exitCode null, so we cannot test that later
  const exited = once(server, 'exit');
  await once(server.stdout, 'data'); // "ready"
  return {
    setMuted: (muted) => server.stdin.write(`mute ${muted ? 1 : 0}\n`),
    stop: async () => {
      server.kill(); // a no-op if it already exited
      await exited;
    },
  };
}

const key = { uuid: ACTION_UUID, key: '0_0', actionid: 'e2e' };

/** The icon the plugin last set on the test key, as { type, state } or { type, path }. */
const icon = (message) => {
  if (message.cmd !== 'state') return undefined;
  const [entry] = message.param.statelist;
  return entry.key === key.key ? entry : undefined;
};

describe('plugin/app.js against a fake Ulanzi Studio', () => {
  let dir;
  let devicesFile;
  let host;
  let link;
  let plugin;
  let output = '';

  const setDevices = (devices) => writeFileSync(devicesFile, JSON.stringify(devices));
  const readDevices = () => JSON.parse(readFileSync(devicesFile, 'utf8'));

  before(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'maono-mute-e2e-'));
    devicesFile = path.join(dir, 'devices.json');
    setDevices([{ name: 'Maono Wireless Mic RX', controllable: true, muted: false }]);
    const socketPath = path.join(dir, 'PD200XWIPCSERVER');
    link = await startMaonoLinkProcess(socketPath);
    host = await startFakeHost();
    plugin = spawn(
      node,
      [path.join(PLUGIN_DIR, 'plugin', 'app.js'), '127.0.0.1', String(host.port), 'ja-JP', '3.3.9'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MAONO_MUTE_HELPER: writeFakeHelper(dir), FAKE_HELPER_STATE: devicesFile, MAONO_LINK_SOCKET: socketPath },
      },
    );
    plugin.stdout.on('data', (chunk) => (output += chunk));
    plugin.stderr.on('data', (chunk) => (output += chunk));
  });

  after(async () => {
    if (plugin.exitCode === null) plugin.kill();
    await host.close();
    await link.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('connects as the main service', async () => {
    const message = await host.waitFor((m) => m.cmd === 'connected');
    assert.equal(message.uuid, PLUGIN_UUID);
  });

  it('shows the Maono Link mute on a new key', async () => {
    const from = host.received.length;
    host.send({ cmd: 'add', ...key, param: {} });
    const message = await host.waitFor((m) => icon(m)?.type === 0, { from });
    assert.equal(icon(message).state, STATES.live);
  });

  it('mutes through Maono Link when the key runs', async () => {
    const from = host.received.length;
    host.send({ cmd: 'run', ...key, param: {} });
    // The muted icon means Maono Link acknowledged the mute and reported it back
    await host.waitFor((m) => icon(m)?.state === STATES.muted, { from });
  });

  it('follows a mute change made in Maono Link', async () => {
    const from = host.received.length;
    link.setMuted(false);
    await host.waitFor((m) => icon(m)?.state === STATES.live, { from });
  });

  it('reports both methods to the property inspector', async () => {
    const from = host.received.length;
    host.send({ cmd: 'sendToPlugin', ...key, payload: { type: 'inspect' } });
    // The report is resent as methods come up; wait until both are available (the HID helper starts a touch later)
    const reply = await host.waitFor(
      (m) => m.cmd === 'sendToPropertyInspector' && m.payload.methods?.every((method) => method.available),
      { from },
    );
    assert.equal(reply.payload.type, 'status');
    assert.deepEqual(reply.payload.methods.map((method) => method.name), ['maono-link', 'hid']);
  });

  it('falls back to the HID helper when Maono Link goes away', async () => {
    await link.stop();
    // Give the plugin a moment to notice the Maono Link socket closed
    await delay(200);
    // The key reflects HID now; the microphone is unmuted there
    const from = host.received.length;
    host.send({ cmd: 'run', ...key, param: {} });
    await host.waitFor((m) => icon(m)?.state === STATES.muted, { from });
    assert.equal(readDevices()[0].muted, true, 'muted over HID');
  });

  it('shows the unavailable icon when neither method can act', async () => {
    const from = host.received.length;
    setDevices([{ name: 'Maono Wireless Mic RX', controllable: false, muted: null }]);
    const message = await host.waitFor((m) => icon(m)?.type === 2, { from });
    assert.equal(icon(message).path, UNAVAILABLE_ICON);
  });

  it('exits when the connection to Ulanzi Studio closes', async () => {
    const exited = once(plugin, 'exit');
    await host.close();
    const [code] = await exited;
    assert.equal(code, 0, output);
  });
});
