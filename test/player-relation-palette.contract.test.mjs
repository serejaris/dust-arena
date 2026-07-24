import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const DEPENDENCIES_SLOT = '__playerRelationContractDependencies';

async function loadBrowserModule(file, dependencies, exports) {
  const source = await readFile(file, 'utf8');
  const executable = [
    `const { ${Object.keys(dependencies).join(', ')} } = globalThis.${DEPENDENCIES_SLOT};`,
    source
      .replace(/^import [^;]+;[^\n]*\n/gm, '')
      .replace(/\bexport\s+(?=(?:const|function|class|let|var)\b)/g, ''),
    `export { ${exports.join(', ')} };`,
  ].join('\n');

  globalThis[DEPENDENCIES_SLOT] = dependencies;
  try {
    return await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
  } finally {
    delete globalThis[DEPENDENCIES_SLOT];
  }
}

function entityDependencies() {
  class Geometry {}
  class Material {}
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
    }
  }

  return {
    THREE: {
      BoxGeometry: Geometry,
      Mesh,
      MeshBasicMaterial: Material,
    },
    S: {},
    bloodBurst() {},
    showMsg() {},
    // weapon-mesh.js owns the shared geometry registry and every weapon model; entities.js only
    // hangs the result off the operator, so flat stubs are enough to reach remotePalette.
    sharedGeometries: new WeakSet(),
    sharedBox: () => new Geometry(),
    boxAssembly: () => new Geometry(),
    gunMesh: () => new Mesh(new Geometry(), new Material()),
  };
}

function netDependencies(events) {
  const input = () => ({
    style: {},
    addEventListener() {},
    blur() {},
    value: '',
  });
  const S = {
    remotes: new Map(),
    pos: { set() {} },
    vel: { set() {} },
    camTarget: { set() {} },
    aimPoint: { set() {} },
  };

  return {
    THREE: {},
    S,
    $: input,
    makeRemote(player, relation) { events.push({ type: 'remote', player, relation }); },
    removeRemote() {},
    killRemote() {},
    flinch() {},
    reviveRemote() {},
    setRemoteHp() {},
    buildMe() { events.push({ type: 'self' }); },
    swapGun() {},
    resetAnim() {},
    labelCanvas() {},
    TAUNTS: [],
    triggerRecoil() {},
    buildMedkits() {},
    buildWeaponSpawns() {},
    buildArmor() {},
    buildBoosts() {},
    medkitMeshes: [],
    weaponMeshes: [],
    armorMeshes: [],
    boostMeshes: [],
    curW() { return {}; },
    WEAPONS: [],
    rebuildRing() {},
    tracer() {},
    addShake() {},
    bloodBurst() {},
    SHAKE_MAX: 0,
    play() {},
    healSound() {},
    blip() {},
    shotSound() {},
    resumeAudio() {},
    showMsg() {},
    feed() {},
    flash() {},
    healFlash() {},
    hitmark() {},
    hitDir() {},
    resetGun() {},
    cancelReload() {},
  };
}

test('remote palette preserves teammate and spectator colors while giving normal enemies Dust red', async () => {
  const { remotePalette, hpColor } = await loadBrowserModule(
    'public/play/js/entities.js',
    entityDependencies(),
    ['remotePalette', 'hpColor'],
  );
  const orange = { color: '#d9a24b' };
  const blue = { color: '#4b8bd9' };

  assert.equal(
    remotePalette(orange, { enemy: true, spectator: false }).accent,
    '#a9473f',
    'a normal client must render an enemy with the red combat palette',
  );
  assert.equal(hpColor(100), '#7CFC00', 'a normal enemy’s full health bar must remain relation-neutral green');

  for (const { name, player, relation } of [
    { name: 'teammate', player: blue, relation: { enemy: false, spectator: false } },
    { name: 'spectating orange player', player: orange, relation: { enemy: true, spectator: true } },
    { name: 'spectating blue player', player: blue, relation: { enemy: true, spectator: true } },
  ]) {
    assert.equal(
      remotePalette(player, relation).accent,
      player.color,
      `${name} must retain its authoritative player color`,
    );
    assert.equal(
      hpColor(100),
      '#7CFC00',
      `${name}'s full health bar must remain relation-neutral green`,
    );
  }
});

test('init resolves the local team before constructing remotes and derives each relation from it', async () => {
  const events = [];
  const dependencies = netDependencies(events);
  const previousGlobals = {
    document: globalThis.document,
    history: globalThis.history,
    localStorage: globalThis.localStorage,
    location: globalThis.location,
  };
  Object.assign(globalThis, {
    document: { getElementById() { return { style: {} }; } },
    history: { replaceState() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { search: '', protocol: 'http:', host: 'localhost' },
  });

  try {
    const { onMsg } = await loadBrowserModule('public/play/js/net.js', dependencies, ['onMsg']);
    const enemy = { id: 12, team: 2, color: '#4b8bd9' };
    const self = { id: 7, team: 1, color: '#d9a24b' };
    const teammate = { id: 8, team: 1, color: '#d9a24b' };

    onMsg({
      t: 'init',
      id: self.id,
      now: 1,
      spawn: [0, 0, 0],
      players: [enemy, self, teammate],
      medkits: [],
      weapons: [],
      armor: [],
      boosts: [],
    });

    assert.equal(events[0]?.type, 'self', 'the client must resolve and build itself before constructing any remote');
    assert.deepEqual(
      events.slice(1),
      [
        { type: 'remote', player: enemy, relation: { enemy: true, spectator: false } },
        { type: 'remote', player: teammate, relation: { enemy: false, spectator: false } },
      ],
      'remote relations must use the resolved local team even when the remote packet arrives first',
    );
  } finally {
    for (const [name, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
