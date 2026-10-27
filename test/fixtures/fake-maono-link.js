import net from 'node:net';
import { once } from 'node:events';

/**
 * A minimal stand-in for Maono Link's local IPC server, for the end-to-end test. It listens on a unix socket,
 * answers get/set for the mute (type 8) and broadcasts changes, like the real one.
 */
export async function startFakeMaonoLink(socketPath) {
  let muted = false;
  const clients = new Set();

  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.setEncoding('utf8');
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => {});
    // Maono Link sends the scene context on connect
    socket.write(`${JSON.stringify({ event: 'scene_context', current_pos: 0 })}\n`);

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.cmd === 'get' && message.type === 8) {
          socket.write(`${JSON.stringify({ event: 'reply', pos: message.pos, type: 8, value: muted ? 1 : 0 })}\n`);
        } else if (message.cmd === 'set' && message.type === 8) {
          muted = message.value === 1;
          broadcast({ event: 'update', pos: message.pos, type: 8, value: muted ? 1 : 0 });
          socket.write(`${JSON.stringify({ event: 'ack', pos: message.pos, type: 8, seq: message.seq, current_value: muted ? 1 : 0 })}\n`);
        }
      }
    });
  });

  function broadcast(message) {
    const line = `${JSON.stringify(message)}\n`;
    for (const client of clients) client.write(line);
  }

  server.listen(socketPath);
  await once(server, 'listening');

  return {
    /** Plays another app muting the microphone. */
    setMuted(value) {
      muted = value;
      broadcast({ event: 'update', pos: 0, type: 8, value: muted ? 1 : 0 });
    },
    get muted() {
      return muted;
    },
    close() {
      for (const client of clients) client.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
