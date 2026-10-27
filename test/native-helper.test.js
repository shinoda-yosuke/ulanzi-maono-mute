// Runs the real micmute-helper that npm test builds on macOS. It is read-only here: it lists the Maono
// microphones but never mutes one, so running the suite never changes the device.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import readline from 'node:readline';
import { describe, it } from 'node:test';
import { HELPER_BINARY } from '../scripts/lib/paths.mjs';

const skip = process.platform !== 'darwin' ? 'needs macOS' : !existsSync(HELPER_BINARY) && 'the helper is not built';

function assertDevice(device) {
  assert.deepEqual(Object.keys(device).sort(), ['controllable', 'muted', 'name']);
  assert.equal(typeof device.name, 'string');
  assert.equal(typeof device.controllable, 'boolean');
  assert.ok(device.muted === null || typeof device.muted === 'boolean');
}

describe('micmute-helper', { skip }, () => {
  it('is a universal binary', () => {
    const archs = execFileSync('lipo', ['-archs', HELPER_BINARY], { encoding: 'utf8' }).trim().split(/\s+/).sort();
    assert.deepEqual(archs, ['arm64', 'x86_64']);
  });

  it('lists the Maono microphones (possibly none)', () => {
    const devices = JSON.parse(execFileSync(HELPER_BINARY, ['list'], { encoding: 'utf8' }));
    assert.ok(Array.isArray(devices));
    devices.forEach(assertDevice);
  });

  it('reports devices, answers list and exits when stdin closes', async () => {
    const helper = spawn(HELPER_BINARY, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = readline.createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
    const next = async () => JSON.parse((await lines.next()).value);

    const first = await next();
    assert.equal(first.event, 'devices');
    assert.ok(Array.isArray(first.devices));
    first.devices.forEach(assertDevice);

    helper.stdin.write(`${JSON.stringify({ id: 1, cmd: 'list' })}\n`);
    let reply;
    do {
      reply = await next();
    } while (reply.event); // skip any devices events
    assert.equal(reply.id, 1);
    assert.equal(reply.ok, true);

    helper.stdin.write(`${JSON.stringify({ id: 2, cmd: 'nope' })}\n`);
    let answer;
    do {
      answer = await next();
    } while (answer.event);
    assert.deepEqual(answer, { id: 2, ok: false, error: 'bad-request' });

    const exited = once(helper, 'exit');
    helper.stdin.end();
    assert.deepEqual(await exited, [0, null]);
  });

  it('prints its usage for unknown arguments', () => {
    assert.throws(() => execFileSync(HELPER_BINARY, ['--nope'], { stdio: 'pipe' }), { status: 64 });
  });
});
