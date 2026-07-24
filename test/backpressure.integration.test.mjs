import assert from 'node:assert/strict';
import test from 'node:test';
import { closeSocket, delay, join, startServer, stopServer, waitForMessage } from './helpers/server.mjs';

const PLAYER_COUNT = 256;
const JOIN_BATCH_SIZE = 16;
const PAUSE_MS = 10_000;

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

async function joinInBatches(url, count) {
  const peers = [];
  for (let start = 0; start < count; start += JOIN_BATCH_SIZE) {
    const size = Math.min(JOIN_BATCH_SIZE, count - start);
    const batch = await Promise.all(
      Array.from({ length: size }, (_unused, offset) => join(url, `peer-${start + offset}`, { collectMessages: false })),
    );
    peers.push(...batch);
  }
  return peers;
}

test('backlogged clients may miss states but still receive joined events', { timeout: 25_000 }, async () => {
  let server;
  let slow;
  let witness;
  let eventProof;
  let pausedSocket;
  const peers = [];
  try {
    server = await startServer();
    const url = `ws://127.0.0.1:${server.port}/ws`;
    slow = await join(url, 'slow-client');
    peers.push(...await joinInBatches(url, PLAYER_COUNT));
    witness = await join(url, 'state-witness');

    pausedSocket = slow.ws._socket;
    assert.equal(typeof pausedSocket?.pause, 'function', 'the Node integration client must expose its transport');
    assert.equal(typeof pausedSocket?.resume, 'function', 'the Node integration client must expose its transport');
    assert.equal(typeof pausedSocket?.destroy, 'function', 'the Node integration client must expose transport teardown');
    const slowCheckpoint = slow.messages.length;
    const witnessCheckpoint = witness.messages.length;
    pausedSocket.pause();
    await delay(PAUSE_MS);

    eventProof = await join(url, 'event-proof', { collectMessages: false });
    const resumedAt = Date.now();
    pausedSocket.resume();
    pausedSocket = undefined;

    await waitForMessage(
      slow.messages,
      message => message.t === 'joined' && message.player?.name === 'event-proof',
      4_000,
    );
    await waitUntil(
      () => slow.messages.slice(slowCheckpoint).some(message => message.t === 'states' && message.now >= resumedAt),
      2_000,
      'slow client did not resume periodic state delivery',
    );

    const observedStateFrames = witness.messages.slice(witnessCheckpoint).filter(message => message.t === 'states').length;
    const deliveredStateFrames = slow.messages.slice(slowCheckpoint).filter(message => message.t === 'states').length;
    assert.ok(observedStateFrames > 0, 'an unpaused witness must observe periodic state broadcasts during the backlog window');
    assert.ok(
      deliveredStateFrames < observedStateFrames * 0.8,
      `slow socket received ${deliveredStateFrames}/${observedStateFrames} observed periodic states; states were not dropped under backpressure`,
    );
  } finally {
    if (pausedSocket) {
      pausedSocket.resume();
      pausedSocket.destroy();
    }
    await Promise.allSettled([
      closeSocket(slow?.ws),
      closeSocket(witness?.ws),
      closeSocket(eventProof?.ws),
      ...peers.map(peer => closeSocket(peer.ws)),
    ]);
    await stopServer(server?.child);
  }
});
