// net.js — join-form wiring, connect(), onMsg(), send helpers
import * as THREE from 'three';
import { S, $ } from './state.js';
import './scene.js'; // populates S.camera before the SPECTATE block below can touch it
import { makeRemote, removeRemote, killRemote, flinch, reviveRemote, setRemoteHp, buildMe, swapGun, resetAnim, labelCanvas, TAUNTS, triggerRecoil } from './entities.js';
import { buildMedkits, buildWeaponSpawns, buildArmor, buildBoosts, medkitMeshes, weaponMeshes, armorMeshes, boostMeshes } from './world.js';
import { curW, WEAPONS } from './weapons.js';
import { rebuildRing, tracer, addShake, bloodBurst, SHAKE_MAX } from './fx.js';
import { play, healSound, blip, shotSound, resumeAudio } from './audio.js';
import { showMsg, feed, flash, healFlash, hitmark, hitDir } from './hud.js';
import { resetGun, cancelReload } from './combat.js';

// ---------- net ----------
S.ws = null; S.myId = 0; S.myTeam = 0; S.myHp = 100; S.myKills = 0; S.myDeaths = 0; S.dead = false;
S.serverOffset = 0;

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
  resumeAudio();
}

function snapCamera() {
  S.camTarget.set(S.pos.x, S.pos.y, S.pos.z);
  S.aimPoint.set(S.pos.x, S.pos.y, S.pos.z - 6);
}

// victim-side hit feedback (#5): screen shake + directional indicator + knockback, scaled by the
// attacker's current weapon dmg. Attacker is always in S.remotes for the victim — server disallows
// friendly fire, so m.by can never be S.myId here.
const KNOCKBACK_MAX = 3.2; // world units/s impulse at max weapon dmg; physics.js kbFriction bleeds it off fast
function victimImpact(attackerId, lethal = false) {
  const attacker = S.remotes.get(attackerId);
  const dmg = attacker ? (WEAPONS[attacker.w]?.dmg ?? 18) : 18;
  const frac = Math.min(1, dmg / 100);
  addShake(lethal ? SHAKE_MAX : SHAKE_MAX * frac);
  if (!attacker) return;
  // vector FROM me TO the attacker — the indicator points toward the source of the hit
  const tx = attacker.group.position.x - S.pos.x, tz = attacker.group.position.z - S.pos.z;
  const len = Math.hypot(tx, tz) || 1;
  hitDir(Math.atan2(tx / len, -tz / len) * 180 / Math.PI); // bearing: 0=up(-Z), clockwise, since camera never yaws
  if (!lethal) { // dead player's movement is gated off client-side — a corpse-nudge would be inert
    S.vel.x -= (tx / len) * KNOCKBACK_MAX * frac;
    S.vel.z -= (tz / len) * KNOCKBACK_MAX * frac;
  }
}

function onMsg(m) {
  switch (m.t) {
    case 'init':
      for (const id of [...S.remotes.keys()]) removeRemote(id); // clean slate (reconnect)
      S.dead = false; S.myHp = 100; S.myArmor = 0; S.boostUntil = 0;
      // reconnect = a brand new player server-side (join always hands out w:0/fresh ammo — server
      // has no "same player" concept to resume), but S.myW/S.ammo/S.curRange are stale from the old
      // life; without this, buildMe() below renders the old weapon while the server authoritatively
      // treats every hit as rifle damage (axis 3: no feature field left unreset)
      resetGun();
      $('deathveil').style.opacity = 0;
      showMsg('', 1);
      S.myId = m.id;
      S.pos.set(m.spawn[0], m.spawn[1], m.spawn[2]); S.vel.set(0, 0, 0);
      S.serverOffset = m.now - Date.now();
      for (const p of m.players) {
        if (p.id !== S.myId) makeRemote(p);
        else { S.myColor = p.color; S.myTeam = p.team || 0; buildMe(); }
      }
      buildMedkits(m.medkits || []);
      buildWeaponSpawns(m.weapons || []);
      buildArmor(m.armor || []);
      buildBoosts(m.boosts || []);
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
    case 'armorpk':
      if (armorMeshes[m.i]) armorMeshes[m.i].visible = false;
      if (m.id === S.myId) { S.myArmor = m.armor; if (!play('medkit', 0.7)) blip(); }
      break;
    case 'armorup':
      if (armorMeshes[m.i]) armorMeshes[m.i].visible = true;
      break;
    case 'boostpk':
      if (boostMeshes[m.i]) boostMeshes[m.i].visible = false;
      if (m.id === S.myId) { S.boostUntil = m.until; if (!play('medkit', 0.7)) blip(); }
      break;
    case 'boostup':
      if (boostMeshes[m.i]) boostMeshes[m.i].visible = true;
      break;
    case 'joined': makeRemote(m.player); feed(`${m.player.name} joined`); break;
    case 'left': { const r = S.remotes.get(m.id); if (r) feed(`${r.name} left`); removeRemote(m.id); break; }
    case 'states':
      for (const [id, x, y, z, ry, hp, dead01, kills, deaths, w, armor] of m.players) {
        if (id === S.myId) { S.myHp = hp; S.myArmor = armor || 0; S.myKills = kills; S.myDeaths = deaths; continue; }
        const r = S.remotes.get(id);
        if (!r) continue;
        setRemoteHp(r, hp); r.kills = kills; r.deaths = deaths;
        if (w !== r.w) { r.w = w; swapGun(r.group, r.w); } // missed-event sync (weapon pickup)
        const dead = dead01 === 1;
        if (dead !== r.dead) { dead ? killRemote(r) : reviveRemote(r); } // missed-event sync
        if (dead) continue;
        r.buf.push({ time: m.now, x, y, z, ry });
        if (r.buf.length > 20) r.buf.shift();
      }
      break;
    case 'shoot': {
      const r = S.remotes.get(m.id);
      if (r) {
        triggerRecoil(r.group.userData.anim); // shooter's gun kicks regardless of tracer geometry below
        if (m.o && m.d) {
          const o = new THREE.Vector3(...m.o);
          if (r.visible) tracer(o, new THREE.Vector3(...m.d)); // fog (#1): hidden shooter's tracer stays hidden, sound below doesn't
          // spatialized: volume by distance to ME (not the camera — it hangs 120 away)
          const ear = S.me ? S.me.position : S.camTarget;
          const dist = ear.distanceTo(o);
          const pan = THREE.MathUtils.clamp((o.x - ear.x) / (dist || 1), -1, 1);
          shotSound(Math.min(0.3, 4 / (dist + 2)), pan);
        }
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
      if (m.id === S.myId) {
        S.myHp = m.hp; S.myArmor = m.armor || 0; flash(); S.slowUntil = performance.now() + 450; if (S.me) flinch(S.me);
        bloodBurst(new THREE.Vector3(S.pos.x, S.pos.y + 1.2, S.pos.z));
        victimImpact(m.by);
      }
      else { const r = S.remotes.get(m.id); if (r) { setRemoteHp(r, m.hp); flinch(r.group); if (r.visible) bloodBurst(r.group.position.clone().add(new THREE.Vector3(0, 1.2, 0))); } } // fog (#1): blood on a hidden enemy would leak their position
      if (m.by === S.myId) hitmark(WEAPONS[S.myW]?.dmg);
      break;
    case 'die': {
      const killer = m.by === S.myId ? 'you' : (S.remotes.get(m.by)?.name || '?');
      const victim = m.id === S.myId ? 'you' : (S.remotes.get(m.id)?.name || '?');
      feed(`${killer} ☠ ${victim}`);
      if (m.id === S.myId) {
        S.dead = true; S.myHp = 0; S.myArmor = 0; S.boostUntil = 0; showMsg('YOU DIED — respawning…', 2000); flash(); $('deathveil').style.opacity = 1; play('death', 0.8); cancelReload(); if (S.me) resetAnim(S.me.userData.anim); // deathT=0 → tick()'s advanceDeath() animates the fall while S.dead is true
        bloodBurst(new THREE.Vector3(S.pos.x, S.pos.y + 1.2, S.pos.z), true); // enhanced burst on the kill blow
        victimImpact(m.by, true);
      }
      else {
        const r = S.remotes.get(m.id);
        if (r) {
          killRemote(r);
          const dist = (S.me ? S.me.position : S.camTarget).distanceTo(r.group.position);
          play('death', Math.min(0.6, 5 / (dist + 2)));
        }
      }
      if (m.by === S.myId) {
        hitmark(WEAPONS[S.myW]?.dmg);
        const banners = { 3: 'ON FIRE!', 5: 'RAMPAGE!', 7: 'GODLIKE!', 10: 'UNSTOPPABLE!' };
        const voices = { 3: 'onfire', 5: 'rampage', 7: 'godlike', 10: 'unstoppable' };
        if (voices[m.streak]) play(voices[m.streak], 0.9);
        showMsg(banners[m.streak] || 'KILL', 1100);
      }
      break;
    }
    case 'respawn':
      if (m.id === S.myId) { S.dead = false; S.myHp = 100; S.myArmor = 0; S.boostUntil = 0; S.pos.set(...m.spawn); S.vel.set(0, 0, 0); $('deathveil').style.opacity = 0; if (S.me) { S.me.rotation.x = 0; resetAnim(S.me.userData.anim); } resetGun(); snapCamera(); }
      else { const r = S.remotes.get(m.id); if (r) { reviveRemote(r); r.group.position.set(...m.spawn); } }
      break;
  }
}
