// Runs the bundled main service (plugin/app.js) the way Ulanzi Studio does, against a fake host, a fake Maono
// Link IPC server and a fake HID helper — so no real app or microphone is touched.
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
const maonoLinkServer = fileURLToPath(new URL('./fixtures/maono-link-server.mjs', import.meta.url));
// A fake HID helper that reports no device, so these scenarios exercise the Maono Link (IPC) path and never
// touch real hardware. Without this the plugin would run the real maono-hid against the actual microphone.
const fakeHid = fileURLToPath(new URL('./fixtures/fake-maono-hid.mjs', import.meta.url));

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

/** The icon a message sets on a key (the test key by default), as { type, state } or { type, path }. */
const icon = (message, target = key) => {
  if (message.cmd !== 'state') return undefined;
  const [entry] = message.param.statelist;
  return entry.key === target.key ? entry : undefined;
};

/** Starts plugin/app.js against a fake host, with the given environment on top of the test's. */
async function startPlugin(env) {
  const host = await startFakeHost();
  const plugin = spawn(
    node,
    [path.join(PLUGIN_DIR, 'plugin', 'app.js'), '127.0.0.1', String(host.port), 'ja-JP', '3.3.9'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } },
  );
  let output = '';
  plugin.stdout.on('data', (chunk) => (output += chunk));
  plugin.stderr.on('data', (chunk) => (output += chunk));
  return { host, plugin, output: () => output };
}

describe('plugin/app.js against a fake Ulanzi Studio', () => {
  let dir;
  let host;
  let link;
  let plugin;
  let output;

  before(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'maono-mute-e2e-'));
    const socketPath = path.join(dir, 'PD200XWIPCSERVER');
    link = await startMaonoLinkProcess(socketPath);
    ({ host, plugin, output } = await startPlugin({
      MAONO_LINK_SOCKET: socketPath,
      MAONO_MUTE_HELPER: fakeHid,
      FAKE_HID_STATE: '',
    }));
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

  it('shows the microphone mute on a new key', async () => {
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

  it('reports the Maono Link status to the property inspector', async () => {
    const from = host.received.length;
    host.send({ cmd: 'sendToPlugin', ...key, payload: { type: 'inspect' } });
    const reply = await host.waitFor(
      (m) => m.cmd === 'sendToPropertyInspector' && m.payload.available,
      { from },
    );
    assert.equal(reply.payload.type, 'status');
    assert.equal(reply.payload.muted, false);
  });

  it('shows the unavailable icon when Maono Link goes away', async () => {
    // The socket closing flips the key to unavailable on its own
    const from = host.received.length;
    await link.stop();
    const message = await host.waitFor((m) => icon(m)?.type === 2, { from });
    assert.equal(icon(message).path, UNAVAILABLE_ICON);
  });

  it('exits when the connection to Ulanzi Studio closes', async () => {
    const exited = once(plugin, 'exit');
    await host.close();
    const [code] = await exited;
    assert.equal(code, 0, output());
  });
});

describe('plugin/app.js with several receivers over HID', () => {
  const japanese = JSON.parse(readFileSync(path.join(PLUGIN_DIR, 'ja_JP.json'), 'utf8')).Localization;
  const keyB = { uuid: ACTION_UUID, key: '1_0', actionid: 'e2e-b' };
  const keyAuto = { uuid: ACTION_UUID, key: '2_0', actionid: 'e2e-auto' };
  let dir;
  let stateFile;
  let host;
  let plugin;
  let output;

  const receiversInFile = () =>
    JSON.parse(readFileSync(stateFile, 'utf8')).devices.map(({ id, muted }) => [id, muted]);

  before(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'maono-mute-e2e-hid-'));
    stateFile = path.join(dir, 'receivers.json');
    writeFileSync(
      stateFile,
      JSON.stringify({
        devices: [
          { id: 'sn:A', product: 'Maono Wireless Mic RX', serial: 'A', location: '01100000', muted: false },
          { id: 'sn:B', product: 'Maono Wireless Mic RX', serial: 'B', location: '01200000', muted: false },
        ],
      }),
    );
    ({ host, plugin, output } = await startPlugin({
      // No Maono Link: its socket does not exist
      MAONO_LINK_SOCKET: path.join(dir, 'PD200XWIPCSERVER'),
      MAONO_MUTE_HELPER: fakeHid,
      FAKE_HID_STATE: stateFile,
    }));
    await host.waitFor((m) => m.cmd === 'connected');
  });

  after(async () => {
    if (plugin.exitCode === null) plugin.kill();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('mutes the receiver chosen for the key, and only that one', async () => {
    let from = host.received.length;
    host.send({ cmd: 'add', ...keyB, param: { device: 'sn:B' } });
    await host.waitFor((m) => icon(m, keyB)?.state === STATES.live, { from });

    from = host.received.length;
    host.send({ cmd: 'run', ...keyB, param: { device: 'sn:B' } });
    await host.waitFor((m) => icon(m, keyB)?.state === STATES.muted, { from });
    assert.deepEqual(receiversInFile(), [['sn:A', false], ['sn:B', true]]);
  });

  it('asks to choose a microphone when the key has none and several are connected', async () => {
    let from = host.received.length;
    host.send({ cmd: 'add', ...keyAuto, param: {} });
    await host.waitFor((m) => icon(m, keyAuto)?.path === UNAVAILABLE_ICON, { from });

    from = host.received.length;
    host.send({ cmd: 'run', ...keyAuto, param: {} });
    const toast = await host.waitFor((m) => m.cmd === 'toast', { from });
    assert.equal(toast.msg, japanese[MESSAGES.choose]);
    assert.deepEqual(receiversInFile(), [['sn:A', false], ['sn:B', true]], 'no receiver touched');
  });

  it('lists the receivers to the property inspector', async () => {
    const from = host.received.length;
    host.send({ cmd: 'sendToPlugin', ...keyAuto, payload: { type: 'inspect' } });
    const reply = await host.waitFor((m) => m.cmd === 'sendToPropertyInspector', { from });
    assert.equal(reply.payload.reason, 'choose');
    assert.deepEqual(
      reply.payload.devices.map(({ id, serial }) => [id, serial]),
      [['sn:A', 'A'], ['sn:B', 'B']],
    );
  });

  it('exits when the connection to Ulanzi Studio closes', async () => {
    const exited = once(plugin, 'exit');
    await host.close();
    const [code] = await exited;
    assert.equal(code, 0, output());
  });
});
