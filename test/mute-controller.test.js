import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { MuteController } from '../src/mute-controller.js';

/** Stands in for MaonoLink (the IPC backend). */
class FakeLink extends EventEmitter {
  state = { available: false, muted: new Map(), currentPos: null };
  started = 0;
  stopped = 0;
  toggles = [];

  start() {
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
  }
  isMuted(pos) {
    return this.state.muted.has(pos) ? this.state.muted.get(pos) : null;
  }
  toggleMute(pos) {
    this.toggles.push(pos);
    return Promise.resolve(!(this.isMuted(pos) ?? false));
  }
  set({ available, muted }) {
    if (available !== undefined) this.state.available = available;
    if (muted !== undefined) this.state.muted = new Map(Object.entries(muted).map(([k, v]) => [Number(k), v]));
    this.emit('change');
  }
}

/** Stands in for HidMute (the HID backend). */
class FakeHid extends EventEmitter {
  available = false;
  muted = null;
  probes = 0;
  sets = [];

  isMuted() {
    return this.muted;
  }
  async probe() {
    this.probes += 1;
    return { available: this.available, muted: this.muted };
  }
  async setMute(_pos, muted) {
    this.sets.push(muted);
    this.available = true;
    this.muted = muted;
    this.emit('change');
    return muted;
  }
  set({ available, muted }) {
    if (available !== undefined) this.available = available;
    if (muted !== undefined) this.muted = muted;
    this.emit('change');
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const build = (pollInterval = 10000) => {
  const link = new FakeLink();
  const hid = new FakeHid();
  const controller = new MuteController({ link, hid, pollInterval });
  return { link, hid, controller };
};

describe('MuteController', () => {
  it('starts Maono Link and prefers it while it is available', () => {
    const { link, controller } = build();
    controller.start();
    assert.equal(link.started, 1);
    link.set({ available: true, muted: { 0: false } });
    assert.equal(controller.state.method, 'maono-link');
    assert.equal(controller.state.available, true);
    assert.equal(controller.isMuted(0), false);
  });

  it('toggles through Maono Link when it is the active method', async () => {
    const { link, hid, controller } = build();
    link.set({ available: true, muted: { 0: false } });
    await controller.toggleMute(0);
    assert.deepEqual(link.toggles, [0]);
    assert.deepEqual(hid.sets, []);
  });

  it('falls back to HID when Maono Link is not available', () => {
    const { hid, controller } = build();
    controller.start();
    hid.set({ available: true, muted: false });
    assert.equal(controller.state.method, 'hid');
    assert.equal(controller.state.available, true);
    assert.equal(controller.isMuted(0), false);
  });

  it('toggles through HID when it is the active method', async () => {
    const { hid, controller } = build();
    hid.set({ available: true, muted: false });
    const result = await controller.toggleMute(0);
    assert.deepEqual(hid.sets, [true]);
    assert.equal(result, true);
    assert.equal(controller.isMuted(0), true);
  });

  it('prefers Maono Link over HID when both can act', () => {
    const { link, hid, controller } = build();
    hid.set({ available: true, muted: true });
    link.set({ available: true, muted: { 0: false } });
    assert.equal(controller.state.method, 'maono-link');
    assert.equal(controller.isMuted(0), false);
  });

  it('is unavailable, and refuses to toggle, when neither backend can act', async () => {
    const { controller } = build();
    controller.start();
    assert.equal(controller.state.available, false);
    assert.equal(controller.state.method, null);
    assert.equal(controller.isMuted(0), null);
    await assert.rejects(controller.toggleMute(0));
  });

  it('emits change as the active method appears and disappears', () => {
    const { link, hid, controller } = build();
    const methods = [];
    controller.on('change', () => methods.push(controller.state.method));
    link.set({ available: true, muted: { 0: false } }); // -> maono-link
    link.set({ available: false }); // -> null (hid still unavailable)
    hid.set({ available: true, muted: false }); // -> hid
    assert.deepEqual(methods, ['maono-link', null, 'hid']);
  });

  it('polls HID while Maono Link is down so the key follows the device', async () => {
    const { hid, controller } = build(10);
    hid.available = true;
    hid.muted = false;
    controller.start();
    await delay(40);
    controller.stop();
    assert.ok(hid.probes >= 1, `expected a probe, got ${hid.probes}`);
    assert.equal(controller.state.method, 'hid');
  });

  it('stops Maono Link when stopped', () => {
    const { link, controller } = build();
    controller.start();
    controller.stop();
    assert.equal(link.stopped, 1);
  });
});
