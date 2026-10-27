import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, it } from 'node:test';
import { MuteHelperError } from '../src/helper.js';
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
  logMessage(msg, level) { this.sent.push(['logMessage', level, msg]); }
  sendToPropertyInspector(payload, context) { this.sent.push(['sendToPropertyInspector', payload, context]); }
}

/** Stands in for MuteHelper: the test reports states and decides how requests end. */
class FakeHelper extends EventEmitter {
  state = { status: 'stopped', devices: [] };
  starts = 0;
  requests = [];
  answer = () => Promise.resolve({ ok: true });

  start() {
    this.starts += 1;
    if (this.state.status === 'stopped') this.state = { status: 'starting', devices: [] };
  }

  request(command) {
    this.requests.push(command);
    return this.answer(command);
  }

  report(state) {
    this.state = state;
    this.emit('change', state);
  }
}

const receiver = {
  uid: 'AppleUSBAudioEngine:Shenzhen Maono Technology Co.,Ltd.:Maono Wireless Mic RX:MCT000000001:2',
  name: 'Maono Wireless Mic RX',
  manufacturer: 'Shenzhen Maono Technology Co.,Ltd.',
  transport: 'usb',
  isDefault: true,
  canMute: true,
  muted: false,
};
const builtIn = {
  uid: 'BuiltInMicrophoneDevice',
  name: 'MacBook Pro Microphone',
  manufacturer: 'Apple Inc.',
  transport: 'builtin',
  isDefault: false,
  canMute: true,
  muted: true,
};
const ready = (...devices) => ({ status: 'ready', devices });

const context = (key) => `${ACTION_UUID}___${key}___action-${key}`;
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('registerMuteAction', () => {
  let api;
  let helper;

  beforeEach(() => {
    api = new FakeApi();
    helper = new FakeHelper();
    registerMuteAction({ api, helper });
  });

  async function emit(event, message) {
    api.emit(event, message);
    await settle();
  }

  /** Returns what was sent since the last call */
  const take = () => api.sent.splice(0);

  it('starts the helper for the first key and shows the mute once the helper reports', async () => {
    await emit('add', { context: context('0_0'), param: null });
    assert.equal(helper.starts, 1);
    assert.deepEqual(take(), [], 'keeps the default image while the helper starts');

    helper.report(ready(receiver));
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.live]]);
    helper.report(ready({ ...receiver, muted: true }));
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('only sends icons that change', async () => {
    helper.report(ready(receiver));
    await emit('add', { context: context('0_0'), param: {} });
    take();
    helper.report(ready(receiver, builtIn));
    helper.report(ready(receiver));
    assert.deepEqual(take(), []);
  });

  it('toggles the Maono microphone when the key runs', async () => {
    helper.report(ready(builtIn, receiver));
    await emit('add', { context: context('0_0'), param: { device: 'auto' } });
    await emit('run', { context: context('0_0'), param: { device: 'auto' } });
    assert.deepEqual(helper.requests, [{ cmd: 'toggleMute', uid: receiver.uid }]);
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.live]], 'no alert');
  });

  it('toggles the microphone chosen in the property inspector', async () => {
    helper.report(ready(builtIn, receiver));
    await emit('add', { context: context('0_0'), param: { device: builtIn.uid, deviceName: builtIn.name } });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
    await emit('run', { context: context('0_0') });
    await emit('paramfromplugin', { context: context('0_0'), param: { device: 'auto' } });
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.live]], 'follows the new device');
    await emit('paramfromapp', { context: context('0_0'), param: { device: builtIn.uid } });
    await emit('run', { context: context('0_0') });
    assert.deepEqual(helper.requests, [
      { cmd: 'toggleMute', uid: builtIn.uid },
      { cmd: 'toggleMute', uid: builtIn.uid },
    ]);
  });

  it('uses the settings carried by run', async () => {
    helper.report(ready(builtIn, receiver));
    await emit('run', { context: context('0_0'), param: { device: builtIn.uid } });
    assert.deepEqual(helper.requests, [{ cmd: 'toggleMute', uid: builtIn.uid }]);
  });

  it('shows that nothing can be muted and alerts on run', async () => {
    helper.report(ready(receiver));
    await emit('add', { context: context('0_0'), param: {} });
    take();
    helper.report(ready(builtIn));
    assert.deepEqual(take(), [['setPathIcon', context('0_0'), UNAVAILABLE_ICON]]);
    await emit('run', { context: context('0_0') });
    assert.deepEqual(helper.requests, []);
    assert.deepEqual(take(), [
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES['no-maono']}`],
    ]);
  });

  it('alerts when the selected microphone is not connected', async () => {
    helper.report(ready(receiver));
    await emit('add', { context: context('0_0'), param: { device: builtIn.uid } });
    assert.deepEqual(take(), [['setPathIcon', context('0_0'), UNAVAILABLE_ICON]]);
    await emit('run', { context: context('0_0') });
    assert.deepEqual(take(), [
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES['not-found']}`],
    ]);
  });

  it('alerts when the selected microphone cannot be muted', async () => {
    helper.report(ready({ ...builtIn, canMute: false, muted: null }));
    await emit('run', { context: context('0_0'), param: { device: builtIn.uid } });
    assert.deepEqual(helper.requests, []);
    assert.deepEqual(take().slice(-2), [
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES['not-supported']}`],
    ]);
  });

  it('alerts while the helper is down', async () => {
    await emit('add', { context: context('0_0'), param: {} });
    helper.report({ status: 'failed', devices: [], error: 'exit code 1' });
    assert.deepEqual(take(), [['setPathIcon', context('0_0'), UNAVAILABLE_ICON]]);
    await emit('run', { context: context('0_0') });
    assert.deepEqual(take(), [
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES['helper-down']}`],
    ]);
  });

  it('alerts and logs when the helper cannot toggle', async () => {
    helper.report(ready(receiver));
    await emit('add', { context: context('0_0'), param: {} });
    take();
    for (const code of ['failed', 'timeout', 'not-found']) {
      helper.answer = () => Promise.reject(new MuteHelperError(`toggleMute failed: ${code}`, code));
      await emit('run', { context: context('0_0') });
    }
    assert.deepEqual(take(), [
      ['logMessage', 'error', `Toggling the mute of ${receiver.uid} failed: toggleMute failed: failed`],
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES.failed}`],
      ['logMessage', 'error', `Toggling the mute of ${receiver.uid} failed: toggleMute failed: timeout`],
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES.failed}`],
      ['logMessage', 'error', `Toggling the mute of ${receiver.uid} failed: toggleMute failed: not-found`],
      ['showAlert', context('0_0')],
      ['toast', `t:${MESSAGES['not-found']}`],
    ]);
  });

  it('shows the icon again when a key comes back', async () => {
    helper.report(ready(receiver));
    await emit('add', { context: context('0_0'), param: {} });
    await emit('setactive', { context: context('0_0'), active: false });
    await emit('setactive', { context: context('0_0'), active: true });
    await emit('add', { context: context('0_0'), param: {} });
    // Unknown keys are left alone
    await emit('setactive', { context: context('9_9'), active: true });
    assert.deepEqual(take(), [
      ['setStateIcon', context('0_0'), STATES.live],
      ['setStateIcon', context('0_0'), STATES.live],
      ['setStateIcon', context('0_0'), STATES.live],
    ]);
  });

  it('keeps keys independent and forgets cleared keys', async () => {
    helper.report(ready(receiver, builtIn));
    await emit('add', { context: context('0_0'), param: {} });
    await emit('add', { context: context('1_0'), param: { device: builtIn.uid } });
    assert.deepEqual(take(), [
      ['setStateIcon', context('0_0'), STATES.live],
      ['setStateIcon', context('1_0'), STATES.muted],
    ]);
    await emit('clear', { param: [{ context: context('1_0') }] });
    helper.report(ready({ ...receiver, muted: true }, { ...builtIn, muted: false }));
    assert.deepEqual(take(), [['setStateIcon', context('0_0'), STATES.muted]]);
  });

  it('tells the property inspector the devices and the target, and keeps it up to date', async () => {
    helper.report(ready(builtIn, receiver));
    await emit('add', { context: context('0_0'), param: {} });
    take();
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'inspect' } });
    assert.deepEqual(take(), [
      ['sendToPropertyInspector', { type: 'devices', status: 'ready', devices: [builtIn, receiver], target: receiver.uid }, context('0_0')],
    ]);

    await emit('paramfromplugin', { context: context('0_0'), param: { device: builtIn.uid } });
    assert.deepEqual(take(), [
      ['setStateIcon', context('0_0'), STATES.muted],
      ['sendToPropertyInspector', { type: 'devices', status: 'ready', devices: [builtIn, receiver], target: builtIn.uid }, context('0_0')],
    ]);

    helper.report(ready(receiver));
    assert.deepEqual(take(), [
      ['setPathIcon', context('0_0'), UNAVAILABLE_ICON],
      ['sendToPropertyInspector', { type: 'devices', status: 'ready', devices: [receiver], target: null }, context('0_0')],
    ]);

    // A cleared key's inspector is gone
    await emit('clear', { param: [{ context: context('0_0') }] });
    helper.report(ready(receiver, builtIn));
    assert.deepEqual(take(), []);
  });

  it('ignores other messages from the property inspector', async () => {
    await emit('sendToPlugin', { context: context('0_0'), payload: { type: 'something-else' } });
    await emit('sendToPlugin', { context: context('0_0') });
    assert.deepEqual(take(), []);
  });
});
