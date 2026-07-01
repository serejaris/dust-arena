// fx.js — particles, aim ring/line, tracers
import * as THREE from 'three';
import { S } from './state.js';
import './scene.js'; // populates S.scene before the scene.add() calls below

// ---------- aim ring + aim line ----------
export const ring = new THREE.Mesh(
  new THREE.RingGeometry(S.curRange - 0.5, S.curRange, 64).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.10, depthWrite: false })
);
ring.visible = false;
S.scene.add(ring);
// weapon switch changes the range, so the ring's radius must be rebuilt (geometry isn't resizable in place)
export function rebuildRing() {
  ring.geometry.dispose();
  ring.geometry = new THREE.RingGeometry(S.curRange - 0.5, S.curRange, 64).rotateX(-Math.PI / 2);
}
export const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
export const aimLine = new THREE.Line(aimGeo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.3, depthWrite: false }));
aimLine.visible = false;
aimLine.frustumCulled = false; // geometry mutates every frame; stale bounding sphere would cull it
S.scene.add(aimLine);

// ---------- particles ----------
export const parts = [];
export const partGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
export function burst(p, color, n = 12) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color }));
    m.position.copy(p);
    S.scene.add(m);
    parts.push({
      m, life: 0.7,
      v: new THREE.Vector3((Math.random() - .5) * 6, Math.random() * 5 + 1, (Math.random() - .5) * 6),
    });
  }
}
export function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    p.v.y -= 14 * dt;
    p.m.position.addScaledVector(p.v, dt);
    if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.set(0, 0, 0); }
    if (p.life <= 0) { S.scene.remove(p.m); p.m.material.dispose(); parts.splice(i, 1); }
  }
}

// ---------- tracers ----------
export function tracer(origin, dir, len = S.curRange) {
  const geo = new THREE.BufferGeometry().setFromPoints([origin, origin.clone().addScaledVector(dir, len)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
  S.scene.add(line);
  setTimeout(() => { S.scene.remove(line); geo.dispose(); line.material.dispose(); }, 60);
}
