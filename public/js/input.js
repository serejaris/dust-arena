// input.js — keyboard, mouse aim, window.__dbg
import * as THREE from 'three';
import { S, $ } from './state.js';
import { reload } from './combat.js';
import { toggleMute } from './audio.js';
import { taunt } from './entities.js';
import { sb } from './hud.js';

// ---------- mouse aim (ground-plane raycast — no pointer lock in top-down) ----------
const mouseNDC = new THREE.Vector2(0, 0);
S.aimPoint = new THREE.Vector3(0, 0, 0);   // where the cursor points on the ground
export let aimTargetPid = 0;                    // enemy under cursor (aim assist)
let aimTargetY = 0;
const cursorRay = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
addEventListener('mousemove', e => {
  mouseNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const ch = $('crosshair');
  ch.style.left = e.clientX + 'px';
  ch.style.top = e.clientY + 'px';
});
export function updateAim() {
  cursorRay.setFromCamera(mouseNDC, S.camera);
  // aim assist: if the cursor is over a LIVE ENEMY, lock the shot to them
  aimTargetPid = 0;
  const targets = [];
  for (const r of S.remotes.values()) if (!r.dead && r.team !== S.myTeam) targets.push(...r.aimMeshes);
  const hits = cursorRay.intersectObjects(targets, false);
  if (hits[0]) {
    aimTargetPid = hits[0].object.userData.pid;
    const g = S.remotes.get(aimTargetPid)?.group; // pid → group (legs nest under a pivot now)
    if (g) { S.aimPoint.set(g.position.x, S.pos.y, g.position.z); aimTargetY = g.position.y + 1.0; }
  } else {
    aimPlane.constant = -S.pos.y;     // aim on my own ground level (kills tilt parallax)
    const p = new THREE.Vector3();
    if (cursorRay.ray.intersectPlane(aimPlane, p)) S.aimPoint.set(p.x, S.pos.y, p.z);
  }
  // face the cursor
  const dx = S.aimPoint.x - S.pos.x, dz = S.aimPoint.z - S.pos.z;
  if (dx * dx + dz * dz > 0.04) S.yaw = Math.atan2(-dx, -dz);
}

// keyboard (registered after all module bindings exist — no TDZ if keys land mid-load)
addEventListener('keydown', e => {
  S.keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'Tab') { e.preventDefault(); sb.style.display = 'block'; }
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyM') toggleMute();
  if (/^Digit[1-4]$/.test(e.code) && S.ws && $('join').style.display === 'none') taunt(+e.code[5] - 1);
});
addEventListener('keyup', e => { S.keys[e.code] = false; if (e.code === 'Tab') sb.style.display = 'none'; });
addEventListener('blur', () => { for (const k in S.keys) S.keys[k] = false; S.firing = false; });

// debug surface for QA tooling (read-only snapshot)
window.__dbg = () => ({
  myId: S.myId, x: +S.pos.x.toFixed(1), y: +S.pos.y.toFixed(1), z: +S.pos.z.toFixed(1),
  yaw: +S.yaw.toFixed(2), hp: S.myHp, dead: S.dead, ammo: S.ammo,
  aim: { x: +S.aimPoint.x.toFixed(1), z: +S.aimPoint.z.toFixed(1), pid: aimTargetPid },
  remotes: [...S.remotes.entries()].map(([id, r]) => ({
    id, name: r.name, dead: r.dead,
    x: +r.group.position.x.toFixed(1), z: +r.group.position.z.toFixed(1),
  })),
});
