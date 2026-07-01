// combat.js — shoot(), rayRectT(), nearestWallT()
import * as THREE from 'three';
import { S, $ } from './state.js';
import { P } from './physics.js';
import { WEAPONS, curW } from './weapons.js';
import { rebuildRing, tracer, partGeo, parts } from './fx.js';
import { swapGun, myMuzzle, triggerRecoil } from './entities.js';
import { shotBlockers } from './world.js';
import { shotSound, play } from './audio.js';
import { aimTargetPid } from './input.js';
import { SPECTATE } from './net.js';

// ---------- shooting ----------
S.firing = false; let lastShot = 0; S.ammo = 30; S.reloading = false; let reloadT = null; S.spread = 0;
S.hSpeed = 0; S.slowUntil = 0;
export function baseSpread() {
  if (!S.onGround) return 0.05;
  return S.hSpeed > 4.5 ? 0.022 : 0.004;
}
addEventListener('mousedown', e => { if (e.button === 0 && S.ws && $('join').style.display === 'none') S.firing = true; });
addEventListener('mouseup', e => { if (e.button === 0) S.firing = false; });
export function reload() {
  if (S.reloading || S.ammo === curW().mag || S.dead) return;
  S.reloading = true;
  $('ammo').textContent = 'RELOADING';
  if (!play('reload', 0.7)) { shotSound(0.05); setTimeout(() => shotSound(0.06), 1300); } // mag out / mag in
  reloadT = setTimeout(() => { S.ammo = curW().mag; S.reloading = false; }, 2000);
}
export function resetGun() { // death mid-reload must not carry over to the next life; also rolls weapon back to rifle
  clearTimeout(reloadT);
  S.myW = 0; S.curRange = WEAPONS[0].range; rebuildRing();
  S.ammo = WEAPONS[0].mag; S.reloading = false; S.firing = false; S.spread = 0;
  if (S.me) swapGun(S.me, S.myW);
}
// 2D ray-vs-AABB (slab method). Unit dir → returns entry distance, or Infinity if clear.
// Origin sitting inside/at a box returns Infinity so a wall you're already past can't self-block.
export function rayRectT(ox, oz, dx, dz, r) {
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) < 1e-9) { if (ox < r.minX || ox > r.maxX) return Infinity; }
  else { let t1 = (r.minX - ox) / dx, t2 = (r.maxX - ox) / dx; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
  if (Math.abs(dz) < 1e-9) { if (oz < r.minZ || oz > r.maxZ) return Infinity; }
  else { let t1 = (r.minZ - oz) / dz, t2 = (r.maxZ - oz) / dz; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
  if (tmax < tmin || tmax < 0) return Infinity;
  return tmin > 0 ? tmin : Infinity;
}
export function nearestWallT(ox, oz, dx, dz) {
  let best = Infinity;
  for (const r of shotBlockers) { const t = rayRectT(ox, oz, dx, dz, r); if (t < best) best = t; }
  return best;
}
export function shoot(now) {
  if (S.dead || S.frozen || S.reloading || S.ammo <= 0 || SPECTATE) return;
  if (!S.ws || S.ws.readyState !== 1) return;
  if (now - lastShot < curW().fireMs) return;
  lastShot = now; S.ammo--;
  if (S.ammo === 0) reload();
  S.spread = Math.min(Math.max(S.spread, baseSpread()) + 0.007, 0.05);
  // pure top-down hitscan: everything resolves on the XZ plane, height is irrelevant
  const ox = S.pos.x, oz = S.pos.z;
  const ang = S.yaw + (Math.random() - 0.5) * S.spread * 2 * curW().spreadMul;
  const nx = -Math.sin(ang), nz = -Math.cos(ang);      // forward unit (matches yaw)
  const wallT = nearestWallT(ox, oz, nx, nz);
  let hitId = 0, fdx = nx, fdz = nz, flen = Math.min(wallT, S.curRange);

  // aim-assist: cursor locked on an enemy → hit them if in range with clear 2D line of sight
  const lock = aimTargetPid ? S.remotes.get(aimTargetPid) : null;
  if (lock && !lock.dead && lock.team !== S.myTeam) {
    const ex = lock.group.position.x - ox, ez = lock.group.position.z - oz;
    const d = Math.hypot(ex, ez);
    if (d > 0.01 && d <= S.curRange && nearestWallT(ox, oz, ex / d, ez / d) >= d) {
      hitId = aimTargetPid; fdx = ex / d; fdz = ez / d; flen = d;
    }
  }
  // otherwise: nearest enemy whose 2D centre falls within the bullet corridor, before any wall
  if (!hitId) {
    const HIT_R = 0.75, reach = Math.min(wallT, S.curRange);
    let bestAlong = reach;
    for (const [id, r] of S.remotes) {
      if (r.dead || r.team === S.myTeam) continue;
      const ex = r.group.position.x - ox, ez = r.group.position.z - oz;
      const along = ex * nx + ez * nz;
      if (along <= 0 || along > reach) continue;
      if (Math.abs(ex * nz - ez * nx) > HIT_R) continue;  // perpendicular distance to ray
      if (along < bestAlong) { bestAlong = along; hitId = id; }
    }
    if (hitId) flen = bestAlong;
  }

  if (hitId) {
    S.ws.send(JSON.stringify({ t: 'hit', target: hitId, w: S.myW })); // w is cosmetic only — server trusts player.w
  } else if (wallT < S.curRange) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: 0xd9c79a }));
    m.position.set(ox + nx * wallT, S.pos.y + P.chest, oz + nz * wallT); m.scale.setScalar(1.8);
    S.scene.add(m);
    parts.push({ m, life: 0.18, v: new THREE.Vector3(0, 0.6, 0) });
  }
  const origin = new THREE.Vector3(ox, S.pos.y + P.chest, oz);
  const flatDir = new THREE.Vector3(fdx, 0, fdz);
  S.ws.send(JSON.stringify({ t: 'shoot', o: origin.toArray(), d: flatDir.toArray(), w: S.myW }));
  tracer(origin.clone().addScaledVector(flatDir, 0.9), flatDir, Math.max(0, flen - 0.9));
  shotSound(curW().sndVol, 0, curW().sndRate);
  myMuzzle.visible = true;
  clearTimeout(myMuzzle.userData.t);
  myMuzzle.userData.t = setTimeout(() => myMuzzle.visible = false, 45);
  if (S.me) triggerRecoil(S.me.userData.anim);
}
