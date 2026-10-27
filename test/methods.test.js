import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { hidMethod, maonoLinkMethod } from '../src/methods.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A stand-in MaonoLink with the fields the adapter reads. */
class FakeLink extends EventEmitter {
  state = { available: false, muted: new Map(), currentPos: null };
  starts = 0;
  sets = [];
  start() { this.starts += 1; }
  stop() {}
  isMuted(pos) { return this.state.muted.has(pos) ? this.state.muted.get(pos) : null; }
  setMute(pos, muted) { this.sets.push({ pos, muted }); return Promise.resolve(muted); }
  report(state) { Object.assign(this.state, state); this.emit('change'); }
}

/** A stand-in HidMute with the fields the adapter reads. */
class FakeHid extends EventEmitter {
  available = false;
  devices = [];
  starts = 0;
  sets = [];
  start() { this.starts += 1; }
  stop() {}
  isMuted() { return this.devices[0]?.muted ?? null; }
  setMute(pos, muted) { this.sets.push({ pos, muted }); return Promise.resolve(muted); }
  report(over) { Object.assign(this, over); this.emit('change'); }
}

describe('maonoLinkMethod', () => {
  it('exposes the link as a method and forwards calls', async () => {
    const link = new FakeLink();
    const method = maonoLinkMethod(link);
    assert.equal(method.name, 'maono-link');
    assert.equal(method.available, false);

    const changes = [];
    method.on('change', () => changes.push(method.available));
    method.start();
    assert.equal(link.starts, 1);

    link.report({ available: true, currentPos: 0, muted: new Map([[0, true]]) });
    await settle();
    assert.equal(method.available, true);
    assert.equal(method.isMuted(0), true);
    assert.deepEqual(changes, [true]);

    await method.setMute(0, false);
    assert.deepEqual(link.sets, [{ pos: 0, muted: false }]);
  });

  it('offers the known device positions', () => {
    const link = new FakeLink();
    const method = maonoLinkMethod(link);
    link.state = { available: true, currentPos: 1, muted: new Map([[1, false]]) };
    assert.deepEqual(method.devices(), [{ pos: 1, name: 'Maono #2' }]);
  });

  it('is pending until the link first reports', () => {
    const link = new FakeLink();
    const method = maonoLinkMethod(link);
    method.start();
    assert.equal(method.pending, true);
    link.report({ available: false });
    assert.equal(method.pending, false);
  });
});

describe('hidMethod', () => {
  it('exposes the helper as a method and forwards calls', async () => {
    const hid = new FakeHid();
    const method = hidMethod(hid);
    assert.equal(method.name, 'hid');
    assert.equal(method.available, false);
    assert.equal(method.pending, true);

    method.start();
    assert.equal(hid.starts, 1);

    hid.report({ available: true, devices: [{ muted: true }] });
    await settle();
    assert.equal(method.pending, false);
    assert.equal(method.available, true);
    assert.equal(method.isMuted(0), true);

    await method.setMute(0, false);
    assert.deepEqual(hid.sets, [{ pos: 0, muted: false }]);
  });
});
