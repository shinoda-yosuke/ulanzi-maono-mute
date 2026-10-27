// Runs the fake Maono Link IPC server (fixtures/fake-maono-link.js) as its OWN process, so the plugin connects
// to a separate process the way it connects to the real Maono Link. (With the server in the test process, which
// is the plugin's parent, a unix-socket/child-pipe quirk kept the plugin from reading the HID helper.)
//
// Usage: node maono-link-server.mjs <socketPath>
// Prints "ready" once listening. Reads "mute 1" / "mute 0" on stdin to play another app muting the microphone.
import readline from 'node:readline';
import { startFakeMaonoLink } from './fake-maono-link.js';

const socketPath = process.argv[2];
if (!socketPath) {
  console.error('maono-link-server: pass a socket path');
  process.exit(64);
}

const link = await startFakeMaonoLink(socketPath);
process.stdout.write('ready\n');

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const [command, value] = line.trim().split(/\s+/);
  if (command === 'mute') link.setMuted(value === '1');
});

// Exit when the test closes our stdin, and keep the event loop alive otherwise
process.stdin.on('end', () => process.exit(0));
