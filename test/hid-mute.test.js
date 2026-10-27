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

const A = { id: 'sn:A', product: 'Maono Wireless Mic RX', serial: 'A', location: '01100000' };
const B = { id: 'sn:B', product: 'Maono Wireless Mic RX', serial: 'B', location: '01200000' };
const status = (...devices) => JSON.stringify({ devices });

describe('HidMute', () => {
  it('lists the receivers with their mutes, emitting change', async () => {
    const { hid, calls } = make(() => status({ ...A, muted: true }, { ...B, muted: false }));
    let changes = 0;
    hid.on('change', () => (changes += 1));
    const receivers = await hid.probe();
    assert.deepEqual(calls, [['status']]);
    assert.deepEqual(receivers, [
      { ...A, busy: false, muted: true },
      { ...B, busy: false, muted: false },
    ]);
    assert.deepEqual(hid.receivers, receivers);
    assert.equal(changes, 1);
  });

  it('marks a receiver another app holds as busy, with no mute', async () => {
    const { hid } = make(() => status({ ...A, busy: true }));
    await hid.probe();
    assert.deepEqual(hid.receivers, [{ ...A, busy: true, muted: null }]);
  });

  it('keeps the mute null when a receiver did not answer the read', async () => {
    const { hid } = make(() => status({ ...A, muted: null }));
    await hid.probe();
    assert.equal(hid.receivers[0].muted, null);
  });

  it('drops entries without an id, and fills in missing fields', async () => {
    const { hid } = make(() => status({ product: 'no id' }, { id: '' }, { id: 'loc:02132000', muted: false }));
    await hid.probe();
    assert.deepEqual(hid.receivers, [{ id: 'loc:02132000', product: '', serial: '', location: '', busy: false, muted: false }]);
  });

  it('finds no receiver when none is connected', async () => {
    const { hid } = make(() => status());
    await hid.probe();
    assert.deepEqual(hid.receivers, []);
  });

  it('treats a non-JSON answer as no receiver and logs it', async () => {
    let reply = status({ ...A, muted: false });
    const { hid, logs } = make(() => reply);
    await hid.probe();
    reply = 'not json at all';
    await hid.probe();
    assert.deepEqual(hid.receivers, []);
    assert.ok(logs.some(([level]) => level === 'warn'));
  });

  it('treats an answer without a device list as no receiver and logs it', async () => {
    const { hid, logs } = make(() => '{"ok":false,"reason":"bad-request"}');
    await hid.probe();
    assert.deepEqual(hid.receivers, []);
    assert.ok(logs.some(([level]) => level === 'warn'));
  });

  it('sets the mute of the receiver it names and records it', async () => {
    let reply = status({ ...A, muted: false }, { ...B, muted: false });
    const { hid, calls } = make(() => reply);
    await hid.probe();
    reply = '{"ok":true,"muted":true}';
    const muted = await hid.setMute('sn:B', true);
    assert.equal(muted, true);
    assert.deepEqual(calls.at(-1), ['set', '1', 'sn:B']);
    assert.deepEqual(
      hid.receivers.map(({ id, muted: m }) => [id, m]),
      [['sn:A', false], ['sn:B', true]],
    );
  });

  it('passes 0 to unmute', async () => {
    const { hid, calls } = make(() => '{"ok":true,"muted":false}');
    await hid.setMute('sn:A', false);
    assert.deepEqual(calls.at(-1), ['set', '0', 'sn:A']);
  });

  it('rejects with the helper reason when a set fails', async () => {
    const { hid } = make(() => '{"ok":false,"reason":"busy"}');
    await assert.rejects(hid.setMute('sn:A', true), (error) => error instanceof HidError && error.code === 'busy');
  });

  it('rejects when the helper does not answer with JSON', async () => {
    const { hid } = make(() => 'boom');
    await assert.rejects(hid.setMute('sn:A', true), (error) => error instanceof HidError && error.code === 'bad-reply');
  });

  it('emits change only when the receivers actually move', async () => {
    const { hid } = make(() => status({ ...A, muted: false }));
    let changes = 0;
    hid.on('change', () => (changes += 1));
    await hid.probe();
    await hid.probe();
    assert.equal(changes, 1);
  });
});
