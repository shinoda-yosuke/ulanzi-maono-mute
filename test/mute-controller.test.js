import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { MuteController, MuteUnavailableError } from '../src/mute-controller.js';

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
  receivers = [];
  probes = 0;
  sets = [];
  /** An error setMute throws, to play a receiver that went away */
  failure = null;

  async probe() {
    this.probes += 1;
    return this.receivers;
  }
  async setMute(id, muted) {
    this.sets.push([id, muted]);
    if (this.failure) throw this.failure;
    this.receivers = this.receivers.map((receiver) => (receiver.id === id ? { ...receiver, muted } : receiver));
    this.emit('change');
    return muted;
  }
  set(receivers) {
    this.receivers = receivers;
    this.emit('change');
  }
}

/** A receiver as HidMute lists it; a busy one (held by Maono Link) has no mute. */
const receiver = (id, { busy = false, muted = false } = {}) => ({
  id,
  product: 'Maono Wireless Mic RX',
  serial: id.slice(3),
  location: '01100000',
  busy,
  muted: busy ? null : muted,
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const build = (pollInterval = 10000) => {
  const link = new FakeLink();
  const hid = new FakeHid();
  const controller = new MuteController({ link, hid, pollInterval });
  return { link, hid, controller };
};

describe('MuteController', () => {
  describe('route', () => {
    it('mutes the only receiver over HID when none is chosen', () => {
      const { hid, controller } = build();
      hid.set([receiver('sn:A', { muted: true })]);
      assert.deepEqual(controller.route({}), { method: 'hid', device: 'sn:A', muted: true, reason: null });
    });

    it('asks to choose when several receivers are connected and none is chosen, even with Maono Link open', () => {
      const { link, hid, controller } = build();
      hid.set([receiver('sn:A'), receiver('sn:B', { busy: true })]);
      link.set({ available: true, muted: { 0: false } });
      assert.deepEqual(controller.route({}), { method: null, muted: null, reason: 'choose' });
    });

    it('mutes the chosen receiver over HID', () => {
      const { hid, controller } = build();
      hid.set([receiver('sn:A', { muted: false }), receiver('sn:B', { muted: true })]);
      assert.deepEqual(controller.route({ device: 'sn:B' }), { method: 'hid', device: 'sn:B', muted: true, reason: null });
    });

    it('reports a chosen receiver that is not connected, rather than muting another', () => {
      const { link, hid, controller } = build();
      hid.set([receiver('sn:A')]);
      link.set({ available: true, muted: { 0: false } });
      assert.deepEqual(controller.route({ device: 'sn:B' }), { method: null, muted: null, reason: 'not-found' });
    });

    it('uses HID for a free receiver even while Maono Link holds another', () => {
      const { link, hid, controller } = build();
      hid.set([receiver('sn:A', { muted: false }), receiver('sn:B', { busy: true })]);
      link.set({ available: true, muted: { 0: true } });
      assert.deepEqual(controller.route({ device: 'sn:A' }), { method: 'hid', device: 'sn:A', muted: false, reason: null });
    });

    it('goes through Maono Link for the receiver its panel holds', () => {
      const { link, hid, controller } = build();
      hid.set([receiver('sn:A', { busy: true }), receiver('sn:B')]);
      link.set({ available: true, muted: { 0: true, 1: false } });
      assert.deepEqual(controller.route({ device: 'sn:A' }), { method: 'maono-link', muted: true, reason: null });
      assert.deepEqual(controller.route({ device: 'sn:A', pos: 1 }), { method: 'maono-link', muted: false, reason: null });
    });

    it('goes through Maono Link for the only receiver when its panel holds it', () => {
      const { link, hid, controller } = build();
      hid.set([receiver('sn:A', { busy: true })]);
      link.set({ available: true, muted: { 0: false } });
      assert.deepEqual(controller.route({}), { method: 'maono-link', muted: false, reason: null });
    });

    it('does not use Maono Link when it holds several receivers, as it may reach another one', () => {
      const { link, hid, controller } = build();
      hid.set([receiver('sn:A', { busy: true }), receiver('sn:B', { busy: true })]);
      link.set({ available: true, muted: { 0: false } });
      assert.deepEqual(controller.route({ device: 'sn:A' }), { method: null, muted: null, reason: 'busy' });
    });

    it('reports busy when another app holds the receiver and Maono Link is not reachable', () => {
      const { hid, controller } = build();
      hid.set([receiver('sn:A', { busy: true })]);
      assert.deepEqual(controller.route({}), { method: null, muted: null, reason: 'busy' });
    });

    it('goes through Maono Link when no receiver is found, as it drives other models too', () => {
      const { link, controller } = build();
      link.set({ available: true, muted: { 0: false, 2: true } });
      assert.deepEqual(controller.route({}), { method: 'maono-link', muted: false, reason: null });
      assert.deepEqual(controller.route({ pos: 2 }), { method: 'maono-link', muted: true, reason: null });
    });

    it('is unavailable when there is nothing to mute', () => {
      const { controller } = build();
      assert.deepEqual(controller.route({}), { method: null, muted: null, reason: 'no-device' });
    });
  });

  describe('toggleMute', () => {
    it('toggles the chosen receiver over HID and resolves to its new mute', async () => {
      const { hid, controller } = build();
      hid.set([receiver('sn:A', { muted: false }), receiver('sn:B', { muted: false })]);
      assert.equal(await controller.toggleMute({ device: 'sn:B', pos: 0 }), true);
      assert.deepEqual(hid.sets, [['sn:B', true]]);
      assert.equal(controller.route({ device: 'sn:B' }).muted, true);
      assert.equal(controller.route({ device: 'sn:A' }).muted, false);
    });

    it('unmutes a muted receiver', async () => {
      const { hid, controller } = build();
      hid.set([receiver('sn:A', { muted: true })]);
      assert.equal(await controller.toggleMute({}), false);
      assert.deepEqual(hid.sets, [['sn:A', false]]);
    });

    it('toggles through Maono Link at the position of the target', async () => {
      const { link, hid, controller } = build();
      link.set({ available: true, muted: { 2: false } });
      await controller.toggleMute({ device: null, pos: 2 });
      assert.deepEqual(link.toggles, [2]);
      assert.deepEqual(hid.sets, []);
    });

    it('refuses, saying why, when the target cannot be muted', async () => {
      const { hid, controller } = build();
      hid.set([receiver('sn:A'), receiver('sn:B')]);
      await assert.rejects(
        controller.toggleMute({}),
        (error) => error instanceof MuteUnavailableError && error.reason === 'choose',
      );
      assert.deepEqual(hid.sets, []);
    });

    it('looks at the receivers again when a HID toggle fails', async () => {
      const { hid, controller } = build();
      hid.set([receiver('sn:A')]);
      hid.failure = new Error('busy');
      await assert.rejects(controller.toggleMute({}), /busy/);
      await settle();
      assert.equal(hid.probes, 1);
    });
  });

  describe('updates', () => {
    it('emits change when the receivers or Maono Link move, and only then', () => {
      const { link, hid, controller } = build();
      let changes = 0;
      controller.on('change', () => (changes += 1));
      hid.set([receiver('sn:A')]);
      hid.set([receiver('sn:A')]); // the same receivers again
      link.set({ available: true, muted: { 0: false } });
      link.set({ muted: { 0: false } }); // nothing new
      link.set({ muted: { 0: true } });
      assert.equal(changes, 3);
    });

    it('polls the receivers, also while Maono Link is available', async () => {
      const { link, hid, controller } = build(10);
      link.set({ available: true, muted: { 0: false } });
      controller.start();
      await delay(60);
      controller.stop();
      assert.ok(hid.probes >= 2, `expected repeated probes, got ${hid.probes}`);
    });

    it('looks again right away when Maono Link comes or goes, as it takes or frees a receiver', async () => {
      const { link, hid, controller } = build();
      controller.start();
      await settle();
      assert.equal(hid.probes, 1);
      link.set({ available: true });
      await settle();
      assert.equal(hid.probes, 2);
      link.set({ muted: { 0: true } }); // a mute change is not a reason to look again
      await settle();
      assert.equal(hid.probes, 2);
      link.set({ available: false });
      await settle();
      assert.equal(hid.probes, 3);
      controller.stop();
    });

    it('runs one more probe when one is asked for while another runs', async () => {
      const { link, hid, controller } = build();
      let finish;
      hid.probe = function probe() {
        this.probes += 1;
        return new Promise((resolve) => (finish = resolve));
      };
      controller.start(); // first probe, still running
      link.set({ available: true }); // asks for another while it runs
      assert.equal(hid.probes, 1);
      finish();
      await settle();
      assert.equal(hid.probes, 2);
      finish();
      controller.stop();
    });

    it('starts Maono Link once, and stops it when stopped', () => {
      const { link, controller } = build();
      controller.start();
      controller.start();
      controller.stop();
      assert.equal(link.started, 1);
      assert.equal(link.stopped, 1);
    });
  });
});
