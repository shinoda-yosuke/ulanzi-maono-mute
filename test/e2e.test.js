// Runs the bundled main service (plugin/app.js) the way Ulanzi Studio does, against a fake host and a fake
// Maono Link IPC server — so no real app or microphone is touched.
// Set PLUGIN_NODE to run it with another Node.js, e.g. the one bundled with Ulanzi Studio:
//   PLUGIN_NODE="/Applications/Ulanzi Studio.app/Contents/MacOS/NodeJS/node" npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { PLUGIN_DIR } from '../scripts/lib/paths.mjs';
import { ACTION_UUID, PLUGIN_UUID, STATES, UNAVAILABLE_ICON } from '../src/plugin.js';
import { startFakeHost } from './fake-host.js';

const node = process.env.PLUGIN_NODE || process.execPath;
const maonoLinkServer = fileURLToPath(new URL('./fixtures/maono-link-server.mjs', import.meta.url));

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
  let host;
  let link;
  let plugin;
  let output = '';

  before(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'maono-mute-e2e-'));
    const socketPath = path.join(dir, 'PD200XWIPCSERVER');
    link = await startMaonoLinkProcess(socketPath);
    host = await startFakeHost();
    plugin = spawn(
      node,
      [path.join(PLUGIN_DIR, 'plugin', 'app.js'), '127.0.0.1', String(host.port), 'ja-JP', '3.3.9'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MAONO_LINK_SOCKET: socketPath } },
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
    assert.equal(code, 0, output);
  });
});
