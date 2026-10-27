import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { HidError, HidMute } from '../src/hid.js';

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

  say(message) { this.stdout.write(`${JSON.stringify(message)}\n`); }
  kill() { this.killed = true; }
  exit(code) {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit('close', code, null));
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const device = (over = {}) => ({ name: 'Maono Wireless Mic RX', controllable: true, muted: null, ...over });

describe('HidMute', () => {
  let children;
  let logs;
  let hid;

  const create = (options = {}) => {
    hid = new HidMute({
      command: '/nonexistent/micmute-helper',
      log: (message, level) => logs.push([level, message]),
      spawnProcess: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      restartDelays: [5, 10],
      requestTimeout: 50,
      ...options,
    });
    return hid;
  };

  const started = async (devices = [device()]) => {
    create().start();
    children[0].say({ event: 'devices', devices });
    await settle();
    return children[0];
  };

  beforeEach(() => {
    children = [];
    logs = [];
  });

  afterEach(() => hid?.stop());

  it('reports the Maono microphone and its availability', async () => {
    const changes = [];
    create().on('change', () => changes.push(hid.available));
    assert.equal(hid.available, false);
    hid.start();
    children[0].say({ event: 'devices', devices: [device()] });
    await settle();
    assert.equal(hid.available, true);
    assert.equal(hid.isMuted(0), null);
    children[0].say({ event: 'devices', devices: [device({ muted: true })] });
    await settle();
    assert.equal(hid.isMuted(0), true);
    assert.deepEqual(changes, [true, true]);
  });

  it('is unavailable when the microphone is busy (held by Maono Link)', async () => {
    await started([device({ controllable: false })]);
    assert.equal(hid.available, false);
  });

  it('mutes over HID and resolves with the result', async () => {
    const child = await started();
    const done = hid.setMute(0, true);
    await settle();
    assert.deepEqual(child.requests, [{ cmd: 'setMute', muted: true, id: 1 }]);
    child.say({ id: 1, ok: true, muted: true });
    assert.equal(await done, true);
  });

  it('rejects with the helper error code when the microphone is busy', async () => {
    const child = await started();
    const busy = hid.setMute(0, true);
    child.say({ id: 1, ok: false, error: 'busy', status: -536870203 });
    await assert.rejects(busy, (error) => error instanceof HidError && error.code === 'busy');
  });

  it('rejects a request the helper does not answer in time', async () => {
    await started();
    await assert.rejects(hid.setMute(0, true), { code: 'timeout' });
  });

  it('rejects requests while the helper is not running', async () => {
    create();
    await assert.rejects(hid.setMute(0, true), { code: 'not-running' });
  });

  it('restarts a helper that exits and fails pending requests', async () => {
    const child = await started();
    const pending = hid.setMute(0, true);
    child.exit(1);
    await assert.rejects(pending, { code: 'not-running' });
    assert.equal(hid.available, false);
    assert.deepEqual(logs.at(-1), ['error', 'micmute-helper stopped (exit code 1); restarting in 5 ms']);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(children.length, 2, 'a new helper was started');
  });

  it('does not restart after stop()', async () => {
    const child = await started();
    hid.stop();
    assert.equal(child.killed, true);
    assert.equal(hid.available, false);
    child.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(children.length, 1);
  });

  it('logs stderr and lines it cannot parse', async () => {
    const child = await started();
    child.stderr.write('micmute-helper: cannot encode\n');
    await settle();
    child.stdout.write('garbage\n');
    await settle();
    assert.deepEqual(logs, [
      ['warn', 'micmute-helper: cannot encode'],
      ['error', 'micmute-helper sent a line that is not JSON: garbage'],
    ]);
  });
});
