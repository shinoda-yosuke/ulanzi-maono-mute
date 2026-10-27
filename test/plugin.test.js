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

/** Stands in for MaonoLink: the test sets its state and decides how toggles end. */
class FakeLink extends EventEmitter {
  state = { available: false, muted: new Map(), currentPos: null };
  starts = 0;
  toggles = [];
  result = () => Promise.resolve(true);

  start() { this.starts += 1; }
  isMuted(pos) { return this.state.muted.has(pos) ? this.state.muted.get(pos) : null; }
  toggleMute(pos) { this.toggles.push(pos); return this.result(pos); }

  /** Updates fields and notifies the plugin, like the real client does. */
  set({ available, muted }) {
    if (available !== undefined) this.state.available = available;
    if (muted !== undefined) this.state.muted = new Map(Object.entries(muted).map(([k, v]) => [Number(k), v]));
    this.emit('change');
  }
}

const context = (key) => `${ACTION_UUID}___${key}___action-${key}`;
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('registerMuteAction', () => {
  let api;
  let link;

  beforeEach(() => {
    api = new FakeApi();
    link = new FakeLink();
    registerMuteAction({ api, link });
  });

  async function emit(event, message) {
    api.emit(event, message);
    await settle();
  }

  const take = () => api.sent.splice(0);

  it('starts the Maono Link connection for the first key and shows unavailable until it connects', async () => {
    await emit('add', { context: context('0_0'), param: null });
    assert.equal(link.starts, 1);
    assert.deepEqual(take(), [['setPathIcon', context('0_0'), UNAVAILABLE_ICON]]);
  });

  it('shows the mute once Maono Link reports, and follows changes', async () => {
    await emit('add', { context: context('0_0'), param: {} });
    take(); // the initial unavailable icon
    link.set({ available: true, muted: { 0: false } });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.live]]);
    link.set({ muted: { 0: true } });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('goes back to the unavailable icon when Maono Link disappears', async () => {
    link.set({ available: true, muted: { 0: false } });
    await emit('add', { context: context('0_0'), param: {} });
    take();
    link.set({ available: false });
    assert.deepEqual(take(), [['setPathIcon', context('0_0'), UNAVAILABLE_ICON]]);
  });

  it('toggles the mute when the key runs', async () => {
    link.set({ available: true, muted: { 0: false } });
    await emit('add', { context: context('0_0'), param: {} });
    take();
    await emit('run', { context: context('0_0') });
    assert.deepEqual(link.toggles, [0]);
    assert.deepEqual(take(), [], 'no alert');
  });

  it('mutes the position chosen in the settings', async () => {
    link.set({ available: true, muted: { 0: false, 2: false } });
    await emit('run', { context: context('0_0'), param: { pos: 2 } });
    assert.deepEqual(link.toggles, [2]);
  });

  it('alerts and guides when the key runs while Maono Link is not reachable', async () => {
    await emit('run', { context: context('0_0'), param: {} });
    assert.deepEqual(link.toggles, []);
    assert.deepEqual(take().slice(-2), [
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES.unavailable}`],
    ]);
  });

  it('alerts and logs when the toggle fails', async () => {
    link.set({ available: true, muted: { 0: false } });
    link.result = () => Promise.reject(new Error('timeout'));
    await emit('run', { context: context('0_0'), param: {} });
    assert.deepEqual(take().slice(-3), [
      ['logMessage', 'error'],
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES.failed}`],
    ]);
  });

  it('shows the icon again when a key becomes active', async () => {
    link.set({ available: true, muted: { 0: true } });
    await emit('add', { context: context('0_0'), param: {} });
    take();
    await emit('setactive', { context: context('0_0'), active: true });
    await emit('setactive', { context: context('9_9'), active: true });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('keeps keys independent and forgets cleared keys', async () => {
    link.set({ available: true, muted: { 0: false } });
    await emit('add', { context: context('0_0'), param: {} });
    await emit('add', { context: context('1_0'), param: {} });
    take();
    await emit('clear', { param: [{ context: context('1_0') }] });
    link.set({ muted: { 0: true } });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('answers the property inspector and starts the connection even before the key is added', async () => {
    link.set({ available: true, muted: { 0: true } });
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'inspect' } });
    assert.ok(link.starts >= 1);
    const report = api.sent.find(([type]) => type === 'sendToPropertyInspector')[1];
    assert.deepEqual(report, { type: 'status', available: true, muted: true, pos: 0 });
  });

  it('keeps the property inspector up to date', async () => {
    await emit('add', { context: context('0_0'), param: {} });
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'inspect' } });
    take();
    link.set({ available: true, muted: { 0: false } });
    const report = api.sent.find(([type]) => type === 'sendToPropertyInspector')[1];
    assert.deepEqual(report, { type: 'status', available: true, muted: false, pos: 0 });
  });

  it('ignores other messages from the property inspector', async () => {
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'other' } });
    await emit('sendToPlugin', { context: context('0_0') });
    assert.deepEqual(take(), []);
  });
});
