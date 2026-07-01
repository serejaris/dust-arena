// net.js — join-form wiring, connect(), onMsg(), send helpers
import * as THREE from 'three';
import { S, $ } from './state.js';
import './scene.js'; // populates S.camera before the SPECTATE block below can touch it
import { makeRemote, removeRemote, killRemote, flinch, reviveRemote, setRemoteHp, buildMe, swapGun, resetAnim, labelCanvas, TAUNTS } from './entities.js';
import { buildMedkits, buildWeaponSpawns, medkitMeshes, weaponMeshes } from './world.js';
import { curW } from './weapons.js';
import { rebuildRing, tracer } from './fx.js';
import { play, healSound, blip, shotSound, AC } from './audio.js';
import { showMsg, feed, renderScores, sb, teamName, flash, healFlash, hitmark } from './hud.js';
import { resetGun } from './combat.js';

// ---------- net ----------
S.ws = null; S.myId = 0; S.myTeam = 0; S.myHp = 100; S.myKills = 0; S.myDeaths = 0; S.dead = false;
S.roundEndsAt = Date.now() + 60000; S.frozen = false; S.serverOffset = 0;

const params = new URLSearchParams(location.search);
export const SPECTATE = !!params.get('spectate'); // ?spectate=1 — overhead map view, no join
if (SPECTATE) {
  $('join').style.display = 'none';
  $('crosshair').style.display = 'none';
  document.getElementById('c').style.cursor = 'auto';
  S.camera.fov = 50; S.camera.updateProjectionMatrix();
  S.camera.position.set(0, 170, 0.1);
  S.camera.lookAt(0, 0, 0);
}
if (params.get('room')) $('room').value = params.get('room');
$('nick').value = localStorage.getItem('nick') || '';
$('go').onclick = join;
$('nick').addEventListener('keydown', e => e.key === 'Enter' && join());
$('room').addEventListener('keydown', e => e.key === 'Enter' && join());

let myNick = null, myRoom = null, reconnT = null;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  S.ws = new WebSocket(`${proto}://${location.host}`);
  S.ws.onopen = () => S.ws.send(JSON.stringify({ t: 'join', name: myNick, room: myRoom, spectate: SPECTATE || undefined }));
  S.ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  S.ws.onclose = () => { // auto-reconnect with same nick/room; 'init' rebuilds state
    if (!SPECTATE) showMsg('CONNECTION LOST — reconnecting…', 999999);
    clearTimeout(reconnT);
    reconnT = setTimeout(connect, 1500);
  };
}
if (SPECTATE) { // live overhead view: joins as socket-only spectator
  myNick = 'spectator';
  myRoom = (params.get('room') || 'dust').replace(/[^\w-]/g, '') || 'dust';
  connect();
}
function join() {
  if (S.ws) return; // Space on a focused button must not re-join
  $('go').blur();
  myNick = $('nick').value.trim() || 'player' + Math.floor(Math.random() * 99);
  myRoom = ($('room').value.trim() || 'dust').replace(/[^\w-]/g, '') || 'dust';
  localStorage.setItem('nick', myNick);
  history.replaceState(null, '', '?room=' + myRoom);
  connect();
  setInterval(() => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ t: 'ping', ts: performance.now() })); }, 2000);
  $('join').style.display = 'none';
  AC.resume();
}

function snapCamera() {
  S.camTarget.set(S.pos.x, S.pos.y, S.pos.z);
  S.aimPoint.set(S.pos.x, S.pos.y, S.pos.z - 6);
}

function onMsg(m) {
  switch (m.t) {
    case 'init':
      for (const id of [...S.remotes.keys()]) removeRemote(id); // clean slate (reconnect)
      S.dead = false; S.frozen = !!m.frozen; S.myHp = 100;
      $('deathveil').style.opacity = 0;
      showMsg('', 1);
      S.myId = m.id;
      S.pos.set(m.spawn[0], m.spawn[1], m.spawn[2]); S.vel.set(0, 0, 0);
      S.roundEndsAt = m.roundEndsAt; S.serverOffset = m.now - Date.now();
      for (const p of m.players) {
        if (p.id !== S.myId) makeRemote(p);
        else { S.myColor = p.color; S.myTeam = p.team || 0; buildMe(); }
      }
      buildMedkits(m.medkits || []);
      buildWeaponSpawns(m.weapons || []);
      snapCamera();
      break;
    case 'pong':
      $('ping').textContent = Math.round(performance.now() - m.ts) + ' ms';
      break;
    case 'medkit':
      if (medkitMeshes[m.i]) medkitMeshes[m.i].visible = false;
      if (m.id === S.myId) { S.myHp = m.hp; healFlash(); if (!play('medkit', 0.8)) healSound(); }
      break;
    case 'medkitup':
      if (medkitMeshes[m.i]) medkitMeshes[m.i].visible = true;
      break;
    case 'weapon':
      if (weaponMeshes[m.i]) weaponMeshes[m.i].visible = false;
      if (m.id === S.myId) {
        S.myW = m.w; S.curRange = curW().range; rebuildRing();
        S.ammo = curW().mag;
        if (S.me) swapGun(S.me, S.myW);
        if (!play('medkit', 0.6)) blip(); // reuse pickup sfx — no dedicated weapon-pickup sound yet
      } else {
        // snappier than waiting for the next states tick; states still reconciles as the fallback path
        const r = S.remotes.get(m.id);
        if (r && m.w !== r.w) { r.w = m.w; swapGun(r.group, r.w); }
      }
      break;
    case 'weaponup':
      if (weaponMeshes[m.i]) weaponMeshes[m.i].visible = true;
      break;
    case 'joined': makeRemote(m.player); feed(`${m.player.name} joined`); break;
    case 'left': { const r = S.remotes.get(m.id); if (r) feed(`${r.name} left`); removeRemote(m.id); break; }
    case 'states':
      for (const p of m.players) {
        if (p.id === S.myId) { S.myHp = p.hp; S.myKills = p.kills; S.myDeaths = p.deaths; continue; }
        const r = S.remotes.get(p.id);
        if (!r) continue;
        setRemoteHp(r, p.hp); r.kills = p.kills; r.deaths = p.deaths;
        if (p.w !== r.w) { r.w = p.w; swapGun(r.group, r.w); } // missed-event sync (weapon pickup, round-start reset to rifle)
        if (p.dead !== r.dead) { p.dead ? killRemote(r) : reviveRemote(r); } // missed-event sync
        if (p.dead) continue;
        r.buf.push({ time: m.now, x: p.x, y: p.y, z: p.z, ry: p.ry });
        if (r.buf.length > 20) r.buf.shift();
      }
      break;
    case 'shoot': {
      const r = S.remotes.get(m.id);
      if (r && m.o && m.d) {
        const o = new THREE.Vector3(...m.o);
        tracer(o, new THREE.Vector3(...m.d));
        // spatialized: volume by distance to ME (not the camera — it hangs 120 away)
        const ear = S.me ? S.me.position : S.camTarget;
        const dist = ear.distanceTo(o);
        const pan = THREE.MathUtils.clamp((o.x - ear.x) / (dist || 1), -1, 1);
        shotSound(Math.min(0.3, 4 / (dist + 2)), pan);
      }
      break;
    }
    case 'chatping': {
      const r = S.remotes.get(m.id);
      if (r) {
        const tex = new THREE.CanvasTexture(labelCanvas(TAUNTS[m.n] || '...'));
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
        s.scale.set(2.4, 0.45, 1); s.position.y = 2.8;
        r.group.add(s);
        setTimeout(() => { r.group.remove(s); s.material.map.dispose(); s.material.dispose(); }, 2000);
        blip();
        feed(`${r.name}: ${TAUNTS[m.n] || '...'}`);
      }
      break;
    }
    case 'hp':
      if (m.id === S.myId) { S.myHp = m.hp; flash(); S.slowUntil = performance.now() + 450; }
      else { const r = S.remotes.get(m.id); if (r) { setRemoteHp(r, m.hp); flinch(r); } }
      if (m.by === S.myId) hitmark();
      break;
    case 'die': {
      const killer = m.by === S.myId ? 'you' : (S.remotes.get(m.by)?.name || '?');
      const victim = m.id === S.myId ? 'you' : (S.remotes.get(m.id)?.name || '?');
      feed(`${killer} ☠ ${victim}`);
      if (m.id === S.myId) { S.dead = true; S.myHp = 0; showMsg('YOU DIED — respawning…', 2000); flash(); $('deathveil').style.opacity = 1; play('death', 0.8); if (S.me) { S.me.rotation.x = Math.PI / 2; resetAnim(S.me.userData.anim); } }
      else {
        const r = S.remotes.get(m.id);
        if (r) {
          killRemote(r);
          const dist = (S.me ? S.me.position : S.camTarget).distanceTo(r.group.position);
          play('death', Math.min(0.6, 5 / (dist + 2)));
        }
      }
      if (m.by === S.myId) {
        hitmark();
        const banners = { 3: 'ON FIRE!', 5: 'RAMPAGE!', 7: 'GODLIKE!', 10: 'UNSTOPPABLE!' };
        const voices = { 3: 'onfire', 5: 'rampage', 7: 'godlike', 10: 'unstoppable' };
        if (voices[m.streak]) play(voices[m.streak], 0.9);
        showMsg(banners[m.streak] || 'KILL', 1100);
      }
      break;
    }
    case 'respawn':
      if (m.id === S.myId) { S.dead = false; S.myHp = 100; S.pos.set(...m.spawn); S.vel.set(0, 0, 0); $('deathveil').style.opacity = 0; if (S.me) { S.me.rotation.x = 0; resetAnim(S.me.userData.anim); } resetGun(); snapCamera(); }
      else { const r = S.remotes.get(m.id); if (r) { reviveRemote(r); r.group.position.set(...m.spawn); } }
      break;
    case 'roundend': {
      S.frozen = true;
      const tk = m.teamKills || [0, 0];
      const hi = Math.max(tk[0], tk[1]), lo = Math.min(tk[0], tk[1]);
      const txt = m.winTeam === -1 || m.winTeam == null
        ? `ROUND OVER — DRAW ${tk[0]}–${tk[1]}`
        : `ROUND OVER — ${teamName(m.winTeam)} WINS ${hi}–${lo}`;
      showMsg(txt, m.breakMs);
      play('roundover', 0.9);
      sb.style.display = 'block'; renderScores();
      break;
    }
    case 'roundstart':
      S.frozen = false; S.dead = false; S.myHp = 100; S.myKills = 0; S.myDeaths = 0;
      $('deathveil').style.opacity = 0;
      for (const mk of medkitMeshes) mk.visible = true;
      for (const r of S.remotes.values()) reviveRemote(r);
      S.pos.set(...m.spawn); S.vel.set(0, 0, 0);
      if (S.me) { S.me.rotation.x = 0; resetAnim(S.me.userData.anim); }
      resetGun();
      S.roundEndsAt = m.roundEndsAt; S.serverOffset = m.now - Date.now();
      sb.style.display = 'none'; showMsg('ROUND START', 1500);
      play('roundstart', 0.9);
      snapCamera();
      break;
  }
}
