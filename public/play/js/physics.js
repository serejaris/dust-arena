// physics.js — P, collide()
import * as THREE from 'three';
import { S } from './state.js';
import { colliders } from './world.js';

// ---------- player physics ----------
export const P = { r: 0.4, h: 1.8, speed: 7.2, walk: 3.4, jump: 7.5, grav: 21, chest: 1.2, kbFriction: 9 };

S.pos = new THREE.Vector3(0, 0, 30);
S.vel = new THREE.Vector3();
S.yaw = 0;
S.onGround = false;
S.keys = {};

export function collide() {
  for (const c of colliders) {
    const px = S.pos.x, pz = S.pos.z, py = S.pos.y;
    if (px + P.r <= c.minX || px - P.r >= c.maxX || pz + P.r <= c.minZ || pz - P.r >= c.maxZ) continue;
    if (py >= c.maxY || py + P.h <= c.minY) {
      continue;
    }
    // landing on top
    if (S.vel.y <= 0 && py >= c.maxY - 0.6) { S.pos.y = c.maxY; S.vel.y = 0; S.onGround = true; continue; }
    // auto step-up (stairs, low ledges)
    if (c.maxY - py <= 0.55 && S.vel.y <= 0.01) { S.pos.y = c.maxY; S.onGround = true; continue; }
    // push out horizontally (smallest overlap)
    const ox1 = (px + P.r) - c.minX, ox2 = c.maxX - (px - P.r);
    const oz1 = (pz + P.r) - c.minZ, oz2 = c.maxZ - (pz - P.r);
    const m = Math.min(ox1, ox2, oz1, oz2);
    if (m === ox1) S.pos.x = c.minX - P.r; else if (m === ox2) S.pos.x = c.maxX + P.r;
    else if (m === oz1) S.pos.z = c.minZ - P.r; else S.pos.z = c.maxZ + P.r;
  }
  if (S.pos.y <= 0) { S.pos.y = 0; S.vel.y = 0; S.onGround = true; }
}
