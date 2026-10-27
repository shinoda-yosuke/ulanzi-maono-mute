import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUTO, findTarget, keyView } from '../src/devices.js';

// The devices of a Mac with a Maono wireless microphone and Maono Link installed, as micmute-helper reports them
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
  muted: false,
};
const aiMicrophone = {
  uid: 'Maono Virtual Driver2ch_UID',
  name: 'Maono AI Microphone',
  manufacturer: 'Maono Audio Inc.',
  transport: 'usb',
  isDefault: false,
  canMute: true,
  muted: true,
};

describe('findTarget', () => {
  it('picks the Maono USB microphone over the virtual AI microphone', () => {
    assert.equal(findTarget([aiMicrophone, builtIn, receiver], AUTO), receiver);
  });

  it('prefers the USB microphone even when the AI microphone is the default input', () => {
    const devices = [{ ...receiver, isDefault: false }, { ...aiMicrophone, isDefault: true }];
    assert.equal(findTarget(devices, AUTO), devices[0]);
  });

  it('prefers the default input among several Maono USB microphones', () => {
    const other = { ...receiver, uid: 'AppleUSBAudioEngine:Maono:PD400X:1', name: 'Maono PD400X', isDefault: false };
    assert.equal(findTarget([other, receiver], AUTO), receiver);
    assert.equal(findTarget([other, { ...receiver, isDefault: false }], AUTO), other);
  });

  it('recognizes Maono by name or manufacturer, ignoring case', () => {
    const byName = { ...builtIn, uid: 'AppleUSBAudioEngine:x', name: 'MAONO DM30', manufacturer: 'Generic' };
    const byManufacturer = { ...builtIn, uid: 'AppleUSBAudioEngine:y', name: 'USB Audio', manufacturer: 'maono' };
    assert.equal(findTarget([builtIn, byName], AUTO), byName);
    assert.equal(findTarget([builtIn, byManufacturer], AUTO), byManufacturer);
  });

  it('falls back to the virtual microphone when no Maono USB microphone is connected', () => {
    assert.equal(findTarget([builtIn, aiMicrophone], AUTO), aiMicrophone);
  });

  it('skips Maono devices that cannot be muted', () => {
    assert.equal(findTarget([{ ...receiver, canMute: false, muted: null }, aiMicrophone], AUTO), aiMicrophone);
  });

  it('finds nothing without a Maono device', () => {
    assert.equal(findTarget([builtIn], AUTO), undefined);
    assert.equal(findTarget([], AUTO), undefined);
  });

  it('returns a selected device by UID, whatever its maker', () => {
    assert.equal(findTarget([receiver, builtIn], builtIn.uid), builtIn);
    assert.equal(findTarget([receiver], 'gone'), undefined);
  });
});

describe('keyView', () => {
  const ready = (devices) => ({ status: 'ready', devices });

  it('shows the mute of the target', () => {
    assert.equal(keyView(ready([receiver]), AUTO), 'live');
    assert.equal(keyView(ready([{ ...receiver, muted: true }]), AUTO), 'muted');
    assert.equal(keyView(ready([receiver, aiMicrophone]), aiMicrophone.uid), 'muted');
  });

  it('is unavailable without a target that can be muted', () => {
    assert.equal(keyView(ready([builtIn]), AUTO), 'unavailable');
    assert.equal(keyView(ready([receiver]), 'gone'), 'unavailable');
    assert.equal(keyView(ready([{ ...builtIn, canMute: false, muted: null }]), builtIn.uid), 'unavailable');
    // Mute supported, but it could not be read
    assert.equal(keyView(ready([{ ...receiver, muted: null }]), AUTO), 'unavailable');
  });

  it('is unavailable while the helper is down', () => {
    assert.equal(keyView({ status: 'failed', devices: [], error: 'exit code 1' }, AUTO), 'unavailable');
    assert.equal(keyView({ status: 'stopped', devices: [] }, AUTO), 'unavailable');
  });

  it('shows nothing new before the helper reports', () => {
    assert.equal(keyView({ status: 'starting', devices: [] }, AUTO), null);
  });
});
