// scene.js — renderer/camera/lights + occlusion fade of walls
import * as THREE from 'three';
import { S } from './state.js';

export const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
S.scene = new THREE.Scene();
S.scene.background = new THREE.Color(0x9ec8e8);
// top-down telephoto camera (Brawl-Stars-like): narrow FOV compresses depth
export const CAM = { fov: 17, dist: 120, tilt: 60 * Math.PI / 180, lerp: 8, lookAhead: 0.22, lookMax: 14 };
S.camera = new THREE.PerspectiveCamera(CAM.fov, innerWidth / innerHeight, 1, 500);
export const camOffY = CAM.dist * Math.sin(CAM.tilt);
export const camOffZ = CAM.dist * Math.cos(CAM.tilt);
S.camTarget = new THREE.Vector3(0, 0, 30);
addEventListener('resize', () => {
  S.camera.aspect = innerWidth / innerHeight; S.camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
S.scene.add(new THREE.HemisphereLight(0xfff4d6, 0x8a7a50, 0.9));
const sun = new THREE.DirectionalLight(0xffeecc, 1.2);
sun.position.set(40, 60, 20);
S.scene.add(sun);

// ---------- occlusion fade: keep MY soldier visible behind walls ----------
const occRay = new THREE.Raycaster();
let fadedSet = new Set();
// worldMeshes/spectating passed in by the caller (main.js) — importing world.js here
// would cycle back through its top-level `import './scene.js'` before S.scene is set.
export function updateOcclusion(worldMeshes, spectating) {
  const next = new Set();
  if (S.me && !spectating) {
    const head = new THREE.Vector3(S.pos.x, S.pos.y + 1.4, S.pos.z);
    const toHead = head.clone().sub(S.camera.position);
    const dist = toHead.length();
    occRay.set(S.camera.position, toHead.normalize());
    occRay.far = dist - 0.5;
    for (const h of occRay.intersectObjects(worldMeshes, false)) next.add(h.object);
  }
  for (const m of fadedSet) {
    if (!next.has(m)) { m.material.transparent = false; m.material.opacity = 1; }
  }
  for (const m of next) {
    if (!fadedSet.has(m)) { m.material.transparent = true; m.material.opacity = 0.28; }
  }
  fadedSet = next;
}
