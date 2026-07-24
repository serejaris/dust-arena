// weapon-mesh.js — immutable box-assembly geometry: the shared-geometry registry, the
// vertex-colour box merger, and every weapon model (held gun + ground pickup).
//
// Own module because BOTH entities.js (the gun in the operator's hands) and world.js (the pickup
// lying on the ground) need the same cached weapon geometry, and neither may import the other.
// world.js is a top-level-await module sitting upstream of physics/combat/minimap; entities.js
// drags in fx/hud/audio. A world→entities edge does not cycle *today*, but it closes the moment
// anything under entities.js reaches back for a world export (a pickup cue in fx, a collider query)
// — and with a TLA module inside the loop that is a hung module graph, not a TDZ warning you can
// read in the console. This file imports only three + weapons.js, so it can never be the edge that
// closes a cycle.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

// Geometry is immutable and reused across every avatar and every pickup. Materials stay per
// instance: flinching one operator must never flash a teammate's vest or rifle. entities.js's
// disposeGroup() skips anything registered here, so picking up a weapon can't free the geometry
// still drawn for five other players.
export const sharedGeometries = new WeakSet();
export const sharedBox = (x, y, z) => {
  const geometry = new THREE.BoxGeometry(x, y, z);
  sharedGeometries.add(geometry);
  return geometry;
};

// Merge simple boxes into one vertex-coloured draw. `rot` is optional Euler radians applied before
// the offset — canted grips, tilted magazines and splayed bipod legs are what stop a box pile from
// reading as a stick.
export function boxAssembly(parts) {
  const positions = [], normals = [], colors = [], indices = [];
  let vertexOffset = 0;
  for (const { size: [x, y, z], at: [px, py, pz], color, rot } of parts) {
    const box = new THREE.BoxGeometry(x, y, z);
    if (rot) {
      if (rot[0]) box.rotateX(rot[0]);
      if (rot[1]) box.rotateY(rot[1]);
      if (rot[2]) box.rotateZ(rot[2]);
    }
    box.translate(px, py, pz);
    const position = box.getAttribute('position');
    const normal = box.getAttribute('normal');
    const tint = new THREE.Color(color);
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      colors.push(tint.r, tint.g, tint.b);
    }
    for (const index of box.index.array) indices.push(index + vertexOffset);
    vertexOffset += position.count;
    box.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox(); // pickups recentre on this so long guns orbit their own middle
  sharedGeometries.add(geometry);
  return geometry;
}

// Three metal tones, not one: under the top-down key light a single dark grey collapses a gun into
// a smudge. Steel marks the long axis (barrel/optics), grip-black sinks the parts that hang below
// the bore, and the weapon's HUD colour rides on top where the camera actually looks.
const GUN_DARK = 0x333028, GUN_STEEL = 0x6b6656, GUN_GRIP = 0x241f18;

// Weapon space: the bore lies on +y-up / -z-forward, origin at the trigger. Rear ends stop near
// z=+0.14 so the stock only just meets the operator's chest instead of growing out of their back.
// Cases mirror WEAPONS by index; `default` is the id-0 spawn pistol, which doubles as the fallback
// silhouette for an id the server hands out but this table has not learned yet.
function weaponParts(w, accent) {
  switch (w) {
    case 2: return [ // SMG — stubby receiver, skeleton stock, long straight mag: shortest full-size footprint
      { size: [0.04, 0.045, 0.15], at: [0, -0.01, 0.03], color: GUN_STEEL },
      { size: [0.10, 0.11, 0.20], at: [0, 0, -0.10], color: GUN_DARK },
      { size: [0.055, 0.025, 0.19], at: [0, 0.068, -0.10], color: accent },
      { size: [0.055, 0.12, 0.06], at: [0, -0.085, -0.02], color: GUN_GRIP, rot: [-0.3, 0, 0] },
      { size: [0.05, 0.24, 0.075], at: [0, -0.16, -0.09], color: GUN_GRIP },
      { size: [0.05, 0.10, 0.05], at: [0, -0.07, -0.24], color: GUN_DARK },
      { size: [0.05, 0.05, 0.13], at: [0, 0, -0.27], color: GUN_STEEL },
      { size: [0.065, 0.065, 0.04], at: [0, 0, -0.35], color: GUN_STEEL },
    ];
    case 3: return [ // DEAGLE — pistol: half the footprint of anything else, unmistakable from above
      { size: [0.06, 0.085, 0.23], at: [0, 0.01, -0.09], color: GUN_DARK },
      { size: [0.03, 0.02, 0.21], at: [0, 0.06, -0.09], color: accent },
      { size: [0.05, 0.03, 0.03], at: [0, 0.062, 0.015], color: GUN_STEEL },
      { size: [0.042, 0.042, 0.05], at: [0, 0.01, -0.225], color: GUN_STEEL },
      { size: [0.05, 0.05, 0.12], at: [0, -0.055, -0.02], color: GUN_DARK },
      { size: [0.035, 0.04, 0.055], at: [0, -0.055, -0.07], color: GUN_GRIP },
      { size: [0.06, 0.17, 0.075], at: [0, -0.13, 0.035], color: GUN_GRIP, rot: [-0.3, 0, 0] },
    ];
    case 4: return [ // SHOTGUN — thick barrel over a tube mag; the wide bright pump is the tell from above
      { size: [0.07, 0.14, 0.17], at: [0, -0.025, 0.06], color: GUN_DARK },
      { size: [0.11, 0.12, 0.18], at: [0, 0, -0.10], color: GUN_DARK },
      { size: [0.06, 0.025, 0.16], at: [0, 0.072, -0.10], color: accent },
      { size: [0.06, 0.12, 0.07], at: [0, -0.09, 0.005], color: GUN_GRIP, rot: [-0.3, 0, 0] },
      { size: [0.075, 0.075, 0.32], at: [0, 0.025, -0.35], color: GUN_STEEL },
      { size: [0.055, 0.055, 0.26], at: [0, -0.05, -0.32], color: GUN_DARK },
      { size: [0.115, 0.10, 0.14], at: [0, -0.012, -0.26], color: accent },
      { size: [0.03, 0.035, 0.03], at: [0, 0.075, -0.50], color: GUN_STEEL },
    ];
    case 5: return [ // AWP — longest barrel plus a fat scope block; the only gun that overhangs its own pad
      { size: [0.07, 0.15, 0.28], at: [0, -0.025, 0], color: GUN_DARK },
      { size: [0.085, 0.09, 0.22], at: [0, 0.005, -0.24], color: GUN_DARK },
      { size: [0.05, 0.06, 0.04], at: [0, 0.065, -0.13], color: GUN_DARK },
      { size: [0.05, 0.06, 0.04], at: [0, 0.065, -0.33], color: GUN_DARK },
      { size: [0.07, 0.07, 0.30], at: [0, 0.115, -0.23], color: GUN_STEEL },
      { size: [0.085, 0.03, 0.12], at: [0, 0.155, -0.23], color: accent },
      { size: [0.055, 0.13, 0.06], at: [0, -0.095, -0.07], color: GUN_GRIP, rot: [-0.3, 0, 0] },
      { size: [0.05, 0.10, 0.09], at: [0, -0.085, -0.27], color: GUN_GRIP },
      { size: [0.045, 0.045, 0.32], at: [0, 0.005, -0.51], color: GUN_STEEL },
      { size: [0.065, 0.065, 0.06], at: [0, 0.005, -0.70], color: GUN_STEEL },
      { size: [0.02, 0.15, 0.02], at: [-0.05, -0.075, -0.60], color: GUN_DARK, rot: [0, 0, -0.38] },
      { size: [0.02, 0.15, 0.02], at: [0.05, -0.075, -0.60], color: GUN_DARK, rot: [0, 0, 0.38] },
    ];
    case 6: return [ // LMG — heaviest: the wide ammo box and splayed bipod give it the broadest top view
      { size: [0.07, 0.13, 0.17], at: [0, -0.01, 0.055], color: GUN_DARK },
      { size: [0.11, 0.11, 0.24], at: [0, 0, -0.14], color: GUN_DARK },
      { size: [0.05, 0.035, 0.17], at: [0, 0.072, -0.13], color: accent },
      { size: [0.145, 0.16, 0.19], at: [0, -0.115, -0.13], color: accent },
      { size: [0.06, 0.13, 0.06], at: [0, -0.09, 0.01], color: GUN_GRIP, rot: [-0.3, 0, 0] },
      { size: [0.09, 0.09, 0.15], at: [0, 0.005, -0.33], color: GUN_DARK },
      { size: [0.055, 0.055, 0.30], at: [0, 0.005, -0.44], color: GUN_STEEL },
      { size: [0.075, 0.075, 0.06], at: [0, 0.005, -0.60], color: GUN_STEEL },
      { size: [0.022, 0.17, 0.022], at: [-0.055, -0.085, -0.50], color: GUN_DARK, rot: [0, 0, -0.4] },
      { size: [0.022, 0.17, 0.022], at: [0.055, -0.085, -0.50], color: GUN_DARK, rot: [0, 0, 0.4] },
    ];
    case 1: return [ // RIFLE — baseline length; thin top rail and canted mag read as "assault rifle"
      { size: [0.06, 0.11, 0.13], at: [0, -0.015, 0.045], color: GUN_DARK },
      { size: [0.095, 0.10, 0.20], at: [0, 0, -0.10], color: GUN_DARK },
      { size: [0.05, 0.025, 0.22], at: [0, 0.062, -0.11], color: accent },
      { size: [0.045, 0.05, 0.04], at: [0, 0.085, -0.02], color: GUN_STEEL },
      { size: [0.055, 0.13, 0.06], at: [0, -0.09, 0.005], color: GUN_GRIP, rot: [-0.35, 0, 0] },
      { size: [0.05, 0.17, 0.09], at: [0, -0.115, -0.13], color: GUN_GRIP, rot: [0.22, 0, 0] },
      { size: [0.075, 0.075, 0.17], at: [0, 0, -0.29], color: GUN_DARK },
      { size: [0.04, 0.04, 0.15], at: [0, 0.005, -0.44], color: GUN_STEEL },
      { size: [0.06, 0.06, 0.05], at: [0, 0.005, -0.52], color: GUN_STEEL },
    ];
    default: return [ // PISTOL — the spawn sidearm: slimmer and shorter than even the DEAGLE, so
      // "I am still on my starting gun" reads from the silhouette alone
      { size: [0.05, 0.07, 0.18], at: [0, 0.01, -0.06], color: GUN_DARK },
      { size: [0.028, 0.018, 0.16], at: [0, 0.052, -0.06], color: accent },
      { size: [0.042, 0.025, 0.025], at: [0, 0.055, 0.015], color: GUN_STEEL },
      { size: [0.025, 0.03, 0.025], at: [0, 0.058, -0.135], color: GUN_STEEL },
      { size: [0.035, 0.035, 0.035], at: [0, 0.01, -0.163], color: GUN_STEEL },
      { size: [0.04, 0.038, 0.05], at: [0, -0.045, -0.045], color: GUN_GRIP },
      { size: [0.05, 0.15, 0.065], at: [0, -0.105, 0.035], color: GUN_GRIP, rot: [-0.3, 0, 0] },
    ];
  }
}

// One shared vertex-coloured geometry per weapon type — the held gun and every pickup of that
// weapon draw the same buffers.
const weaponGeometry = new Map();
export function gunGeometry(w) {
  const weapon = WEAPONS[w] || WEAPONS[0];
  const key = `${w}:${new THREE.Color(weapon.color).getHexString()}`;
  if (!weaponGeometry.has(key)) weaponGeometry.set(key, boxAssembly(weaponParts(w, weapon.color)));
  return weaponGeometry.get(key);
}
// Mesh at the origin — the caller owns placement (entities.js hangs it off the operator's hands).
export function gunMesh(w) {
  return new THREE.Mesh(gunGeometry(w), new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// ---------- ground pickup ----------
// The gun itself is the pickup, but a bare gun is a thin dark line at this camera distance — the
// coloured pad underneath is what stays findable across the map, so keep both.
const PICKUP_SPAN = 1.25, PICKUP_SCALE_MIN = 1.6, PICKUP_SCALE_MAX = 2.2, PICKUP_HOVER = 0.52;
const PAD_GEOMETRY = new THREE.CylinderGeometry(0.62, 0.62, 0.05, 14);
const PAD_MARKER_GEOMETRY = new THREE.CylinderGeometry(0.46, 0.46, 0.06, 14);
sharedGeometries.add(PAD_GEOMETRY); sharedGeometries.add(PAD_MARKER_GEOMETRY);
export function weaponPickupModel(w) {
  const weapon = WEAPONS[w] || WEAPONS[0];
  const group = new THREE.Group();
  const pad = new THREE.Mesh(PAD_GEOMETRY, new THREE.MeshLambertMaterial({ color: 0x2b2721 }));
  pad.position.y = 0.05;
  const marker = new THREE.Mesh(PAD_MARKER_GEOMETRY, new THREE.MeshLambertMaterial({ color: weapon.color }));
  marker.position.y = 0.11;
  const geometry = gunGeometry(w);
  const gun = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  // Normalise on length rather than one flat factor — at a single scale the pistol reads as debris
  // beside the AWP. Clamped, so the sniper still lies visibly longer than everything else.
  const span = geometry.boundingBox.getSize(new THREE.Vector3()).z;
  const scale = Math.min(PICKUP_SCALE_MAX, Math.max(PICKUP_SCALE_MIN, PICKUP_SPAN / span));
  gun.scale.setScalar(scale);
  // Weapon space has its origin at the trigger, well behind the model's middle. Recentre on the
  // bounding box or main.js's rotation.y spin makes the muzzle orbit the pad instead of turning
  // on the spot. Left flat and bore-up: the top-down camera then sees the full silhouette.
  const centre = geometry.boundingBox.getCenter(new THREE.Vector3());
  gun.position.set(-centre.x * scale, PICKUP_HOVER - centre.y * scale, -centre.z * scale);
  group.add(pad, marker, gun);
  return group;
}
