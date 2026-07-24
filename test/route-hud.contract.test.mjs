import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import WebSocket from 'ws';
import { closeSocket, join, startServer, stopServer } from './helpers/server.mjs';

const MAP_SIZE = 180;

async function loadPublicModule(file) {
  const source = await readFile(file, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function loadMinimapPolicy() {
  return loadPublicModule('public/play/js/minimap-policy.js');
}

function wsRejection(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => {
      ws.close();
      reject(new Error(`WebSocket unexpectedly opened at ${url}`));
    });
    ws.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve();
    });
    ws.once('error', () => resolve());
  });
}

async function withServer(run) {
  let server;
  try {
    server = await startServer();
    await run(`http://127.0.0.1:${server.port}`, server.port);
  } finally {
    await stopServer(server?.child);
  }
}

test('HTTP routes cleanly separate the landing page from the game bundle', async () => {
  await withServer(async baseUrl => {
    const landing = await fetch(`${baseUrl}/`);
    assert.equal(landing.status, 200, 'landing route must remain publicly reachable');

    for (const [path, expectedLocation] of [
      ['/play?room=night%20shift', '/play/?room=night%20shift'],
      ['/index.html?ref=legacy', '/?ref=legacy'],
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
      assert.equal(response.status, 308, `${path} must preserve legacy deep links with a permanent redirect`);
      assert.equal(response.headers.get('location'), expectedLocation, `${path} must retain its query while redirecting to the game`);
    }

    for (const path of ['/play/', '/play/js/main.js', '/play/map.json', '/play/sfx/shot.mp3', '/favicon.svg']) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200, `${path} must be served from its migrated public route`);
    }

    for (const path of ['/js/main.js', '/map.json', '/sfx/shot.mp3', '/not-a-route']) {
      const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
      assert.equal(response.status, 404, `${path} must not expose the retired root game surface`);
    }
  });
});

test('the sole WebSocket endpoint accepts joins while the root upgrade is rejected', async () => {
  await withServer(async (_baseUrl, port) => {
    let player;
    try {
      player = await join(`ws://127.0.0.1:${port}/ws`, 'route-contract');
      assert.equal(player.init.t, 'init', 'the dedicated WebSocket endpoint must complete the join protocol');
      assert.ok(player.init.id > 0, 'a joined player must receive an authoritative player id');
      await wsRejection(`ws://127.0.0.1:${port}/`);
    } finally {
      await closeSocket(player?.ws);
    }
  });
});

test('game document exposes input-passive minimap and visibility canvases', async () => {
  await withServer(async baseUrl => {
    const html = await (await fetch(`${baseUrl}/play/`)).text();
    for (const selector of ['data-minimap', 'data-visibility-field']) {
      const match = html.match(new RegExp(`<canvas\\b[^>]*\\b${selector}(?:\\b|=)[^>]*>`, 'i'));
      assert.ok(match, `game HTML must expose a canvas with [${selector}]`);
      assert.match(match[0], /aria-hidden=["']true["']/i, `[${selector}] must not become an assistive-input surface`);
    }
  });
});

test('minimap policy maps world bounds and never leaks forbidden remotes', async () => {
  const { worldToMap, canDrawRemote } = await loadMinimapPolicy();

  for (const { name, world, expected } of [
    { name: 'north-west corner', world: [-75, -75], expected: [0, 0] },
    { name: 'world center', world: [0, 0], expected: [MAP_SIZE / 2, MAP_SIZE / 2] },
    { name: 'south-east corner', world: [75, 75], expected: [MAP_SIZE, MAP_SIZE] },
  ]) {
    const point = worldToMap(world[0], world[1], MAP_SIZE);
    assert.deepEqual([point.x, point.y], expected, `${name} must preserve the tactical map orientation and scale`);
  }

  const teammate = { team: 1, dead: false, visible: false };
  const visibleEnemy = { team: 2, dead: false, visible: true };
  const hiddenEnemy = { team: 2, dead: false, visible: false };
  const deadEnemy = { team: 2, dead: true, visible: true };
  const localAlive = { myTeam: 1, spectator: false, localDead: false };

  assert.equal(canDrawRemote(teammate, localAlive), true, 'teammates must remain available on the minimap despite fog');
  assert.equal(canDrawRemote(visibleEnemy, localAlive), true, 'a living enemy may appear only after the authoritative visibility gate opens');
  assert.equal(canDrawRemote(hiddenEnemy, localAlive), false, 'an enemy without r.visible must stay hidden');
  assert.equal(canDrawRemote({ ...visibleEnemy, visible: 1 }, localAlive), false, 'only the boolean r.visible verdict may reveal an enemy');
  assert.equal(canDrawRemote(deadEnemy, localAlive), false, 'dead enemies must not remain on the minimap');
  assert.equal(canDrawRemote(visibleEnemy, { ...localAlive, localDead: true }), false, 'a dead local player must not retain enemy intel');
  assert.equal(canDrawRemote(visibleEnemy, { ...localAlive, spectator: true }), false, 'spectator mode must not draw enemy intel through the player minimap policy');
});

test('visibility field preserves the live LOS entry boundary', async () => {
  const { isWithinVisibilityField } = await loadPublicModule('public/play/js/vision-policy.js');

  assert.equal(isWithinVisibilityField({ distance: 6, angleDeg: 180 }), true, 'the near-field circle must reveal targets at its inclusive edge');
  assert.equal(isWithinVisibilityField({ distance: 6.01, angleDeg: 60 }), true, 'the fan must reveal a target exactly on the LOS entry seam');
  assert.equal(isWithinVisibilityField({ distance: 6.01, angleDeg: 60.01 }), false, 'a target just outside both near field and fan must remain hidden');
});

test('every delivered pickup projects inside the minimap bounds', async () => {
  const [{ worldToMap }, mapSource] = await Promise.all([
    loadMinimapPolicy(),
    readFile('public/play/map.json', 'utf8'),
  ]);
  const map = JSON.parse(mapSource);
  const pickups = [
    ...map.medkits.map(([x, z]) => ({ kind: 'medkit', x, z })),
    ...map.weaponSpawns.map(({ x, z }) => ({ kind: 'weapon', x, z })),
    ...map.armor.map(([x, z]) => ({ kind: 'armor', x, z })),
    ...map.boosts.map(([x, z]) => ({ kind: 'boost', x, z })),
  ];

  for (const pickup of pickups) {
    const point = worldToMap(pickup.x, pickup.z, MAP_SIZE);
    assert.ok(point.x >= 0 && point.x <= MAP_SIZE, `${pickup.kind} x coordinate must remain inside the minimap`);
    assert.ok(point.y >= 0 && point.y <= MAP_SIZE, `${pickup.kind} y coordinate must remain inside the minimap`);
  }
});
