import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function freePort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function startServer() {
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
      return { child, port, output: () => output };
    } catch {
      await delay(25);
    }
  }
  await stopServer(child);
  throw new Error(`Server did not listen within 5000ms: ${output}`);
}

export async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = once(child, 'exit');
  await Promise.race([exited, delay(1_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

export async function join(url, name = 'contract') {
  const ws = new WebSocket(url);
  await Promise.race([
    once(ws, 'open'),
    once(ws, 'error').then(([error]) => Promise.reject(error)),
  ]);
  const messages = [];
  ws.on('message', raw => {
    try { messages.push(JSON.parse(raw.toString())); } catch { /* asserted by callers if relevant */ }
  });
  ws.send(JSON.stringify({ t: 'join', name, room: 'contract-room' }));
  const init = await waitForMessage(messages, message => message.t === 'init');
  return { ws, messages, init };
}

export async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = once(ws, 'close');
  ws.close();
  await Promise.race([closed, delay(1_000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

export async function waitForMessage(messages, predicate, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = messages.find(predicate);
    if (found) return found;
    await delay(10);
  }
  assert.fail(`Timed out after ${timeoutMs}ms waiting for protocol message`);
}

export { delay };
