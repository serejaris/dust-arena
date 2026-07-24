#!/usr/bin/env node
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import WebSocket from 'ws';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, p) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * p) - 1)];
};

function parseArgs(argv) {
  const options = {
    players: 16,
    warmupMs: 1_000,
    measureMs: 4_000,
    stateHz: 20,
    assertStateHz: null,
    assertRttP95Ms: null,
    assertAverageStateBytes: null,
  };
  const names = new Map([
    ['--players', 'players'],
    ['--warmup-ms', 'warmupMs'],
    ['--measure-ms', 'measureMs'],
    ['--state-hz', 'stateHz'],
    ['--assert-state-hz', 'assertStateHz'],
    ['--assert-rtt-p95-ms', 'assertRttP95Ms'],
    ['--assert-average-state-bytes', 'assertAverageStateBytes'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help') {
      console.log('Usage: npm run perf:ws -- --players N --warmup-ms N --measure-ms N --state-hz N [--assert-state-hz N] [--assert-rtt-p95-ms N] [--assert-average-state-bytes N]');
      process.exit(0);
    }
    const key = names.get(flag);
    if (!key) throw new Error(`Unknown option: ${flag}`);
    const value = Number(argv[index + 1]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive number`);
    options[key] = value;
    index += 1;
  }
  if (!Number.isInteger(options.players)) throw new Error('--players must be an integer');
  return options;
}

async function freePort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(1_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before listening (${child.exitCode}): ${output}`);
    try {
      const probe = net.connect({ host: '127.0.0.1', port });
      await Promise.race([
        once(probe, 'connect'),
        once(probe, 'error').then(([error]) => Promise.reject(error)),
      ]);
      probe.destroy();
      return { child, port };
    } catch {
      await sleep(25);
    }
  }
  await stopServer(child);
  throw new Error(`Server did not listen within 5000ms: ${output}`);
}

async function closeClient(client) {
  if (!client || client.ws.readyState === WebSocket.CLOSED) return;
  const closed = once(client.ws, 'close');
  client.ws.close();
  await Promise.race([closed, sleep(1_000)]);
  if (client.ws.readyState !== WebSocket.CLOSED) client.ws.terminate();
}

async function connectClient(url, index, active, clients) {
  const ws = new WebSocket(url);
  const client = { index, ws, init: null, stateCount: 0, stateBytes: 0, rtts: [], stateIntervals: [], firstStateAt: null, lastStateAt: null };
  clients.push(client);
  let protocolError = null;
  ws.on('error', error => { protocolError ??= error; });
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch {
      protocolError ??= new Error(`Client ${index} received invalid JSON`);
      return;
    }
    if (message.t === 'init') {
      client.init = message;
      return;
    }
    if (message.t === 'pong' && active.measuring) {
      const rtt = performance.now() - message.ts;
      if (Number.isFinite(rtt) && rtt >= 0) client.rtts.push(rtt);
      return;
    }
    if (message.t !== 'states') return;
    if (!Array.isArray(message.players)) {
      protocolError ??= new Error(`Client ${index} received states.players that is not an array`);
      return;
    }
    for (const row of message.players) {
      if (!Array.isArray(row) || row.length !== 11 || row.includes('rx')) {
        protocolError ??= new Error(`Client ${index} received a non-compact state row`);
        return;
      }
    }
    if (active.measuring) {
      const receivedAt = performance.now();
      if (client.firstStateAt === null) client.firstStateAt = receivedAt;
      if (client.lastStateAt !== null) client.stateIntervals.push(receivedAt - client.lastStateAt);
      client.lastStateAt = receivedAt;
      client.stateCount += 1;
      client.stateBytes += Buffer.byteLength(raw);
    }
  });
  await Promise.race([
    once(ws, 'open'),
    once(ws, 'error').then(([error]) => Promise.reject(error)),
  ]);
  ws.send(JSON.stringify({ t: 'join', name: `load-${index}`, room: 'ws-load' }));
  const deadline = Date.now() + 3_000;
  while (!client.init && !protocolError && Date.now() < deadline) await sleep(5);
  if (protocolError) throw protocolError;
  if (!client.init) throw new Error(`Client ${index} did not receive init within 3000ms`);
  return { client, protocolError: () => protocolError };
}

function assertThresholds(metrics, options) {
  const failures = [];
  if (options.assertStateHz !== null && metrics.stateHz.min < options.assertStateHz) {
    failures.push(`min state Hz ${metrics.stateHz.min.toFixed(2)} < ${options.assertStateHz}`);
  }
  if (options.assertRttP95Ms !== null && (metrics.rtt.p95 === null || metrics.rtt.p95 > options.assertRttP95Ms)) {
    failures.push(`RTT p95 ${metrics.rtt.p95 === null ? 'n/a' : metrics.rtt.p95.toFixed(2)}ms > ${options.assertRttP95Ms}ms`);
  }
  if (options.assertAverageStateBytes !== null && metrics.stateBytes.average > options.assertAverageStateBytes) {
    failures.push(`average state bytes ${metrics.stateBytes.average.toFixed(2)} > ${options.assertAverageStateBytes}`);
  }
  if (failures.length) throw new Error(`Load assertions failed: ${failures.join('; ')}`);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  let server;
  const clients = [];
  const intervals = [];
  const active = { measuring: false };
  const loopDelay = monitorEventLoopDelay({ resolution: 1 });
  try {
    server = await startServer();
    const url = `ws://127.0.0.1:${server.port}/ws`;
    const connections = await Promise.all(Array.from({ length: options.players }, (_, index) => connectClient(url, index, active, clients)));

    for (const client of clients) {
      let tick = 0;
      intervals.push(setInterval(() => {
        if (client.ws.readyState !== WebSocket.OPEN) return;
        tick += 1;
        const x = ((tick + client.index * 13) % 100) - 50;
        const z = ((tick * 3 + client.index * 7) % 100) - 50;
        client.ws.send(JSON.stringify({ t: 'state', x, y: 0, z, ry: (tick % 628) / 100 }));
      }, 1_000 / options.stateHz));
      intervals.push(setInterval(() => {
        if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
      }, 100));
    }

    await sleep(options.warmupMs);
    for (const client of clients) {
      client.stateCount = 0;
      client.stateBytes = 0;
      client.rtts = [];
      client.stateIntervals = [];
      client.firstStateAt = null;
      client.lastStateAt = null;
    }
    loopDelay.enable();
    loopDelay.reset();
    active.measuring = true;
    await sleep(options.measureMs);
    active.measuring = false;
    loopDelay.disable();

    const errors = connections.map(connection => connection.protocolError()).filter(Boolean);
    if (errors.length) throw errors[0];
    const perClientHz = clients.map(client => {
      const durationMs = client.lastStateAt - client.firstStateAt;
      return client.stateCount > 1 && durationMs > 0 ? (client.stateCount - 1) / (durationMs / 1_000) : 0;
    });
    const allRtts = clients.flatMap(client => client.rtts);
    const allStateIntervals = clients.flatMap(client => client.stateIntervals);
    const aggregateStateBytes = clients.reduce((total, client) => total + client.stateBytes, 0);
    const aggregateStates = clients.reduce((total, client) => total + client.stateCount, 0);
    const metrics = {
      players: options.players,
      warmupMs: options.warmupMs,
      measureMs: options.measureMs,
      requestedStateHz: options.stateHz,
      stateHz: {
        perClient: perClientHz,
        min: Math.min(...perClientHz),
        average: perClientHz.reduce((total, value) => total + value, 0) / perClientHz.length,
      },
      rtt: {
        samples: allRtts.length,
        p50: percentile(allRtts, 0.50),
        p95: percentile(allRtts, 0.95),
        p99: percentile(allRtts, 0.99),
        max: allRtts.length ? Math.max(...allRtts) : null,
      },
      eventLoopDelayMs: {
        scope: 'load-harness process',
        p50: loopDelay.percentile(50) / 1e6,
        p95: loopDelay.percentile(95) / 1e6,
        p99: loopDelay.percentile(99) / 1e6,
      },
      serverStateCadenceMs: {
        scope: 'external per-client states arrival (server tick plus local transport)',
        samples: allStateIntervals.length,
        p50: percentile(allStateIntervals, 0.50),
        p95: percentile(allStateIntervals, 0.95),
        p99: percentile(allStateIntervals, 0.99),
      },
      stateBytes: {
        aggregate: aggregateStateBytes,
        average: aggregateStates ? aggregateStateBytes / aggregateStates : 0,
        messages: aggregateStates,
      },
    };
    assertThresholds(metrics, options);
    console.log(JSON.stringify({ ok: true, metrics }, null, 2));
  } finally {
    active.measuring = false;
    loopDelay.disable();
    for (const interval of intervals) clearInterval(interval);
    await Promise.allSettled(clients.map(closeClient));
    await stopServer(server?.child);
  }
}

run().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
