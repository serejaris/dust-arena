// main.js — bootstrap, tick(), wiring
import * as THREE from 'three';
import { S, $ } from './state.js';
import { renderer, CAM, camOffY, camOffZ, updateOcclusion } from './scene.js';
import { P, collide } from './physics.js';
import { curW } from './weapons.js';
import { animateWalk, advanceCombatAnim, advanceDeath, hpColor } from './entities.js';
import { ring, aimLine, aimGeo, updateParts, shakeOffset } from './fx.js';
import { medkitMeshes, weaponMeshes, armorMeshes, boostMeshes, worldMeshes } from './world.js';
import { updateAim } from './input.js';
import { shoot, baseSpread } from './combat.js';
import { updateVisibility } from './visibility.js';
import { play, blip, shotSound } from './audio.js';
import { TEAM_HUD, renderScores, sb } from './hud.js';
import { SPECTATE } from './net.js';

// ---------- main loop ----------
let lastT = performance.now(), lastSend = 0;
let stepT = 0, lastBeepSec = -1;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  let myMoving = false;
  updateVisibility(); // fog of war (#1) — every frame, before aim-assist reads r.visible below

  if (S.ws && !S.dead && !S.frozen && !SPECTATE) {
    // world-aligned WASD (camera never yaws: screen-up IS north)
    const move = new THREE.Vector3();
    if (S.keys['KeyW']) move.z -= 1;
    if (S.keys['KeyS']) move.z += 1;
    if (S.keys['KeyD']) move.x += 1;
    if (S.keys['KeyA']) move.x -= 1;
    if (move.lengthSq() > 0) move.normalize();
    // tagging: getting hit slows you for 450ms; boost pickup speeds you up for 8s (client-side feel only)
    const boosted = (Date.now() + S.serverOffset) < S.boostUntil;
    const sp = (S.keys['ShiftLeft'] ? P.walk : P.speed) * (now < S.slowUntil ? 0.55 : 1) * (boosted ? 1.4 : 1);
    S.hSpeed = move.lengthSq() > 0 ? sp : 0;
    S.pos.x += move.x * sp * dt;
    S.pos.z += move.z * sp * dt;
    // knockback impulse (net.js 'hp'/'die' feed S.vel.x/z on taking a hit) — independent of the WASD
    // delta above, bleeds off via friction so it never becomes a persistent drift (#5)
    if (S.vel.x || S.vel.z) {
      S.pos.x += S.vel.x * dt;
      S.pos.z += S.vel.z * dt;
      const kbDecay = Math.exp(-P.kbFriction * dt);
      S.vel.x *= kbDecay; S.vel.z *= kbDecay;
      if (Math.abs(S.vel.x) < 0.04) S.vel.x = 0;
      if (Math.abs(S.vel.z) < 0.04) S.vel.z = 0;
    }
    if (S.keys['Space'] && S.onGround) { S.vel.y = P.jump; S.onGround = false; }
    S.vel.y -= P.grav * dt;
    S.pos.y += S.vel.y * dt;
    S.onGround = false;
    collide();
    S.pos.x = Math.max(-72.5, Math.min(72.5, S.pos.x));
    S.pos.z = Math.max(-72.5, Math.min(72.5, S.pos.z));
    updateAim();
    if (S.firing) shoot(now); else S.spread = Math.max(baseSpread(), S.spread - 0.12 * dt);
    myMoving = move.lengthSq() > 0 && S.onGround;
    if (myMoving) { stepT += dt; if (stepT > 0.37) { stepT = 0; if (!play('step', 0.08, 0, 0.85 + Math.random() * 0.3)) shotSound(0.018); } } else stepT = 0;
  }
  updateParts(dt);
  for (const mk of medkitMeshes) {
    if (!mk.visible) continue;
    mk.rotation.y += dt * 1.6;
    mk.position.y = mk.userData.baseY + 0.12 + Math.sin(now * 0.0035) * 0.1;
  }
  for (const wm of weaponMeshes) {
    if (!wm.visible) continue;
    wm.rotation.y += dt * 1.6;
    wm.position.y = wm.userData.baseY + 0.12 + Math.sin(now * 0.0035) * 0.1;
  }
  for (const am of armorMeshes) {
    if (!am.visible) continue;
    am.rotation.y += dt * 1.6;
    am.position.y = am.userData.baseY + 0.12 + Math.sin(now * 0.0035) * 0.1;
  }
  for (const bm of boostMeshes) {
    if (!bm.visible) continue;
    bm.rotation.y += dt * 1.6;
    bm.position.y = bm.userData.baseY + 0.12 + Math.sin(now * 0.0035) * 0.1;
  }

  // own avatar + aim widgets
  if (S.me) {
    S.me.position.x = S.pos.x; S.me.position.z = S.pos.z;
    if (S.dead) {
      advanceDeath(S.me.userData.anim, dt); // owns rotation.x/position.y while falling/lying
    } else {
      S.me.rotation.y = S.yaw;
      S.me.position.y = S.pos.y;
      animateWalk(S.me.userData.anim, dt, myMoving);
      advanceCombatAnim(S.me.userData.anim, dt, S.reloading); // recoil/hit decay + reload tilt, atop the walk pose just set
    }
    ring.position.set(S.pos.x, S.pos.y + 0.06, S.pos.z);
    ring.visible = !S.dead && !SPECTATE;
    const from = new THREE.Vector3(S.pos.x, S.pos.y + 1.1, S.pos.z);
    const to = new THREE.Vector3(S.aimPoint.x, S.pos.y + 1.1, S.aimPoint.z);
    const d = to.clone().sub(from);
    if (d.length() > S.curRange) to.copy(from).addScaledVector(d.normalize(), S.curRange);
    aimGeo.setFromPoints([from, to]);
    aimLine.material.opacity = S.firing ? 0.7 : 0.3;
    aimLine.visible = !S.dead && !SPECTATE;
  }

  // camera: smooth follow + cursor look-ahead (Brawl-Stars feel); stays on the corpse while dead
  if (!SPECTATE) {
    const ahead = S.dead ? new THREE.Vector3()
      : new THREE.Vector3(S.aimPoint.x - S.pos.x, 0, S.aimPoint.z - S.pos.z).multiplyScalar(CAM.lookAhead);
    if (ahead.length() > CAM.lookMax) ahead.setLength(CAM.lookMax);
    const want = new THREE.Vector3(S.pos.x + ahead.x, S.pos.y, S.pos.z + ahead.z);
    S.camTarget.lerp(want, 1 - Math.exp(-CAM.lerp * dt));
    // screen shake: ephemeral per-frame jitter added on top of the follow position, never onto
    // S.camTarget/S.pos — so it can't accumulate a drift (#5)
    const shake = shakeOffset(dt);
    S.camera.position.set(
      S.camTarget.x + (shake ? shake.x : 0),
      S.camTarget.y + camOffY + (shake ? shake.y : 0),
      S.camTarget.z + camOffZ + (shake ? shake.z : 0)
    );
    S.camera.lookAt(S.camTarget);
  }
  updateOcclusion(worldMeshes, SPECTATE);

  // interpolate remotes (render 120ms in the past)
  const renderTime = Date.now() + S.serverOffset - 120;
  for (const r of S.remotes.values()) {
    if (r.dead) { advanceDeath(r.group.userData.anim, dt); continue; } // fall over and lie until respawn
    const prevX = r.group.position.x, prevZ = r.group.position.z;
    const b = r.buf;
    while (b.length > 2 && b[1].time <= renderTime) b.shift();
    if (b.length >= 2) {
      const [a, c] = b;
      const t = Math.max(0, Math.min(1, (renderTime - a.time) / Math.max(1, c.time - a.time)));
      r.group.position.set(a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, a.z + (c.z - a.z) * t);
      let dyaw = c.ry - a.ry; // shortest-arc lerp: no 360 spins across the ±PI seam
      dyaw = ((dyaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      r.group.rotation.y = a.ry + dyaw * t;
    } else if (b.length === 1) {
      r.group.position.set(b[0].x, b[0].y, b[0].z);
      r.group.rotation.y = b[0].ry;
    }
    // drive the walk cycle from how far the remote actually slid this frame
    const moved = Math.hypot(r.group.position.x - prevX, r.group.position.z - prevZ);
    animateWalk(r.group.userData.anim, dt, moved > 0.012);
    advanceCombatAnim(r.group.userData.anim, dt); // recoil/hit decay atop the walk pose just set (no reload — not broadcast)
  }

  // net send 20Hz
  if (S.ws && S.ws.readyState === 1 && now - lastSend > 50) {
    lastSend = now;
    S.ws.send(JSON.stringify({ t: 'state', x: +S.pos.x.toFixed(2), y: +S.pos.y.toFixed(2), z: +S.pos.z.toFixed(2), ry: +S.yaw.toFixed(3), rx: 0 }));
  }

  // HUD
  $('hp').textContent = '+' + Math.max(0, S.myHp);
  $('hp').style.color = hpColor(S.myHp);
  $('armor').style.display = S.myArmor > 0 ? 'block' : 'none';
  if (S.myArmor > 0) $('armor').textContent = 'ARM ' + Math.round(S.myArmor);
  if (!S.reloading) $('ammo').textContent = `${curW().name} ${S.ammo}/∞`;
  $('crosshair').style.fontSize = Math.round(16 + S.spread * 500) + 'px'; // dynamic: shows your accuracy
  const left = Math.max(0, S.roundEndsAt - (Date.now() + S.serverOffset));
  const tk = [0, 0]; tk[S.myTeam] += S.myKills; for (const r of S.remotes.values()) tk[r.team] += r.kills;
  const time = `${Math.floor(left / 60000)}:${String(Math.floor(left % 60000 / 1000)).padStart(2, '0')}`;
  const timeCol = left <= 15000 && !S.frozen ? '#ff5544' : '#e8e0c8';
  $('timer').innerHTML = `<span style="color:${TEAM_HUD[0]}">${tk[0]}</span>` +
    `&nbsp;&nbsp;<span style="color:${timeCol}">${time}</span>&nbsp;&nbsp;` +
    `<span style="color:${TEAM_HUD[1]}">${tk[1]}</span>`;
  if (S.ws && !S.frozen && left > 0 && left <= 10000) {
    const s = Math.floor(left / 1000);
    if (s !== lastBeepSec) { lastBeepSec = s; blip(); }
  }
  if (sb.style.display === 'block') renderScores();

  renderer.render(S.scene, S.camera);
}
requestAnimationFrame(tick);
