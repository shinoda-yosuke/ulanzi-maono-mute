import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, it } from 'node:test';
import { ACTION_UUID, MESSAGES, registerMuteAction, STATES, UNAVAILABLE_ICON } from '../src/plugin.js';

/** Records what the plugin sends; events are delivered with emit() like the SDK does. */
class FakeApi extends EventEmitter {
  sent = [];

  onAdd(fn) { this.on('add', fn); }
  onParamFromApp(fn) { this.on('paramfromapp', fn); }
  onParamFromPlugin(fn) { this.on('paramfromplugin', fn); }
  onSetActive(fn) { this.on('setactive', fn); }
  onClear(fn) { this.on('clear', fn); }
  onRun(fn) { this.on('run', fn); }
  onSendToPlugin(fn) { this.on('sendToPlugin', fn); }

  t(key) { return `t:${key}`; }
  setStateIcon(context, state) { this.sent.push(['setStateIcon', context, state]); }
  setPathIcon(context, path) { this.sent.push(['setPathIcon', context, path]); }
  showAlert(context) { this.sent.push(['showAlert', context]); }
  toast(msg) { this.sent.push(['toast', msg]); }
  logMessage(msg, level) { this.sent.push(['logMessage', level]); }
  sendToPropertyInspector(payload, context) { this.sent.push(['sendToPropertyInspector', payload, context]); }
}

const unreachable = (reason) => ({ method: null, muted: null, reason });
const live = { method: 'hid', device: 'sn:A', muted: false, reason: null };
const muted = { ...live, muted: true };

/** Stands in for MuteController: the test decides the route of each chosen microphone and how toggles end. */
class FakeController extends EventEmitter {
  starts = 0;
  toggles = [];
  receivers = [];
  /** Route by the device a key chose; null is a key that chose none */
  routes = new Map();
  result = () => Promise.resolve(true);

  start() { this.starts += 1; }
  route({ device }) { return this.routes.get(device) ?? unreachable('no-device'); }
  toggleMute({ device, pos }) { this.toggles.push({ device, pos }); return this.result(); }

  /** Changes routes (keyed by device, "auto" for none chosen) and notifies the plugin, like the real one does. */
  set(routes) {
    for (const [device, route] of Object.entries(routes)) this.routes.set(device === 'auto' ? null : device, route);
    this.emit('change');
  }
}

const context = (key) => `${ACTION_UUID}___${key}___action-${key}`;
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('registerMuteAction', () => {
  let api;
  let controller;

  beforeEach(() => {
    api = new FakeApi();
    controller = new FakeController();
    registerMuteAction({ api, controller });
  });

  async function emit(event, message) {
    api.emit(event, message);
    await settle();
  }

  const take = () => api.sent.splice(0);
  const reports = () => api.sent.filter(([type]) => type === 'sendToPropertyInspector').map(([, payload]) => payload);

  it('starts the controller for the first key and shows unavailable until the key can mute', async () => {
    await emit('add', { context: context('0_0'), param: null });
    assert.equal(controller.starts, 1);
    assert.deepEqual(take(), [['setPathIcon', context('0_0'), UNAVAILABLE_ICON]]);
  });

  it('shows the mute once it is known, and follows changes', async () => {
    await emit('add', { context: context('0_0'), param: {} });
    take(); // the initial unavailable icon
    controller.set({ auto: live });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.live]]);
    controller.set({ auto: muted });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('keeps the icon while the mute has not been read back yet', async () => {
    controller.set({ auto: { ...live, muted: null } });
    await emit('add', { context: context('0_0'), param: {} });
    assert.deepEqual(take(), []);
  });

  it('goes back to the unavailable icon when the microphone cannot be reached', async () => {
    controller.set({ auto: live });
    await emit('add', { context: context('0_0'), param: {} });
    take();
    controller.set({ auto: unreachable('no-device') });
    assert.deepEqual(take(), [['setPathIcon', context('0_0'), UNAVAILABLE_ICON]]);
  });

  it('shows each key the mute of the microphone chosen for it', async () => {
    controller.set({ 'sn:A': muted, 'sn:B': { ...live, device: 'sn:B' } });
    await emit('add', { context: context('0_0'), param: { device: 'sn:A' } });
    await emit('add', { context: context('1_0'), param: { device: 'sn:B' } });
    assert.deepEqual(take(), [
      ['setStateIcon', context('0_0'), STATES.muted],
      ['setStateIcon', context('1_0'), STATES.live],
    ]);
  });

  it('follows the microphone chosen in the settings when it changes', async () => {
    controller.set({ 'sn:A': muted, 'sn:B': { ...live, device: 'sn:B' } });
    await emit('add', { context: context('0_0'), param: { device: 'sn:A' } });
    take();
    await emit('paramfromplugin', { context: context('0_0'), param: { device: 'sn:B' } });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.live]]);
  });

  it('toggles the mute of the microphone when the key runs', async () => {
    controller.set({ auto: live });
    await emit('add', { context: context('0_0'), param: {} });
    take();
    await emit('run', { context: context('0_0') });
    assert.deepEqual(controller.toggles, [{ device: null, pos: 0 }]);
    assert.deepEqual(take(), [], 'no alert');
  });

  it('mutes the microphone and the position chosen in the settings', async () => {
    controller.set({ 'sn:B': live, auto: { method: 'maono-link', muted: false, reason: null } });
    await emit('run', { context: context('0_0'), param: { device: 'sn:B' } });
    await emit('run', { context: context('1_0'), param: { pos: 2 } });
    assert.deepEqual(controller.toggles, [{ device: 'sn:B', pos: 0 }, { device: null, pos: 2 }]);
  });

  it('treats an empty choice as automatic', async () => {
    controller.set({ auto: live });
    await emit('run', { context: context('0_0'), param: { device: '' } });
    assert.deepEqual(controller.toggles, [{ device: null, pos: 0 }]);
  });

  for (const [reason, message] of [
    ['no-device', MESSAGES.unavailable],
    ['choose', MESSAGES.choose],
    ['not-found', MESSAGES.notFound],
    ['busy', MESSAGES.busy],
  ]) {
    it(`alerts and says why when the key runs but cannot mute (${reason})`, async () => {
      controller.set({ auto: unreachable(reason) });
      await emit('run', { context: context('0_0'), param: {} });
      assert.deepEqual(controller.toggles, []);
      assert.deepEqual(take().slice(-2), [
        ['showAlert', context('0_0')],
        ['toast', `t:${message}`],
      ]);
    });
  }

  it('alerts and logs when the toggle fails', async () => {
    controller.set({ auto: live });
    controller.result = () => Promise.reject(new Error('timeout'));
    await emit('run', { context: context('0_0'), param: {} });
    assert.deepEqual(take().slice(-3), [
      ['logMessage', 'error'],
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES.failed}`],
    ]);
  });

  it('shows the icon again when a key becomes active', async () => {
    controller.set({ auto: muted });
    await emit('add', { context: context('0_0'), param: {} });
    take();
    await emit('setactive', { context: context('0_0'), active: true });
    await emit('setactive', { context: context('9_9'), active: true });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('keeps keys independent and forgets cleared keys', async () => {
    controller.set({ auto: live });
    await emit('add', { context: context('0_0'), param: {} });
    await emit('add', { context: context('1_0'), param: {} });
    take();
    await emit('clear', { param: [{ context: context('1_0') }] });
    controller.set({ auto: muted });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('tells the property inspector the receivers and why the key cannot mute, even before the key is added', async () => {
    controller.receivers = [
      { id: 'sn:A', product: 'Maono Wireless Mic RX', serial: 'A', location: '01100000', busy: false, muted: true },
      { id: 'loc:01200000', product: 'Maono Wireless Mic RX', serial: '', location: '01200000', busy: true, muted: null },
    ];
    controller.set({ auto: unreachable('choose') });
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'inspect' } });
    assert.ok(controller.starts >= 1);
    assert.deepEqual(reports(), [
      {
        type: 'status',
        available: false,
        muted: null,
        reason: 'choose',
        devices: [
          { id: 'sn:A', product: 'Maono Wireless Mic RX', serial: 'A', location: '01100000' },
          { id: 'loc:01200000', product: 'Maono Wireless Mic RX', serial: '', location: '01200000' },
        ],
      },
    ]);
  });

  it('keeps the property inspector up to date', async () => {
    await emit('add', { context: context('0_0'), param: {} });
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'inspect' } });
    take();
    controller.set({ auto: live });
    assert.deepEqual(reports(), [{ type: 'status', available: true, muted: false, reason: null, devices: [] }]);
  });

  it('tells the property inspector about the microphone chosen in it', async () => {
    controller.set({ auto: live, 'sn:B': unreachable('not-found') });
    await emit('add', { context: context('0_0'), param: {} });
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'inspect' } });
    take();
    await emit('paramfromplugin', { context: context('0_0'), param: { device: 'sn:B' } });
    assert.deepEqual(reports(), [{ type: 'status', available: false, muted: null, reason: 'not-found', devices: [] }]);
  });

  it('ignores other messages from the property inspector', async () => {
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'other' } });
    await emit('sendToPlugin', { context: context('0_0') });
    assert.deepEqual(take(), []);
  });
});
