import { once } from 'node:events';
import { WebSocketServer } from 'ws';

/**
 * A minimal stand-in for Ulanzi Studio's WebSocket server: it accepts the main service's
 * connection, sends it host events and records everything the plugin sends back.
 */
export async function startFakeHost() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');

  const received = [];
  const listeners = new Set();
  let socket;
  let closed;

  server.on('connection', (ws) => {
    socket = ws;
    ws.on('message', (data) => {
      received.push(JSON.parse(String(data)));
      for (const listener of listeners) listener();
    });
  });

  return {
    port: server.address().port,
    received,

    send(message) {
      socket.send(JSON.stringify(message));
    },

    /** Resolves with the first message at index `from` or later that matches `predicate`. */
    waitFor(predicate, { from = 0, timeout = 5000 } = {}) {
      return new Promise((resolve, reject) => {
        let timer;
        const check = () => {
          const found = received.slice(from).find(predicate);
          if (!found) return;
          clearTimeout(timer);
          listeners.delete(check);
          resolve(found);
        };
        timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`No matching message; received ${JSON.stringify(received.slice(from))}`));
        }, timeout);
        listeners.add(check);
        check();
      });
    },

    close() {
      closed ??= new Promise((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      });
      return closed;
    },
  };
}
