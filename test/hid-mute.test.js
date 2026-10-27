import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HidError, HidMute } from '../src/hid-mute.js';

/** A HidMute whose helper is a canned reply function instead of a real process. */
function make(reply) {
  const calls = [];
  const logs = [];
  const hid = new HidMute({
    command: 'unused',
    log: (message, level) => logs.push([level, message]),
    run: async (args) => {
      calls.push(args);
      return reply(args);
    },
  });
  return { hid, calls, logs };
}

describe('HidMute', () => {
  it('probes the device and reports availability and mute, emitting change', async () => {
    const { hid } = make(() => '{"available":true,"muted":true}');
    let changes = 0;
    hid.on('change', () => (changes += 1));
    const result = await hid.probe();
    assert.deepEqual(result, { available: true, muted: true });
    assert.equal(hid.available, true);
    assert.equal(hid.isMuted(), true);
    assert.equal(changes, 1);
  });

  it('reports unavailable when the helper finds no device', async () => {
    const { hid } = make(() => '{"available":false,"reason":"no-device"}');
    await hid.probe();
    assert.equal(hid.available, false);
    assert.equal(hid.isMuted(), null);
  });

  it('keeps the mute null when the device is there but unread', async () => {
    const { hid } = make(() => '{"available":true,"muted":null}');
    await hid.probe();
    assert.equal(hid.available, true);
    assert.equal(hid.isMuted(), null);
  });

  it('treats a non-JSON answer as unavailable and logs it', async () => {
    const { hid, logs } = make(() => 'not json at all');
    await hid.probe();
    assert.equal(hid.available, false);
    assert.ok(logs.some(([level]) => level === 'warn'));
  });

  it('sets the mute and returns the resulting state', async () => {
    const { hid, calls } = make(() => '{"ok":true,"muted":true}');
    const muted = await hid.setMute(0, true);
    assert.equal(muted, true);
    assert.equal(hid.isMuted(), true);
    assert.deepEqual(calls.at(-1), ['set', '1']);
  });

  it('passes 0 to unmute', async () => {
    const { hid, calls } = make(() => '{"ok":true,"muted":false}');
    await hid.setMute(0, false);
    assert.deepEqual(calls.at(-1), ['set', '0']);
  });

  it('rejects with the helper reason when a set fails', async () => {
    const { hid } = make(() => '{"ok":false,"reason":"busy"}');
    await assert.rejects(hid.setMute(0, true), (error) => error instanceof HidError && error.code === 'busy');
  });

  it('rejects when the helper does not answer with JSON', async () => {
    const { hid } = make(() => 'boom');
    await assert.rejects(hid.setMute(0, true), (error) => error instanceof HidError && error.code === 'bad-reply');
  });

  it('emits change only when the state actually moves', async () => {
    const { hid } = make(() => '{"available":false,"reason":"no-device"}');
    let changes = 0;
    hid.on('change', () => (changes += 1));
    await hid.probe(); // false -> false (already the initial state)
    await hid.probe();
    assert.equal(changes, 0);
  });
});
