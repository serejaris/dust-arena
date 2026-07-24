// entities.js — gunModel/soldierModel/animateWalk/resetAnim/swapGun/buildMe + remotes CRUD + taunts
//
// Implicit contract with combat.js/main.js/net.js: userData.anim = {
//   group, body, gun, legL, legR, phase,                 — walk-cycle pose (animateWalk/resetAnim)
//   recoilT, hitT: 0..1 decay energy; reloadT: 0..1 smoothed blend; deathT: 0..1 fall progress
// }. Combat layers (recoil/hit/reload/death) are additive offsets applied by advanceCombatAnim()/
// advanceDeath() ON TOP of the walk pose each frame, AFTER animateWalk() runs — state lives on the
// anim struct, never on the gun/body mesh itself, so it survives swapGun() and doesn't drift.
// userData.aimMeshes and userData.pid are attached to every soldier group here and read
// directly by other modules (aim-assist raycasts, animateWalk, damage flinch). Keep as-is.
import * as THREE from 'three';
import { S } from './state.js';
import { bloodBurst } from './fx.js';
import { showMsg } from './hud.js';
import { sharedGeometries, sharedBox, boxAssembly, gunMesh } from './weapon-mesh.js';

// ---------- soldier model (own + remotes share the builder) ----------
export const labelCanvas = (text) => {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 48;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 30px Courier New'; ctx.textAlign = 'center';
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 5;
  ctx.strokeText(text, 128, 34); ctx.fillText(text, 128, 34);
  return cv;
};
const MAX_HP = 100;
export const hpColor = (hp) => hp > 50 ? '#7CFC00' : hp > 25 ? '#ffce54' : '#ff5544';
const HPBAR_W = 128, HPBAR_H = 16;
const hpbarCanvas = () => { const cv = document.createElement('canvas'); cv.width = HPBAR_W; cv.height = HPBAR_H; return cv; };
function drawHpbar(cv, hp) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, HPBAR_W, HPBAR_H);
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, HPBAR_W, HPBAR_H);
  const frac = Math.max(0, Math.min(MAX_HP, hp)) / MAX_HP;
  ctx.fillStyle = hpColor(hp); ctx.fillRect(1, 1, (HPBAR_W - 2) * frac, HPBAR_H - 2);
}
const HIP_Y = 0.7, BODY_Y = 0.85, GUN_Y = 1.2, GUN_X = 0.25, GUN_BASE_Z = -0.3;
const UNIFORM_SAND = 0x625c4a, UNIFORM_CHARCOAL = 0x403f36, SKIN = 0xd9b48f;
// Remote enemies use a muted, readable Dust-red treatment. Their hit volumes, geometry, and
// animation anchors remain exactly the same as every other operator.
export const DUST_RED_PALETTE = Object.freeze({ accent: '#a9473f', body: 0x6b4139 });
export function remotePalette(player, { enemy = false, spectator = false } = {}) {
  if (enemy && !spectator) return DUST_RED_PALETTE;
  return { accent: player.color, body: UNIFORM_SAND };
}

// Avatar and weapon geometry is immutable and reused (registry + box merger live in
// weapon-mesh.js, which world.js shares for the ground pickups). Materials stay per instance:
// flinching one operator must never make a teammate's vest or rifle flash.
const BODY_GEOMETRY = sharedBox(0.7, 1.05, 0.4);
const HEAD_GEOMETRY = sharedBox(0.34, 0.34, 0.34);
const LEG_GEOMETRY = sharedBox(0.24, 0.7, 0.34);
const operatorDetailGeometry = new Map();

// The detail mesh deliberately is not an aimMesh: only the stable torso/head/leg hit volumes
// are raycastable.
function detailGeometry(color) {
  const accent = new THREE.Color(color).getHex();
  const key = accent.toString(16);
  if (!operatorDetailGeometry.has(key)) {
    operatorDetailGeometry.set(key, boxAssembly([
      // Chest plate and bright, top-readable team panel establish the operator's forward side.
      { size: [0.58, 0.62, 0.09], at: [0, 0.98, -0.245], color: 0x82765c },
      { size: [0.31, 0.13, 0.105], at: [0, 1.16, -0.255], color: accent },
      { size: [0.19, 0.12, 0.42], at: [-0.445, 1.17, 0], color: accent },
      { size: [0.19, 0.12, 0.42], at: [0.445, 1.17, 0], color: accent },
      // Rear pack, helmet crown and dark visor make the outline readable from any camera angle.
      { size: [0.46, 0.55, 0.18], at: [0, 1.04, 0.29], color: UNIFORM_CHARCOAL },
      { size: [0.4, 0.18, 0.4], at: [0, 1.76, 0], color: UNIFORM_CHARCOAL },
      { size: [0.27, 0.1, 0.055], at: [0, 1.58, -0.198], color: 0x1b2220 },
    ]));
  }
  return operatorDetailGeometry.get(key);
}

// Weapon geometry is built and cached in weapon-mesh.js; here it only gets hung off the hands at
// the anchor animateWalk()/advanceCombatAnim() drive.
function gunModel(w) {
  const gun = gunMesh(w);
  gun.position.set(GUN_X, GUN_Y, GUN_BASE_Z);
  return gun;
}
function soldierModel(accent, pid, w = 0, bodyColor = UNIFORM_SAND) {
  const g = new THREE.Group();
  // These four meshes remain the unchanged raycast volumes and animation anchors.
  const body = new THREE.Mesh(BODY_GEOMETRY, new THREE.MeshLambertMaterial({ color: bodyColor }));
  body.position.y = BODY_Y;
  const head = new THREE.Mesh(HEAD_GEOMETRY, new THREE.MeshLambertMaterial({ color: SKIN }));
  head.position.y = 1.55;
  const detail = new THREE.Mesh(detailGeometry(accent), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const gun = gunModel(w);
  // Legs hang from hip pivots so they can swing through a walk cycle.
  const mkLeg = (x) => {
    const pivot = new THREE.Group(); pivot.position.set(x, HIP_Y, 0);
    const leg = new THREE.Mesh(LEG_GEOMETRY, new THREE.MeshLambertMaterial({ color: UNIFORM_CHARCOAL }));
    leg.position.y = -0.35; pivot.add(leg);
    return { pivot, leg };
  };
  const legL = mkLeg(-0.16), legR = mkLeg(0.16);
  g.add(body, head, detail, gun, legL.pivot, legR.pivot);
  if (pid != null) for (const m of [body, head, legL.leg, legR.leg]) m.userData.pid = pid;
  g.userData.aimMeshes = [body, head, legL.leg, legR.leg];
  g.userData.anim = { group: g, body, gun, legL: legL.pivot, legR: legR.pivot, phase: 0, recoilT: 0, hitT: 0, reloadT: 0, deathT: 0 };
  return g;
}
// Shared walk cycle: legs swing in antiphase; a restrained lean and counter-sway keep the
// operator's weapon-forward silhouette alive without touching combat animation axes.
export function animateWalk(anim, dt, moving) {
  if (!anim) return;
  if (moving) {
    anim.phase += dt * 11;
    const s = Math.sin(anim.phase);
    const c = Math.cos(anim.phase);
    anim.legL.rotation.x = s * 0.7;
    anim.legR.rotation.x = -s * 0.7;
    const bob = Math.abs(s) * 0.07;
    anim.body.position.y = BODY_Y + bob;
    anim.body.rotation.z = s * 0.035;
    anim.gun.position.x = GUN_X + c * 0.012;
    anim.gun.position.y = GUN_Y + bob;
    anim.gun.rotation.z = -s * 0.065;
  } else {
    const k = Math.min(1, dt * 12);
    anim.legL.rotation.x *= 1 - k;
    anim.legR.rotation.x *= 1 - k;
    anim.body.position.y += (BODY_Y - anim.body.position.y) * k;
    anim.body.rotation.z *= 1 - k;
    anim.gun.position.x += (GUN_X - anim.gun.position.x) * k;
    anim.gun.position.y += (GUN_Y - anim.gun.position.y) * k;
    anim.gun.rotation.z *= 1 - k;
  }
}
// Snap legs/torso/gun to neutral and clear combat-layer timers — dead bodies skip animateWalk,
// so reset on death (deathT=0 also arms the fall — advanceDeath() then animates it) & on respawn/revive.
export function resetAnim(anim) {
  if (!anim) return;
  anim.legL.rotation.x = 0; anim.legR.rotation.x = 0;
  anim.body.position.y = BODY_Y; anim.body.rotation.x = 0; anim.body.rotation.z = 0;
  anim.gun.position.x = GUN_X; anim.gun.position.y = GUN_Y; anim.gun.position.z = GUN_BASE_Z;
  anim.gun.rotation.x = 0; anim.gun.rotation.z = 0;
  anim.phase = 0;
  anim.recoilT = 0; anim.hitT = 0; anim.reloadT = 0; anim.deathT = 0;
}
// ---------- combat animation layers — additive, applied AFTER animateWalk() writes this frame's
// base pose. Recoil/hit are decaying impulses; reload is a continuous blend toward S.reloading;
// death is a one-shot 0→1 progress that eases the whole group onto its side. Walk owns body/gun
// position x/y and rotation z, while these layers own gun position z/rotation x and body rotation x. ----------
const RECOIL_DECAY = 30, RECOIL_KICK_Z = 0.16, RECOIL_LIFT_ROT = 0.12; // ~100ms to fade (exp(-30*0.1)≈0.05)
const HIT_DECAY = 15, HIT_TILT = 0.15;                                 // ~200ms to fade
const RELOAD_LERP = 8, RELOAD_TILT = 0.45;
const DEATH_DUR = 0.42;
export function triggerRecoil(anim) { if (anim) anim.recoilT = 1; }
export function triggerHit(anim) { if (anim) anim.hitT = 1; }
// recoil/hit/reload — call every frame for the local player and every remote (reloading only ever true for self)
export function advanceCombatAnim(anim, dt, reloading = false) {
  if (!anim) return;
  anim.recoilT *= Math.exp(-RECOIL_DECAY * dt);
  anim.hitT *= Math.exp(-HIT_DECAY * dt);
  anim.reloadT += ((reloading ? 1 : 0) - anim.reloadT) * Math.min(1, RELOAD_LERP * dt);
  anim.gun.position.z = GUN_BASE_Z + anim.recoilT * RECOIL_KICK_Z; // walk never touches z — safe to set absolutely
  anim.gun.rotation.x = anim.reloadT * RELOAD_TILT - anim.recoilT * RECOIL_LIFT_ROT; // walk never touches gun rotation — safe to set absolutely
  anim.body.rotation.x = anim.hitT * HIT_TILT;
}
// procedural death fall — call every frame while dead; holds the settled pose once deathT hits 1
export function advanceDeath(anim, dt) {
  if (!anim || anim.deathT >= 1) return;
  anim.deathT = Math.min(1, anim.deathT + dt / DEATH_DUR);
  const e = 1 - Math.pow(1 - anim.deathT, 3);
  anim.group.rotation.x = e * Math.PI / 2 * 0.97;
  anim.group.position.y = e * 0.2;
}
// Rebuild the held gun on weapon pickup/reset. Its per-avatar material is disposed, while the
// immutable cached geometry remains available to every current and future weapon instance.
export function swapGun(avatarGroup, w) {
  const anim = avatarGroup.userData.anim;
  avatarGroup.remove(anim.gun);
  disposeGroup(anim.gun);
  const gun = gunModel(w);
  avatarGroup.add(gun);
  anim.gun = gun;
}

// own avatar (visible in top-down — you ARE on the screen now)
S.me = null; S.myColor = '#d9a24b';
export const myMuzzle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
myMuzzle.visible = false;
export function buildMe() {
  // reconnect calls this again — detach the shared muzzle mesh first so disposeGroup() below
  // doesn't kill it, then dispose the old avatar's geometries/materials (was leaking every reconnect)
  if (S.me) { S.me.remove(myMuzzle); S.scene.remove(S.me); disposeGroup(S.me); }
  S.me = soldierModel(S.myColor, null, S.myW);
  S.me.add(myMuzzle);
  myMuzzle.position.set(0.25, 1.2, -0.75);
  S.scene.add(S.me);
}

// ---------- remote players ----------
S.remotes = new Map(); // id -> {group, label, hpbar, hpCanvas, hpTex, buf:[], name, color, hp, w, dead, kills, deaths}
export function makeRemote(p, relation) {
  const palette = remotePalette(p, relation);
  const g = soldierModel(palette.accent, p.id, p.w || 0, palette.body);
  const tex = new THREE.CanvasTexture(labelCanvas(p.name));
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  label.scale.set(2.2, 0.42, 1); label.position.y = 2.3;
  const hpCanvas = hpbarCanvas(); drawHpbar(hpCanvas, p.hp);
  const hpTex = new THREE.CanvasTexture(hpCanvas);
  const hpbar = new THREE.Sprite(new THREE.SpriteMaterial({ map: hpTex, depthTest: false }));
  hpbar.scale.set(2.0, 0.14, 1); hpbar.position.y = 2.05;
  g.add(label, hpbar);
  g.position.set(p.x, p.y, p.z);
  S.scene.add(g);
  S.remotes.set(p.id, { group: g, label, hpbar, hpCanvas, hpTex, buf: [], name: p.name, color: p.color, team: p.team || 0, aimMeshes: g.userData.aimMeshes, hp: p.hp, w: p.w || 0, dead: p.dead, kills: p.kills || 0, deaths: p.deaths || 0 });
  if (p.dead) { g.userData.anim.deathT = 1; g.rotation.x = Math.PI / 2 * 0.97; g.position.y = 0.2; } // join mid-death: snap straight to the settled corpse pose
}
export function setRemoteHp(r, hp) {
  if (hp === r.hp) return;
  r.hp = hp;
  drawHpbar(r.hpCanvas, hp);
  r.hpTex.needsUpdate = true;
}
function disposeGroup(g) {
  g.traverse(c => { // legs now nest inside hip pivots — traverse, don't just walk children
    if (c.material) {
      if (c.material.map) c.material.map.dispose();
      c.material.dispose();
    }
    if (c.geometry && !sharedGeometries.has(c.geometry)) c.geometry.dispose();
  });
}
export function removeRemote(id) {
  const r = S.remotes.get(id);
  if (r) { S.scene.remove(r.group); disposeGroup(r.group); S.remotes.delete(id); }
}
export function killRemote(r) {
  // group.visible is left alone here — it reflects fog (#1)'s last verdict; forcing it true would
  // pop a hidden corpse into view for players who never had LOS on this enemy
  r.dead = true; r.label.visible = false; r.hpbar.visible = false;
  resetAnim(r.group.userData.anim); // corpse lies flat, not mid-stride; deathT=0 arms advanceDeath() to fall from here
  // blood is a free-floating scene object, not a group child, so fog's group.visible gate doesn't
  // cover it — gate it explicitly on r.visible or a death behind fog leaks the enemy's position (#5 x #1)
  if (r.visible) bloodBurst(r.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), true); // enhanced burst on the kill (#5)
}
// emissive damage-flash + hit-flinch body tilt; takes the avatar Group directly so it works for
// remotes (r.group) and the local player (S.me) alike — flinchT lives on userData so both are stateless callers
export function flinch(group) {
  if (!group) return;
  group.traverse(c => { if (c.material && c.material.emissive) c.material.emissive.setHex(0x661111); });
  clearTimeout(group.userData.flinchT);
  group.userData.flinchT = setTimeout(() => {
    group.traverse(c => { if (c.material && c.material.emissive) c.material.emissive.setHex(0); });
  }, 90);
  triggerHit(group.userData.anim);
}
export const TAUNTS = ['EZ', 'NICE SHOT', 'RUSH B', 'HELP!'];
let tauntCd = 0;
export function taunt(n) {
  if (!S.ws || S.ws.readyState !== 1 || performance.now() < tauntCd || S.dead) return;
  tauntCd = performance.now() + 1500;
  S.ws.send(JSON.stringify({ t: 'chatping', n }));
  showMsg(TAUNTS[n], 1000);
}
export function reviveRemote(r) {
  r.dead = false; r.buf = [];
  r.group.rotation.x = 0; r.group.position.y = 0;
  resetAnim(r.group.userData.anim);
  r.group.visible = true; r.label.visible = true; r.hpbar.visible = true;
}
