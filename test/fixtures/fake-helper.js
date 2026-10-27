#!/usr/bin/env node
// Stand-in for micmute-helper that speaks the same JSON lines protocol without touching real devices.
// The devices live in the JSON file named by FAKE_HELPER_STATE: commands write it, and a test that rewrites it
// plays the part of another app changing a device (the helper then reports the devices again).
import { readFileSync, watchFile, writeFileSync } from 'node:fs';
import readline from 'node:readline';

const file = process.env.FAKE_HELPER_STATE;
if (!file) {
  console.error('fake-helper: set FAKE_HELPER_STATE');
  process.exit(64);
}

/** @returns {import('../../src/devices.js').Device[]} */
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
  const { id, cmd, uid, muted } = JSON.parse(line);
  const reply = (fields) => send({ ...fields, id });
  if (cmd === 'list') return reply({ ok: true, devices: read() });
  if (cmd !== 'setMute' && cmd !== 'toggleMute') return reply({ ok: false, error: 'bad-request' });

  const devices = read();
  const device = devices.find((candidate) => candidate.uid === uid);
  if (!device) return reply({ ok: false, error: 'not-found' });
  if (!device.canMute) return reply({ ok: false, error: 'not-supported' });
  device.muted = cmd === 'toggleMute' ? !device.muted : muted;
  writeFileSync(file, JSON.stringify(devices));
  reply({ ok: true, muted: device.muted });
  report();
});

// Like the real helper: quit once the main service is gone
process.stdin.on('end', () => process.exit(0));
