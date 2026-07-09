const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TICK_MS = 50;            // 20 Hz state broadcast
const RESPAWN_MS = 2000;       // snappier respawn keeps the short round flowing
const MAX_HP = 100;
const MEDKIT_HEAL = 50;
const MEDKIT_RESPAWN_MS = 25000;
const SPAWN_PROT_MS = 1500;
const ARMOR_MAX = 50;
const ARMOR_RESPAWN_MS = 25000;
const BOOST_MS = 8000;          // client-applied speed buff duration — server only gates the pickup/respawn
const BOOST_RESPAWN_MS = 20000;
// weapon table — single source of truth for dmg/fireMs/range/mag. id = index, id 0 = default spawn (not a pickup).
const WEAPONS = [
  { id: 0, name: 'rifle',   dmg: 18,  fireMs: 110,  range: 40, mag: 30  },
  { id: 1, name: 'smg',     dmg: 12,  fireMs: 70,   range: 30, mag: 40  },
  { id: 2, name: 'deagle',  dmg: 50,  fireMs: 350,  range: 36, mag: 7   },
  { id: 3, name: 'shotgun', dmg: 65,  fireMs: 650,  range: 14, mag: 6   },
  { id: 4, name: 'awp',     dmg: 100, fireMs: 1500, range: 62, mag: 5   },
  { id: 5, name: 'lmg',     dmg: 16,  fireMs: 90,   range: 38, mag: 100 },
];
const WEAPON_RESPAWN_MS = 20000;
const RANGE_SLACK = 6; // дальность hit-чека = wpn.range + slack (запас на движение с прошлого state)

// single source of truth — same file the client renders (map v3, gen_map.py)
const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'map.json'), 'utf8'));
const MEDKITS = MAP.medkits;   // [x, z]
const SPAWNS = MAP.spawns;     // [x, y, z] — first half = T (south +1.5 plateau), second = CT (north)
const WEAPON_SPAWNS = MAP.weaponSpawns || []; // [{x, z, w}] — 5 pickup points, w = 1..5
const ARMOR_SPAWNS = MAP.armor || [];   // [[x, z, y]] — same shape as medkits
const BOOST_SPAWNS = MAP.boosts || [];  // [[x, z, y]] — same shape as medkits

// teams: 0 = T (warm), 1 = CT (cool). spawns split T/CT, colors shaded so teammates differ.
const HALF = Math.floor(SPAWNS.length / 2);
const SPAWN_POOLS = [SPAWNS.slice(0, HALF), SPAWNS.slice(HALF)];
const TEAM_COLORS = [
  ['#d9a24b', '#e0b85f', '#c98a3a'], // T — sand / gold / amber
  ['#4b8bd9', '#5fa0e0', '#3a6fc9'], // CT — sky / steel / cobalt
];

const app = express();
app.use(require('compression')());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (file.endsWith('.mp3') || file.endsWith('.svg')) res.setHeader('Cache-Control', 'public, max-age=86400');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// drop dead sockets so ghost players don't linger in rooms
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

const rooms = new Map(); // name -> Room
let nextId = 1;

function getRoom(name) {
  let room = rooms.get(name);
  if (!room) {
    room = {
      name,
      players: new Map(), // id -> player
      sockets: new Map(), // id -> ws
      nextTeam: 0,        // tie-break toggle for balanced team assignment
      medkits: MEDKITS.map(() => ({ downUntil: 0 })),
      weapons: WEAPON_SPAWNS.map(() => ({ downUntil: 0 })),
      armor: ARMOR_SPAWNS.map(() => ({ downUntil: 0 })),
      boosts: BOOST_SPAWNS.map(() => ({ downUntil: 0 })),
    };
    rooms.set(name, room);
  }
  return room;
}

function broadcast(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const [id, ws] of room.sockets) {
    if (id !== exceptId && ws.readyState === 1) ws.send(data);
  }
}
const STATE_BACKPRESSURE_LIMIT = 256 * 1024;

function broadcastStates(room, msg) {
  const data = JSON.stringify(msg);
  for (const ws of room.sockets.values()) {
    if (ws.readyState === 1 && ws.bufferedAmount <= STATE_BACKPRESSURE_LIMIT) ws.send(data);
  }
}

// balance new joiners into the smaller team; alternate on a tie
function pickTeam(room) {
  let c0 = 0, c1 = 0;
  for (const p of room.players.values()) (p.team === 0 ? c0++ : c1++);
  if (c0 < c1) return 0;
  if (c1 < c0) return 1;
  const t = room.nextTeam; room.nextTeam = t ^ 1; return t;
}

// spawn on your own side, farthest from ENEMIES (teammates don't push you off)
function pickSpawn(room, me, team) {
  const pool = SPAWN_POOLS[team] && SPAWN_POOLS[team].length ? SPAWN_POOLS[team] : SPAWNS;
  let best = [], bd = -1;
  for (const s of pool) {
    let d = 1e9;
    for (const p of room.players.values()) {
      if (p.dead || p === me || p.team === team) continue; // distance to enemies only
      const dx = p.x - s[0], dz = p.z - s[2];
      d = Math.min(d, dx * dx + dz * dz);
    }
    if (d > bd + 1) { bd = d; best = [s]; }
    else if (d > bd - 1) best.push(s);
  }
  return best[Math.floor(Math.random() * best.length)] || pool[0];
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, color: p.color, team: p.team,
    x: p.x, y: p.y, z: p.z, ry: p.ry,
    hp: p.hp, kills: p.kills, deaths: p.deaths, dead: p.dead, w: p.w, armor: p.armor,
  };
}


wss.on('connection', (ws) => {
  let player = null;
  let room = null;
  let spectId = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => ws.terminate()); // ECONNRESET etc must not crash the process

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', ts: msg.ts })); return; }

    if (msg.t === 'join' && !player && !spectId) {
      const roomName = String(msg.room || 'dust').slice(0, 24).replace(/[^\w-]/g, '') || 'dust';
      const name = String(msg.name || 'player').slice(0, 16) || 'player';
      room = getRoom(roomName);
      if (msg.spectate) { // socket-only spectator: receives broadcasts, owns no player
        spectId = nextId++;
        room.sockets.set(spectId, ws);
        ws.send(JSON.stringify({
          t: 'init', id: 0, spawn: [0, 0, 0],
          players: [...room.players.values()].map(publicPlayer),
          medkits: room.medkits.map(m => m.downUntil > Date.now() ? 0 : 1),
          weaponSpawns: WEAPON_SPAWNS.map(s => ({ x: s.x, z: s.z, w: s.w })),
          weapons: room.weapons.map(m => m.downUntil > Date.now() ? 0 : 1),
          armor: room.armor.map(a => a.downUntil > Date.now() ? 0 : 1),
          boosts: room.boosts.map(b => b.downUntil > Date.now() ? 0 : 1),
          now: Date.now(),
        }));
        return;
      }
      const team = pickTeam(room);
      const shade = [...room.players.values()].filter(p => p.team === team).length % TEAM_COLORS[team].length;
      const [sx, sy, sz] = pickSpawn(room, null, team);
      player = {
        id: nextId++, name, team,
        color: TEAM_COLORS[team][shade],
        x: sx, y: sy, z: sz, ry: 0,
        hp: MAX_HP, kills: 0, deaths: 0, dead: false,
        protUntil: Date.now() + SPAWN_PROT_MS,
        w: 0, armor: 0,
      };
      room.players.set(player.id, player);
      room.sockets.set(player.id, ws);
      ws.send(JSON.stringify({
        t: 'init', id: player.id, spawn: [sx, sy, sz],
        players: [...room.players.values()].map(publicPlayer),
        medkits: room.medkits.map(m => m.downUntil > Date.now() ? 0 : 1),
        weaponSpawns: WEAPON_SPAWNS.map(s => ({ x: s.x, z: s.z, w: s.w })),
        weapons: room.weapons.map(m => m.downUntil > Date.now() ? 0 : 1),
        armor: room.armor.map(a => a.downUntil > Date.now() ? 0 : 1),
        boosts: room.boosts.map(b => b.downUntil > Date.now() ? 0 : 1),
        now: Date.now(),
      }));
      broadcast(room, { t: 'joined', player: publicPlayer(player) }, player.id);
      return;
    }
    if (!player || !room) return;

    switch (msg.t) {
      case 'state': {
        if (player.dead) break;
        if (Date.now() < (player.ignoreStateUntil || 0)) break; // server just teleported them
        const nx = +msg.x, ny = +msg.y, nz = +msg.z;
        if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) break;
        player.x = Math.max(-72.5, Math.min(72.5, nx));
        player.y = Math.max(0, Math.min(6, ny));
        player.z = Math.max(-72.5, Math.min(72.5, nz));
        player.ry = +msg.ry || 0;
        if (player.hp < MAX_HP) {
          for (let i = 0; i < MEDKITS.length; i++) {
            const mk = room.medkits[i];
            if (!mk || mk.downUntil) continue;
            const [mx, mz, my] = MEDKITS[i];
            const dx = player.x - mx, dz = player.z - mz, dy = player.y - (my || 0);
            if (dx * dx + dz * dz < 2.2 && Math.abs(dy) < 1.6) {
              mk.downUntil = Date.now() + MEDKIT_RESPAWN_MS;
              player.hp = Math.min(MAX_HP, player.hp + MEDKIT_HEAL);
              broadcast(room, { t: 'medkit', i, id: player.id, hp: player.hp });
              break;
            }
          }
        }
          for (let i = 0; i < WEAPON_SPAWNS.length; i++) {
            const mk = room.weapons[i];
            if (!mk || mk.downUntil) continue;
            const dx = player.x - WEAPON_SPAWNS[i].x, dz = player.z - WEAPON_SPAWNS[i].z;
            if (dx * dx + dz * dz < 2.2) {
              mk.downUntil = Date.now() + WEAPON_RESPAWN_MS;
              player.w = WEAPON_SPAWNS[i].w;
              broadcast(room, { t: 'weapon', i, id: player.id, w: player.w });
              break;
            }
          }
          for (let i = 0; i < ARMOR_SPAWNS.length; i++) {
            const ak = room.armor[i];
            if (!ak || ak.downUntil) continue;
            const [ax, az, ay] = ARMOR_SPAWNS[i];
            const dx = player.x - ax, dz = player.z - az, dy = player.y - (ay || 0);
            if (dx * dx + dz * dz < 2.2 && Math.abs(dy) < 1.6) {
              ak.downUntil = Date.now() + ARMOR_RESPAWN_MS;
              player.armor = ARMOR_MAX;
              broadcast(room, { t: 'armorpk', i, id: player.id, armor: player.armor });
              break;
            }
          }
          for (let i = 0; i < BOOST_SPAWNS.length; i++) {
            const bk = room.boosts[i];
            if (!bk || bk.downUntil) continue;
            const [bx, bz, by] = BOOST_SPAWNS[i];
            const dx = player.x - bx, dz = player.z - bz, dy = player.y - (by || 0);
            if (dx * dx + dz * dz < 2.2 && Math.abs(dy) < 1.6) {
              bk.downUntil = Date.now() + BOOST_RESPAWN_MS;
              broadcast(room, { t: 'boostpk', i, id: player.id, until: Date.now() + BOOST_MS });
              break;
            }
          }
        break;
      }
      case 'shoot': { // tracer/sound relay — capped & validated (broadcast amplification)
        const now = Date.now();
        if (player.dead || now - (player.lastShootMsg || 0) < 100) break;
        const vec3 = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
        if (!vec3(msg.o) || !vec3(msg.d)) break;
        player.lastShootMsg = now;
        broadcast(room, { t: 'shoot', id: player.id, o: msg.o, d: msg.d, w: player.w }, player.id);
        break;
      }
      case 'hit': {
        const now = Date.now();
        const target = room.players.get(+msg.target);
        if (!target || target.dead || player.dead) break;
        if (target.team === player.team) break; // no friendly fire
        if (now < target.protUntil) break;
        const wpn = WEAPONS[player.w] || WEAPONS[0]; // authoritative — server ignores msg.w, trusts only what it handed out
        // server-side range check: wpn.range + slack for movement since last state
        const dx = target.x - player.x, dz = target.z - player.z;
        if (dx * dx + dz * dz > (wpn.range + RANGE_SLACK) * (wpn.range + RANGE_SLACK)) break;
        // leaky bucket: ~fireMs average, absorbs 2-3 packet bursts from TCP jitter
        const nextHit = Math.max(player.nextHit || 0, now - 240) + wpn.fireMs;
        if (nextHit > now + 240) break;
        player.nextHit = nextHit;
        let dmg = wpn.dmg;
        if (target.armor > 0) { // armor eats damage first, HP untouched while it lasts
          const abs = Math.min(target.armor, dmg);
          target.armor -= abs; dmg -= abs;
        }
        target.hp -= dmg;
        if (target.hp <= 0) {
          target.hp = 0; target.dead = true; target.armor = 0;
          target.deaths++; player.kills++;
          player.streak = (player.streak || 0) + 1;
          target.streak = 0;
          broadcast(room, { t: 'die', id: target.id, by: player.id, streak: player.streak });
          setTimeout(() => {
            if (!room.players.has(target.id)) return;
            const [sx, sy, sz] = pickSpawn(room, target, target.team);
            target.hp = MAX_HP; target.dead = false; target.armor = 0;
            target.protUntil = Date.now() + SPAWN_PROT_MS;
            target.w = 0;
            target.x = sx; target.y = sy; target.z = sz;
            target.ignoreStateUntil = Date.now() + 300; // drop stale pre-respawn echoes
            broadcast(room, { t: 'respawn', id: target.id, spawn: [sx, sy, sz] });
          }, RESPAWN_MS);
        } else {
          broadcast(room, { t: 'hp', id: target.id, hp: target.hp, armor: target.armor, by: player.id });
        }
        break;
      }
      case 'chatping': {
        const now = Date.now();
        if (now - (player.lastTaunt || 0) < 1200) break; // cooldown is server-enforced too
        player.lastTaunt = now;
        broadcast(room, { t: 'chatping', id: player.id, n: +msg.n || 0 }, player.id);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    if (spectId) room.sockets.delete(spectId);
    if (player) {
      room.players.delete(player.id);
      room.sockets.delete(player.id);
      broadcast(room, { t: 'left', id: player.id });
    }
    if (room.players.size === 0 && room.sockets.size === 0) rooms.delete(room.name);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    // medkit respawns
    for (let i = 0; i < room.medkits.length; i++) {
      const mk = room.medkits[i];
      if (mk.downUntil && now >= mk.downUntil) { mk.downUntil = 0; broadcast(room, { t: 'medkitup', i }); }
    }
    // weapon respawns
    for (let i = 0; i < room.weapons.length; i++) {
      const wk = room.weapons[i];
      if (wk.downUntil && now >= wk.downUntil) { wk.downUntil = 0; broadcast(room, { t: 'weaponup', i }); }
    }
    // armor respawns
    for (let i = 0; i < room.armor.length; i++) {
      const ak = room.armor[i];
      if (ak.downUntil && now >= ak.downUntil) { ak.downUntil = 0; broadcast(room, { t: 'armorup', i }); }
    }
    // boost respawns
    for (let i = 0; i < room.boosts.length; i++) {
      const bk = room.boosts[i];
      if (bk.downUntil && now >= bk.downUntil) { bk.downUntil = 0; broadcast(room, { t: 'boostup', i }); }
    }
    // state tick
    if (room.players.size > 0) {
      broadcastStates(room, {
        t: 'states', now,
        players: [...room.players.values()].map(p => [p.id, p.x, p.y, p.z, p.ry, p.hp, p.dead ? 1 : 0, p.kills, p.deaths, p.w, p.armor]),
      });
    }
  }
}, TICK_MS);

server.listen(PORT, () => console.log(`dust-arena listening on :${PORT}`));
