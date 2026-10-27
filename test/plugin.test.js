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

/** A mute method the test fully controls. */
class FakeMethod extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.available = false;
    this.pending = true;
    this.muteValue = null;
    this.starts = 0;
    this.calls = [];
    this.result = () => Promise.resolve(true);
  }

  start() { this.starts += 1; }
  stop() {}
  isMuted() { return this.muteValue; }
  setMute(pos, muted) { this.calls.push({ pos, muted }); return this.result(pos, muted); }

  /** Updates fields and notifies the plugin, like the real adapters do. */
  set(state) { Object.assign(this, state); this.emit('change'); }
}

const context = (key) => `${ACTION_UUID}___${key}___action-${key}`;
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('registerMuteAction', () => {
  let api;
  let link;
  let hid;

  beforeEach(() => {
    api = new FakeApi();
    link = new FakeMethod('maono-link');
    hid = new FakeMethod('hid');
    registerMuteAction({ api, methods: [link, hid] });
  });

  async function emit(event, message) {
    api.emit(event, message);
    await settle();
  }

  const take = () => api.sent.splice(0);

  it('starts every method for the first key and keeps the default icon while they are pending', async () => {
    await emit('add', { context: context('0_0'), param: null });
    assert.equal(link.starts, 1);
    assert.equal(hid.starts, 1);
    assert.deepEqual(take(), []);
  });

  it('shows the mute once a method reports, following the preferred method', async () => {
    await emit('add', { context: context('0_0'), param: { priority: 'link-hid' } });
    link.set({ available: true, pending: false, muteValue: false });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.live]]);
    link.set({ muteValue: true });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('shows unavailable when no method can act and both have settled', async () => {
    await emit('add', { context: context('0_0'), param: {} });
    link.set({ available: false, pending: false });
    hid.set({ available: false, pending: false });
    assert.deepEqual(take(), [['setPathIcon', context('0_0'), UNAVAILABLE_ICON]]);
  });

  it('toggles through the preferred available method', async () => {
    link.set({ available: true, pending: false, muteValue: false });
    await emit('add', { context: context('0_0'), param: { priority: 'link-hid' } });
    take();
    await emit('run', { context: context('0_0') });
    assert.deepEqual(link.calls, [{ pos: 0, muted: true }]);
    assert.deepEqual(hid.calls, []);
    assert.deepEqual(take(), [], 'no alert');
  });

  it('respects a key that prefers HID', async () => {
    link.set({ available: true, pending: false, muteValue: false });
    hid.set({ available: true, pending: false, muteValue: false });
    await emit('run', { context: context('0_0'), param: { priority: 'hid-link' } });
    assert.deepEqual(hid.calls, [{ pos: 0, muted: true }]);
    assert.deepEqual(link.calls, []);
  });

  it('falls back to the other method when the preferred one fails', async () => {
    link.set({ available: true, pending: false, muteValue: false });
    hid.set({ available: true, pending: false, muteValue: false });
    link.result = () => Promise.reject(new Error('boom'));
    await emit('run', { context: context('0_0'), param: { priority: 'link-hid' } });
    assert.deepEqual(hid.calls, [{ pos: 0, muted: true }], 'HID took over');
    assert.ok(api.sent.some(([type, level]) => type === 'logMessage' && level === 'error'));
    assert.ok(!api.sent.some(([type]) => type === 'showAlert'), 'no alert, the fallback worked');
  });

  it('alerts that Maono Link is down when the link-only key runs and it is not available', async () => {
    await emit('run', { context: context('0_0'), param: { priority: 'link' } });
    assert.deepEqual(link.calls, []);
    assert.deepEqual(take().slice(-2), [
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES['maono-link-down']}`],
    ]);
  });

  it('alerts that the microphone is missing when the hid-only key runs and it is not available', async () => {
    await emit('run', { context: context('0_0'), param: { priority: 'hid' } });
    assert.deepEqual(take().slice(-2), [
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES['hid-unavailable']}`],
    ]);
  });

  it('alerts that nothing is available when neither method of a link-hid key can act', async () => {
    await emit('run', { context: context('0_0'), param: { priority: 'link-hid' } });
    assert.deepEqual(take().slice(-2), [
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES['maono-link-down']}`],
    ]);
  });

  it('alerts when both methods fail', async () => {
    link.set({ available: true, pending: false, muteValue: false });
    hid.set({ available: true, pending: false, muteValue: false });
    link.result = () => Promise.reject(new Error('a'));
    hid.result = () => Promise.reject(new Error('b'));
    await emit('run', { context: context('0_0'), param: { priority: 'link-hid' } });
    assert.deepEqual(take().slice(-2), [
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES.failed}`],
    ]);
  });

  it('shows the icon again when a key becomes active', async () => {
    link.set({ available: true, pending: false, muteValue: true });
    await emit('add', { context: context('0_0'), param: {} });
    take();
    await emit('setactive', { context: context('0_0'), active: true });
    await emit('setactive', { context: context('9_9'), active: true });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('keeps keys independent and forgets cleared keys', async () => {
    link.set({ available: true, pending: false, muteValue: false });
    await emit('add', { context: context('0_0'), param: {} });
    await emit('add', { context: context('1_0'), param: {} });
    take();
    await emit('clear', { param: [{ context: context('1_0') }] });
    link.set({ muteValue: true });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('tells the property inspector each method and keeps it up to date', async () => {
    link.set({ available: true, pending: false, muteValue: false });
    await emit('add', { context: context('0_0'), param: { priority: 'link-hid' } });
    take();
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'inspect' } });
    const [[, report]] = take();
    assert.equal(report.type, 'status');
    assert.equal(report.priority, 'link-hid');
    assert.deepEqual(report.methods, [
      { name: 'maono-link', available: true, muted: false },
      { name: 'hid', available: false, muted: null },
    ]);

    hid.set({ available: true, pending: false, muteValue: true });
    assert.ok(api.sent.some(([type, payload]) => type === 'sendToPropertyInspector' && payload.methods[1].available));
  });

  it('ignores other messages from the property inspector', async () => {
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'other' } });
    await emit('sendToPlugin', { context: context('0_0') });
    assert.deepEqual(take(), []);
  });
});
