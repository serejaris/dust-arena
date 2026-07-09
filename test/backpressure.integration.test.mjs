import assert from 'node:assert/strict';
import test from 'node:test';
import { closeSocket, delay, join, startServer, stopServer, waitForMessage } from './helpers/server.mjs';

const PLAYER_COUNT = 256;
const PAUSE_MS = 10_000;

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

test('backlogged clients may miss states but still receive joined events', { timeout: 30_000 }, async () => {
  let server;
  let slow;
  let witness;
  const peers = [];
  try {
    server = await startServer();
    const url = `ws://127.0.0.1:${server.port}`;
    slow = await join(url, 'slow-client');
    for (let index = 0; index < PLAYER_COUNT; index += 1) peers.push(await join(url, `peer-${index}`));

    const socket = slow.ws._socket;
    assert.equal(typeof socket?.pause, 'function', 'the Node integration client must expose its transport');
    assert.equal(typeof socket?.resume, 'function', 'the Node integration client must expose its transport');
    socket.pause();
    const checkpoint = slow.messages.length;
    await delay(PAUSE_MS);

    witness = await join(url, 'event-proof');
    socket.resume();
    await waitForMessage(
      slow.messages,
      message => message.t === 'joined' && message.player?.name === 'event-proof',
      4_000,
    );
    await waitUntil(
      () => slow.messages.slice(checkpoint).some(message => message.t === 'states'),
      2_000,
      'slow client did not resume periodic state delivery',
    );

    const receivedWhileBacklogged = slow.messages.slice(checkpoint).filter(message => message.t === 'states').length;
    const expectedWithoutDropping = PAUSE_MS / 50;
    assert.ok(
      receivedWhileBacklogged < expectedWithoutDropping * 0.8,
      `slow socket received ${receivedWhileBacklogged}/${expectedWithoutDropping} periodic states; states were not dropped under backpressure`,
    );
  } finally {
    await Promise.allSettled([closeSocket(slow?.ws), closeSocket(witness?.ws), ...peers.map(peer => closeSocket(peer.ws))]);
    await stopServer(server?.child);
  }
});
