#!/usr/bin/env node
// Stand-in for micmute-helper that speaks the same JSON lines protocol without touching real hardware.
// The devices live in the JSON file named by FAKE_HELPER_STATE: setMute writes it, and a test that rewrites it
// plays the part of the microphone being plugged in or out (the helper then reports the devices again).
import { readFileSync, watchFile, writeFileSync } from 'node:fs';
import readline from 'node:readline';

const file = process.env.FAKE_HELPER_STATE;
if (!file) {
  console.error('fake-helper: set FAKE_HELPER_STATE');
  process.exit(64);
}

/** @returns {import('../../src/hid.js').HidDevice[]} */
const read = () => JSON.parse(readFileSync(file, 'utf8'));
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

let last = '';
const report = () => {
  const text = readFileSync(file, 'utf8');
  if (text === last) return;
  last = text;
  send({ event: 'devices', devices: JSON.parse(text) });
};

report();
watchFile(file, { interval: 20 }, report);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, cmd, muted } = JSON.parse(line);
  const reply = (fields) => send({ ...fields, id });
  if (cmd === 'list') return reply({ ok: true, devices: read() });
  if (cmd !== 'setMute') return reply({ ok: false, error: 'bad-request' });

  const devices = read();
  const device = devices[0];
  if (!device) return reply({ ok: false, error: 'no-device' });
  if (!device.controllable) return reply({ ok: false, error: 'busy' });
  device.muted = muted;
  writeFileSync(file, JSON.stringify(devices));
  reply({ ok: true, muted });
  report();
});

// Like the real helper: quit once the main service is gone
process.stdin.on('end', () => process.exit(0));
