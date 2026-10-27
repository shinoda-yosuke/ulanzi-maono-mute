import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { MuteHelper, MuteHelperError } from '../src/helper.js';

/** A child process whose output the test writes and whose input the test reads. */
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  requests = [];
  killed = false;

  constructor() {
    super();
    this.stdin.on('data', (chunk) => {
      for (const line of String(chunk).split('\n').filter(Boolean)) this.requests.push(JSON.parse(line));
    });
  }

  say(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill() {
    this.killed = true;
  }

  /** Ends like a process: output streams close, then "close" */
  exit(code) {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit('close', code, null));
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const device = { uid: 'mic', name: 'Mic', manufacturer: 'Maono', transport: 'usb', isDefault: true, canMute: true, muted: false };

describe('MuteHelper', () => {
  let children;
  let logs;
  let helper;

  const create = (options = {}) => {
    helper = new MuteHelper({
      command: '/nonexistent/micmute-helper',
      log: (message, level) => logs.push([level, message]),
      spawnProcess: (command, args, spawnOptions) => {
        assert.deepEqual(spawnOptions, { stdio: ['pipe', 'pipe', 'pipe'] });
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      restartDelays: [5, 10],
      requestTimeout: 50,
      ...options,
    });
    return helper;
  };

  const startReady = async () => {
    create().start();
    children[0].say({ event: 'devices', devices: [device] });
    await settle();
    return children[0];
  };

  beforeEach(() => {
    children = [];
    logs = [];
  });

  afterEach(() => helper?.stop());

  it('becomes ready with the devices the helper reports', async () => {
    const states = [];
    create().on('change', (state) => states.push(state.status));
    assert.equal(helper.state.status, 'stopped');
    helper.start();
    helper.start();
    assert.equal(children.length, 1, 'start() is idempotent');
    assert.equal(helper.state.status, 'starting');
    children[0].say({ event: 'devices', devices: [device] });
    await settle();
    assert.deepEqual(helper.state, { status: 'ready', devices: [device] });
    children[0].say({ event: 'devices', devices: [{ ...device, muted: true }] });
    await settle();
    assert.equal(helper.state.devices[0].muted, true);
    assert.deepEqual(states, ['starting', 'ready', 'ready']);
  });

  it('matches answers to requests by id', async () => {
    const child = await startReady();
    const first = helper.request({ cmd: 'toggleMute', uid: 'mic' });
    const second = helper.request({ cmd: 'setMute', uid: 'mic', muted: false });
    await settle();
    assert.deepEqual(child.requests, [
      { cmd: 'toggleMute', uid: 'mic', id: 1 },
      { cmd: 'setMute', uid: 'mic', muted: false, id: 2 },
    ]);
    child.say({ id: 2, ok: true, muted: false });
    child.say({ id: 1, ok: true, muted: true });
    assert.deepEqual(await first, { id: 1, ok: true, muted: true });
    assert.deepEqual(await second, { id: 2, ok: true, muted: false });
  });

  it('rejects with the error code of the helper', async () => {
    const child = await startReady();
    const notFound = helper.request({ cmd: 'toggleMute', uid: 'gone' });
    const failed = helper.request({ cmd: 'toggleMute', uid: 'mic' });
    child.say({ id: 1, ok: false, error: 'not-found' });
    child.say({ id: 2, ok: false, error: 'failed', status: -50 });
    await assert.rejects(notFound, { name: 'MuteHelperError', code: 'not-found', message: 'toggleMute failed: not-found' });
    await assert.rejects(failed, { code: 'failed', message: 'toggleMute failed: failed (OSStatus -50)' });
  });

  it('rejects requests the helper does not answer in time', async () => {
    await startReady();
    await assert.rejects(helper.request({ cmd: 'list' }), { code: 'timeout' });
  });

  it('rejects requests while the helper is not ready', async () => {
    create();
    await assert.rejects(helper.request({ cmd: 'list' }), (error) => error instanceof MuteHelperError && error.code === 'not-running');
    helper.start();
    await assert.rejects(helper.request({ cmd: 'list' }), { code: 'not-running' });
  });

  it('restarts a helper that exits, with a growing delay, and fails pending requests', async () => {
    const child = await startReady();
    const pending = helper.request({ cmd: 'toggleMute', uid: 'mic' });
    child.exit(1);
    await assert.rejects(pending, { code: 'not-running', message: 'The helper stopped: exit code 1' });
    assert.deepEqual(helper.state, { status: 'failed', devices: [], error: 'exit code 1' });
    assert.deepEqual(logs.at(-1), ['error', 'micmute-helper stopped (exit code 1); restarting in 5 ms']);

    await once(helper, 'change');
    assert.equal(children.length, 2);
    assert.equal(helper.state.status, 'starting');
    children[1].exit(2);
    await once(helper, 'change');
    assert.deepEqual(logs.at(-1), ['error', 'micmute-helper stopped (exit code 2); restarting in 10 ms']);
    await once(helper, 'change');
    children[2].exit(3);
    await once(helper, 'change');
    // The last delay repeats
    assert.deepEqual(logs.at(-1), ['error', 'micmute-helper stopped (exit code 3); restarting in 10 ms']);
  });

  it('treats a helper that cannot start like one that exits', async () => {
    create().start();
    const error = Object.assign(new Error('spawn /nonexistent/micmute-helper ENOENT'), { code: 'ENOENT' });
    children[0].emit('error', error);
    children[0].exit(-2);
    await settle();
    assert.deepEqual(helper.state, { status: 'failed', devices: [], error: error.message });
    assert.equal(logs.filter(([level]) => level === 'error').length, 1, 'reported once');
  });

  it('does not restart after stop()', async () => {
    const child = await startReady();
    helper.stop();
    assert.equal(child.killed, true);
    assert.equal(helper.state.status, 'stopped');
    child.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(children.length, 1);
  });

  it('logs what the helper writes to stderr and lines it cannot parse', async () => {
    const child = await startReady();
    child.stderr.write('micmute-helper: cannot read the mute of mic\n');
    // stderr and stdout are read independently
    await settle();
    child.stdout.write('garbage\n');
    child.say({ id: 99, ok: true });
    await settle();
    assert.deepEqual(logs, [
      ['warn', 'micmute-helper: cannot read the mute of mic'],
      ['error', 'micmute-helper sent a line that is not JSON: garbage'],
      ['warn', 'micmute-helper answered an unknown request: {"id":99,"ok":true}'],
    ]);
  });

  it('makes a helper that lost its executable bit executable again', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mute-helper-test-'));
    try {
      const command = path.join(dir, 'micmute-helper');
      writeFileSync(command, '');
      chmodSync(command, 0o644);
      create({ command }).start();
      assert.equal(statSync(command).mode & 0o777, 0o755);
      assert.deepEqual(logs, [['info', `Made ${command} executable`]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
