#!/usr/bin/env node
// Short-lived stand-in for the maono-hid helper (status / set), so tests never touch real hardware.
// With no FAKE_HID_STATE it finds no receiver; point FAKE_HID_STATE at a JSON file to play receivers:
//   { "devices": [{ "id": "sn:A", "product": "Maono Wireless Mic RX", "serial": "A", "location": "01100000",
//                   "muted": false }] }
// "set" rewrites "muted" of the receiver it names, like the real latch; "busy": true plays one Maono Link holds.
import { readFileSync, writeFileSync } from 'node:fs';

const [cmd, value, id] = process.argv.slice(2);
const file = process.env.FAKE_HID_STATE;

const read = () => {
  if (!file) return { devices: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { devices: [] };
  }
};
const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

const state = read();
const devices = state.devices ?? [];
if (cmd === 'status') {
  out({
    devices: devices.map(({ busy, muted, ...receiver }) => (busy ? { ...receiver, busy: true } : { ...receiver, muted: muted ?? null })),
  });
} else if (cmd === 'set' && (value === '0' || value === '1') && id) {
  const matches = devices.filter((device) => device.id === id);
  if (matches.length !== 1) {
    out({ ok: false, reason: matches.length ? 'ambiguous' : 'not-found' });
  } else if (matches[0].busy) {
    out({ ok: false, reason: 'busy' });
  } else {
    const muted = value === '1';
    matches[0].muted = muted;
    if (file) writeFileSync(file, JSON.stringify(state));
    out({ ok: true, muted });
  }
} else {
  out({ ok: false, reason: 'bad-request' });
  process.exitCode = 64;
}
