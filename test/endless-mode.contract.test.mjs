import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { closeSocket, delay, join, startServer, stopServer, waitForMessage } from './helpers/server.mjs';

const ROUND_LIFECYCLE = /\b(?:roundEndsAt|roundstart|roundend|roundover|ROUND_MS|ROUND_BREAK_MS|breakUntil|frozen)\b/;

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  }));
  return nested.flat();
}

test('endless protocol sends a clock-synced init and compact periodic state rows', async () => {
  let server;
  let first;
  let second;
  try {
    server = await startServer();
    const url = `ws://127.0.0.1:${server.port}/ws`;
    first = await join(url, 'first');
    second = await join(url, 'second');

    assert.equal(typeof first.init.now, 'number', 'init must include server time for serverOffset');
    assert.ok(Number.isFinite(first.init.now));
    assert.equal('roundEndsAt' in first.init, false, 'init must not expose a round deadline');
    assert.equal('frozen' in first.init, false, 'init must not expose round-break state');

    const states = await waitForMessage(second.messages, message => message.t === 'states');
    assert.ok(Array.isArray(states.players), 'states.players must be an array');
    assert.equal(states.players.length, 2, 'periodic state includes every room player');
    for (const row of states.players) {
      assert.ok(Array.isArray(row), 'periodic player records must be compact arrays, not objects');
      assert.equal(row.length, 11, 'compact state row is [id,x,y,z,ry,hp,dead01,kills,deaths,w,armor]');
      assert.equal(row.includes('rx'), false, 'compact state rows must not carry rx');
      assert.equal(typeof row[0], 'number', 'row id must be numeric');
      assert.equal(typeof row[6], 'number', 'dead01 must be numeric');
      assert.ok(row[6] === 0 || row[6] === 1, 'dead01 must be 0 or 1');
    }

    await delay(250);
    for (const message of second.messages) {
      assert.notEqual(message.t, 'roundstart');
      assert.notEqual(message.t, 'roundend');
    }
  } finally {
    await Promise.allSettled([closeSocket(first?.ws), closeSocket(second?.ws)]);
    await stopServer(server?.child);
  }
});

test('round lifecycle identifiers are absent from the server and browser source', async () => {
  const files = ['server.js', 'public/play/index.html', ...(await sourceFiles('public/play/js')).filter(file => file.endsWith('.js'))];
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const match = source.match(ROUND_LIFECYCLE);
    if (match) violations.push(`${file}: ${match[0]}`);
  }
  assert.deepEqual(violations, [], 'clean cutover must remove the round lifecycle rather than retain aliases');
});

test('HUD has team score but no round timer element', async () => {
  const html = await readFile('public/play/index.html', 'utf8');
  assert.doesNotMatch(html, /id=["']timer["']/i, 'round timer HUD element must be removed');
  assert.match(html, /id=["']team-score["']/i, 'HUD must provide the team score element');
});

test('backpressure is restricted to periodic states, never event broadcasts', async () => {
  const source = await readFile('server.js', 'utf8');
  const eventBroadcast = source.slice(source.indexOf('function broadcast('), source.indexOf('function broadcastStates('));
  const stateBroadcast = source.slice(source.indexOf('function broadcastStates('), source.indexOf('// balance new joiners'));
  assert.match(eventBroadcast, /ws\.send\(data\)/, 'events must retain a direct broadcast send path');
  assert.doesNotMatch(eventBroadcast, /bufferedAmount/, 'event broadcasts must never be dropped for backpressure');
  assert.match(stateBroadcast, /bufferedAmount\s*<=\s*STATE_BACKPRESSURE_LIMIT/, 'only periodic states may be dropped for backpressure');
});
