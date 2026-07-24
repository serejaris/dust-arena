// vision-field.js — passive screen-space presentation of the existing fog rule.
import * as THREE from 'three';
import { S } from './state.js';
import { SPECTATE } from './net.js';
import { nearestWallT } from './combat.js';
import { VISION_NEAR_RADIUS, VISION_CONE_HALF_ANGLE_DEG, VISION_RAY_COUNT } from './vision-policy.js';

export { VISION_NEAR_RADIUS, VISION_CONE_HALF_ANGLE_DEG, VISION_RAY_COUNT };

const MAP_EXTENT = 75;
const NEAR_SEGMENTS = 32;
const HALF_CONE = VISION_CONE_HALF_ANGLE_DEG * Math.PI / 180;
const UPDATE_MS = 1000 / 30;
// Cold slate over warm sand (#c9b074): the hue shift makes the fogged half read
// as "another place" instantly, while 0.78 still leaves wall silhouettes legible.
const VEIL = 'rgba(10, 16, 44, 0.78)';
// Feather ramp: [stroke width, erase strength] centred on the field outline. Layered
// destination-out strokes fade the veil back in over ~14px instead of the old hard
// cut. Canvas blur/gradient shading measured 5-7x more expensive per redraw than
// these path passes, and the fog redraws on every camera move.
const FEATHER = [[4, 0.55], [9, 0.35], [17, 0.22], [28, 0.12]];
const RIM_GLOW = 'rgba(255, 214, 138, 0.07)';
const RIM_LINE = 'rgba(255, 236, 184, 0.28)';
const projected = new THREE.Vector3();
const cameraState = new Float32Array(16);
// Ray distances of the last built fan, shared with the minimap so the tactical
// map can dim the same shape without spending extra nearestWallT queries.
export const visionSample = {
  ready: false,
  x: 0,
  z: 0,
  forward: 0,
  halfCone: HALF_CONE,
  nearRadius: VISION_NEAR_RADIUS,
  rays: new Float32Array(VISION_RAY_COUNT + 1),
};
let canvas;
let ctx;
let nearPath;
let fanPath;
let fieldPath;
let width = 0;
let height = 0;
let pixelRatio = 0;
let lastDraw = -Infinity;
let cameraReady = false;
let lastPosX = 0;
let lastPosZ = 0;
let lastAimX = 0;
let lastAimZ = 0;

function ensureSize() {
  const nextWidth = innerWidth;
  const nextHeight = innerHeight;
  const nextRatio = Math.min(devicePixelRatio, 1.5);
  if (nextWidth === width && nextHeight === height && nextRatio === pixelRatio) return false;
  width = nextWidth;
  height = nextHeight;
  pixelRatio = nextRatio;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return true;
}

function projectWorld(x, z) {
  projected.set(x, 0.08, z).project(S.camera);
  return projected;
}

function screenX() { return (projected.x * 0.5 + 0.5) * width; }
function screenY() { return (1 - (projected.y * 0.5 + 0.5)) * height; }

function mapLimit(x, z, dx, dz) {
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (MAP_EXTENT - x) / dx);
  else if (dx < 0) t = Math.min(t, (-MAP_EXTENT - x) / dx);
  if (dz > 0) t = Math.min(t, (MAP_EXTENT - z) / dz);
  else if (dz < 0) t = Math.min(t, (-MAP_EXTENT - z) / dz);
  return Math.max(0, t);
}

function buildNearPath(path) {
  for (let i = 0; i <= NEAR_SEGMENTS; i++) {
    const angle = i * Math.PI * 2 / NEAR_SEGMENTS;
    projectWorld(S.pos.x + Math.cos(angle) * VISION_NEAR_RADIUS, S.pos.z + Math.sin(angle) * VISION_NEAR_RADIUS);
    if (i === 0) path.moveTo(screenX(), screenY());
    else path.lineTo(screenX(), screenY());
  }
  path.closePath();
}

function getForwardAngle() {
  let x = S.aimPoint.x - S.pos.x;
  let z = S.aimPoint.z - S.pos.z;
  if (Math.hypot(x, z) < 1e-4) {
    x = -Math.sin(S.yaw);
    z = -Math.cos(S.yaw);
  }
  return Math.atan2(z, x);
}

function buildFanPath(path) {
  const x = S.pos.x;
  const z = S.pos.z;
  const forward = getForwardAngle();
  projectWorld(x, z);
  path.moveTo(screenX(), screenY());
  for (let i = 0; i <= VISION_RAY_COUNT; i++) {
    const angle = forward - HALF_CONE + (HALF_CONE * 2 * i / VISION_RAY_COUNT);
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    // One shared wall query per sampled ray. The stored path is then reused for all passes.
    const distance = Math.min(mapLimit(x, z, dx, dz), nearestWallT(x, z, dx, dz));
    visionSample.rays[i] = distance;
    projectWorld(x + dx * distance, z + dz * distance);
    path.lineTo(screenX(), screenY());
  }
  path.closePath();
  visionSample.x = x;
  visionSample.z = z;
  visionSample.forward = forward;
}

function cameraOrPlayerChanged(resized) {
  if (resized || !cameraReady || S.pos.x !== lastPosX || S.pos.z !== lastPosZ || S.aimPoint.x !== lastAimX || S.aimPoint.z !== lastAimZ) return true;
  const matrix = S.camera.matrixWorld.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(matrix[i] - cameraState[i]) > 1e-4) return true;
  return false;
}

function rememberFieldState() {
  lastPosX = S.pos.x;
  lastPosZ = S.pos.z;
  lastAimX = S.aimPoint.x;
  lastAimZ = S.aimPoint.z;
  const matrix = S.camera.matrixWorld.elements;
  for (let i = 0; i < 16; i++) cameraState[i] = matrix[i];
  cameraReady = true;
}

// Rim passes are clipped to the fogged side of each shape (rect + shape, even-odd),
// so the near bubble never draws a seam across the lit cone and vice versa.
function outsideOf(shape) {
  const mask = new Path2D();
  mask.rect(0, 0, width, height);
  mask.addPath(shape);
  return mask;
}

function strokeRim(shape, clipTo) {
  ctx.save();
  ctx.clip(outsideOf(clipTo), 'evenodd');
  ctx.strokeStyle = RIM_GLOW;
  ctx.lineWidth = 13;
  ctx.stroke(shape);
  ctx.strokeStyle = RIM_LINE;
  ctx.lineWidth = 1.4;
  ctx.stroke(shape);
  ctx.restore();
}

function redrawField() {
  nearPath = new Path2D();
  fanPath = new Path2D();
  buildNearPath(nearPath);
  buildFanPath(fanPath);
  fieldPath = new Path2D();
  fieldPath.addPath(nearPath);
  fieldPath.addPath(fanPath);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = VEIL;
  ctx.fillRect(0, 0, width, height);

  // The fill clears the lit core outright; the ramp strokes straddle the outline and
  // let the veil build back up gradually. Both run on the union path, so the seams
  // where the near bubble meets the cone are already erased and stay invisible.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.fill(fieldPath);
  for (const [lineWidth, strength] of FEATHER) {
    ctx.globalAlpha = strength;
    ctx.lineWidth = lineWidth;
    ctx.stroke(fieldPath);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  strokeRim(nearPath, fanPath);
  strokeRim(fanPath, nearPath);
}

export function initVisibilityField() {
  canvas = document.querySelector('[data-visibility-field]');
  ctx = canvas.getContext('2d');
  canvas.hidden = true;
}

export function updateVisibilityField(now) {
  if (!canvas) return;
  const hide = SPECTATE || S.dead || !S.me || !S.ws;
  if (canvas.hidden !== hide) canvas.hidden = hide;
  if (hide) { lastDraw = -Infinity; visionSample.ready = false; return; }
  if (now - lastDraw < UPDATE_MS) return;

  const resized = ensureSize();
  S.camera.updateMatrixWorld();
  lastDraw = now;
  if (!cameraOrPlayerChanged(resized)) return;
  redrawField();
  rememberFieldState();
  visionSample.ready = true;
}
