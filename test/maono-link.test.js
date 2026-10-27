import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { findSocketPath, MaonoLink, MaonoLinkError } from '../src/maono-link.js';

/** A duplex stand-in for the IPC socket: the test reads what the client writes and pushes lines back. */
class FakeSocket extends EventEmitter {
  writes = [];
  destroyed = false;

  setEncoding() {}
  write(chunk) {
    for (const line of String(chunk).split('\n').filter(Boolean)) this.writes.push(JSON.parse(line));
    return true;
  }
  destroy() { this.destroyed = true; }

  /** Delivers one JSON message as a line. */
  say(message) { this.emit('data', `${JSON.stringify(message)}\n`); }
  /** The last request the client wrote. */
  get last() { return this.writes.at(-1); }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('findSocketPath', () => {
  it('finds a socket whose name ends with IPCSERVER', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'maono-sock-'));
    const server = net.createServer();
    try {
      await new Promise((resolve) => server.listen(path.join(dir, 'PD200XWIPCSERVER'), resolve));
      assert.equal(findSocketPath(dir), path.join(dir, 'PD200XWIPCSERVER'));
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when there is no such socket', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'maono-sock-'));
    try {
      assert.equal(findSocketPath(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('MaonoLink', () => {
  let sockets;
  let socketPath;
  let link;

  const create = (options = {}) => {
    link = new MaonoLink({
      findSocket: () => socketPath,
      connect: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      reconnectDelay: 5,
      requestTimeout: 50,
      ...options,
    });
    return link;
  };

  const connect = async () => {
    create().start();
    const socket = sockets[0];
    socket.emit('connect');
    socket.say({ event: 'scene_context', current_pos: 0 });
    await settle();
    return socket;
  };

  beforeEach(() => {
    sockets = [];
    socketPath = '/tmp/fake-PD200XWIPCSERVER';
  });

  afterEach(() => link?.stop());

  it('becomes available and learns the current mute on connect', async () => {
    const changes = [];
    create().on('change', (state) => changes.push(state.available));
    link.start();
    const socket = sockets[0];
    socket.emit('connect');
    assert.equal(link.state.available, false, 'not available until it sees traffic');
    socket.say({ event: 'scene_context', current_pos: 0 });
    await settle();
    assert.equal(link.state.available, true);
    assert.equal(link.state.currentPos, 0);
    // It asked for the mute of the current position
    assert.deepEqual(socket.last, { cmd: 'get', pos: 0, type: 5 });
    socket.say({ event: 'reply', pos: 0, type: 5, value: 1 });
    await settle();
    assert.equal(link.isMuted(0), true);
    assert.ok(changes.includes(true));
  });

  it('follows mute changes made elsewhere', async () => {
    const socket = await connect();
    socket.say({ event: 'reply', pos: 0, type: 5, value: 0 });
    await settle();
    assert.equal(link.isMuted(0), false);
    socket.say({ event: 'update', pos: 0, type: 5, value: 1 });
    await settle();
    assert.equal(link.isMuted(0), true);
    // Ignores the level-meter stream
    socket.say({ event: 'update', pos: 2, type: 9, value: 3 });
    await settle();
    assert.equal(link.isMuted(2), null);
  });

  it('sets the mute and resolves on the acknowledgement', async () => {
    const socket = await connect();
    const done = link.setMute(0, true);
    await settle();
    assert.deepEqual(socket.last, { cmd: 'set', pos: 0, type: 5, value: 1, seq: socket.last.seq });
    socket.say({ event: 'ack', pos: 0, type: 5, seq: socket.last.seq, current_value: 1 });
    assert.equal(await done, true);
    assert.equal(link.isMuted(0), true);
  });

  it('toggles from the last known state', async () => {
    const socket = await connect();
    socket.say({ event: 'reply', pos: 0, type: 5, value: 0 });
    await settle();
    // Resolves only on the ack, which this test does not send; stop() will reject it
    link.toggleMute(0).catch(() => {});
    await settle();
    assert.equal(socket.last.value, 1);
  });

  it('rejects requests when Maono Link is not running', async () => {
    socketPath = null;
    create().start();
    await assert.rejects(link.setMute(0, true), (error) => error instanceof MaonoLinkError && error.code === 'not-running');
    assert.equal(link.state.available, false);
  });

  it('times out a request Maono Link never acknowledges', async () => {
    await connect();
    await assert.rejects(link.setMute(0, true), { code: 'timeout' });
  });

  it('reconnects after the socket closes and fails pending requests', async () => {
    const socket = await connect();
    const pending = link.setMute(0, true);
    socket.emit('close');
    await assert.rejects(pending, { code: 'not-running' });
    assert.equal(link.state.available, false);
    // A new connection attempt is made after the reconnect delay (5 ms)
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(sockets.length >= 2, `expected a reconnect, got ${sockets.length} sockets`);
  });

  it('stops cleanly', async () => {
    const socket = await connect();
    link.stop();
    assert.equal(socket.destroyed, true);
    assert.equal(link.state.available, false);
  });
});
