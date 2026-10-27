#!/usr/bin/env node
// Short-lived stand-in for the maono-hid helper (get / set), so tests never touch real hardware.
// With no FAKE_HID_STATE it reports no device; point FAKE_HID_STATE at a JSON file to play a device:
//   { "available": true, "muted": false }   — "set" rewrites "muted", like the real latch.
import { readFileSync, writeFileSync } from 'node:fs';

const [cmd, value] = process.argv.slice(2);
const file = process.env.FAKE_HID_STATE;

const read = () => {
  if (!file) return { available: false };
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { available: false };
  }
};
const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

const state = read();
if (cmd === 'get') {
  out(state.available ? { available: true, muted: state.muted ?? null } : { available: false, reason: state.reason ?? 'no-device' });
} else if (cmd === 'set') {
  if (!state.available) {
    out({ ok: false, reason: state.reason ?? 'no-device' });
  } else {
    const muted = value === '1';
    if (file) writeFileSync(file, JSON.stringify({ ...state, muted }));
    out({ ok: true, muted });
  }
} else {
  out({ ok: false, reason: 'bad-request' });
}
