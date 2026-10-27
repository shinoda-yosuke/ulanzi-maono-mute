// Runs the real micmute-helper that npm test builds on macOS. It only reads devices; nothing gets muted.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import readline from 'node:readline';
import { describe, it } from 'node:test';
import { HELPER_BINARY } from '../scripts/lib/paths.mjs';

const skip = process.platform !== 'darwin' ? 'needs macOS' : !existsSync(HELPER_BINARY) && 'the helper is not built';

function assertDevice(device) {
  assert.deepEqual(Object.keys(device).sort(), ['canMute', 'isDefault', 'manufacturer', 'muted', 'name', 'transport', 'uid']);
  for (const field of ['uid', 'name', 'manufacturer']) assert.equal(typeof device[field], 'string', field);
  assert.ok(['usb', 'builtin', 'bluetooth', 'virtual', 'aggregate', 'other'].includes(device.transport), device.transport);
  assert.equal(typeof device.isDefault, 'boolean');
  assert.equal(typeof device.canMute, 'boolean');
  assert.ok(device.canMute ? typeof device.muted === 'boolean' || device.muted === null : device.muted === null);
}

describe('micmute-helper', { skip }, () => {
  it('is a universal binary', () => {
    assert.deepEqual(execFileSync('lipo', ['-archs', HELPER_BINARY], { encoding: 'utf8' }).trim().split(' ').sort(), ['arm64', 'x86_64']);
  });

  it('lists the input devices', () => {
    const devices = JSON.parse(execFileSync(HELPER_BINARY, ['list'], { encoding: 'utf8' }));
    assert.ok(Array.isArray(devices));
    devices.forEach(assertDevice);
    assert.ok(devices.filter((device) => device.isDefault).length <= 1);
  });

  it('reports devices, answers commands and exits when stdin closes', async () => {
    const helper = spawn(HELPER_BINARY, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = readline.createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
    const next = async () => JSON.parse((await lines.next()).value);
    const ask = async (request) => {
      helper.stdin.write(`${JSON.stringify(request)}\n`);
      return next();
    };

    const first = await next();
    assert.equal(first.event, 'devices');
    first.devices.forEach(assertDevice);

    const list = await ask({ id: 1, cmd: 'list' });
    assert.equal(list.id, 1);
    assert.equal(list.ok, true);
    assert.deepEqual(list.devices.map((device) => device.uid), first.devices.map((device) => device.uid));

    assert.deepEqual(await ask({ id: 2, cmd: 'toggleMute', uid: 'no-such-device' }), { id: 2, ok: false, error: 'not-found' });
    assert.deepEqual(await ask({ id: 'three', cmd: 'setMute', muted: true }), { id: 'three', ok: false, error: 'bad-request' });
    assert.deepEqual(await ask({ id: 4, cmd: 'unknown' }), { id: 4, ok: false, error: 'bad-request' });

    const exited = once(helper, 'exit');
    helper.stdin.end();
    assert.deepEqual(await exited, [0, null]);
  });

  it('prints its usage for unknown arguments', () => {
    assert.throws(() => execFileSync(HELPER_BINARY, ['--nope'], { stdio: 'pipe' }), { status: 64 });
  });
});
