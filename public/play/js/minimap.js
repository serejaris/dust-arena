// minimap.js — static map raster plus a throttled, disclosure-safe tactical layer.
import { S } from './state.js';
import { SPECTATE } from './net.js';
import { mapDescriptor, medkitMeshes, weaponMeshes, armorMeshes, boostMeshes } from './world.js';
import { MAP_EXTENT, canDrawRemote, worldToMap } from './minimap-policy.js';
import { visionSample } from './vision-field.js';

const MAP_SPAN = MAP_EXTENT * 2;
const UPDATE_MS = 100;
const TEAM_COLORS = ['#e6b85a', '#62a0e6'];
// Matches the screen-space veil hue so both surfaces read as the same fog.
const FOG_VEIL = 'rgba(8, 12, 30, 0.56)';
let canvas;
let ctx;
let staticCanvas;
let staticCtx;
let arrowPath;
let rasterPixels = 0;
const policyState = { myTeam: 0, spectator: false, localDead: false };
let lastDraw = -Infinity;

function drawStaticMap(pixels) {
  staticCanvas.width = pixels;
  staticCanvas.height = pixels;
  staticCtx.fillStyle = '#20231b';
  staticCtx.fillRect(0, 0, pixels, pixels);

  const scale = pixels / MAP_SPAN;
  staticCtx.lineWidth = Math.max(1, pixels / 320);
  for (const box of mapDescriptor.boxes) {
    const origin = worldToMap(box.x - box.w / 2, box.z - box.d / 2, pixels);
    const x = origin.x;
    const y = origin.y;
    staticCtx.fillStyle = box.c;
    staticCtx.globalAlpha = box.h >= 1.2 ? 0.92 : 0.62;
    staticCtx.fillRect(x, y, box.w * scale, box.d * scale);
    staticCtx.strokeStyle = 'rgba(23, 26, 18, 0.45)';
    staticCtx.strokeRect(x, y, box.w * scale, box.d * scale);
  }
  staticCtx.globalAlpha = 1;
  staticCtx.strokeStyle = 'rgba(225, 213, 161, 0.7)';
  staticCtx.strokeRect(0.5, 0.5, pixels - 1, pixels - 1);
}

function ensureRaster() {
  const cssPixels = Math.min(canvas.clientWidth, canvas.clientHeight);
  const pixels = Math.max(1, Math.round(cssPixels * Math.min(devicePixelRatio, 2)));
  if (pixels === rasterPixels) return pixels;
  rasterPixels = pixels;
  canvas.width = pixels;
  canvas.height = pixels;
  drawStaticMap(pixels);
  return pixels;
}

function outsideOf(shape, pixels) {
  const mask = new Path2D();
  mask.rect(0, 0, pixels, pixels);
  mask.addPath(shape);
  return mask;
}

// Terrain the local player cannot see is dimmed with the very rays the screen-space
// fog already sampled this frame — no extra wall queries, and no marker is disclosed.
function drawFogVeil(pixels) {
  const scale = pixels / MAP_SPAN;
  const originX = (visionSample.x + MAP_EXTENT) * scale;
  const originY = (visionSample.z + MAP_EXTENT) * scale;
  const rays = visionSample.rays;
  const step = visionSample.halfCone * 2 / (rays.length - 1);

  const near = new Path2D();
  near.arc(originX, originY, visionSample.nearRadius * scale, 0, Math.PI * 2);
  const fan = new Path2D();
  fan.moveTo(originX, originY);
  for (let i = 0; i < rays.length; i++) {
    const angle = visionSample.forward - visionSample.halfCone + step * i;
    fan.lineTo(originX + Math.cos(angle) * rays[i] * scale, originY + Math.sin(angle) * rays[i] * scale);
  }
  fan.closePath();

  // Successive even-odd clips intersect into "outside the bubble AND outside the cone";
  // filling both shapes as one path would double-darken where they overlap.
  ctx.save();
  ctx.clip(outsideOf(near, pixels), 'evenodd');
  ctx.clip(outsideOf(fan, pixels), 'evenodd');
  ctx.fillStyle = FOG_VEIL;
  ctx.fillRect(0, 0, pixels, pixels);
  ctx.restore();
}

function drawPickupMarkers(meshes, color, pixels, radius) {
  const scale = pixels / MAP_SPAN;
  ctx.fillStyle = color;
  for (const mesh of meshes) {
    if (!mesh.visible) continue;
    const x = (mesh.position.x + MAP_EXTENT) * scale;
    const y = (mesh.position.z + MAP_EXTENT) * scale;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

function drawRemoteMarkers(pixels, radius) {
  const scale = pixels / MAP_SPAN;
  policyState.myTeam = S.myTeam;
  policyState.spectator = SPECTATE;
  policyState.localDead = S.dead;
  for (const remote of S.remotes.values()) {
    if (!canDrawRemote(remote, policyState)) continue;
    const x = (remote.group.position.x + MAP_EXTENT) * scale;
    const y = (remote.group.position.z + MAP_EXTENT) * scale;
    ctx.fillStyle = remote.team === S.myTeam ? TEAM_COLORS[remote.team] : '#ed7154';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLocalArrow(pixels, radius) {
  const scale = pixels / MAP_SPAN;
  const x = (S.pos.x + MAP_EXTENT) * scale;
  const y = (S.pos.z + MAP_EXTENT) * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(S.yaw);
  ctx.fillStyle = '#fff5bf';
  ctx.fill(arrowPath);
  ctx.strokeStyle = '#24261c';
  ctx.lineWidth = Math.max(1, radius * 0.38);
  ctx.stroke(arrowPath);
  ctx.restore();
}

export function initMinimap() {
  canvas = document.querySelector('[data-minimap]');
  ctx = canvas.getContext('2d', { alpha: false });
  staticCanvas = document.createElement('canvas');
  staticCtx = staticCanvas.getContext('2d', { alpha: false });
  arrowPath = new Path2D();
  arrowPath.moveTo(0, -5);
  arrowPath.lineTo(3.5, 4);
  arrowPath.lineTo(0, 2.2);
  arrowPath.lineTo(-3.5, 4);
  arrowPath.closePath();
  canvas.hidden = true;
}

export function updateMinimap(now, scoreboardOpen) {
  if (!canvas) return;
  const hide = SPECTATE || !S.me || scoreboardOpen;
  if (canvas.hidden !== hide) canvas.hidden = hide;
  if (hide || now - lastDraw < UPDATE_MS) return;
  lastDraw = now;

  const pixels = ensureRaster();
  const radius = Math.max(2, pixels / 90);
  ctx.drawImage(staticCanvas, 0, 0);
  if (visionSample.ready) drawFogVeil(pixels);
  drawPickupMarkers(medkitMeshes, '#f2f2f2', pixels, radius * 0.72);
  drawPickupMarkers(weaponMeshes, '#c38d58', pixels, radius * 0.72);
  drawPickupMarkers(armorMeshes, '#85a8d4', pixels, radius * 0.72);
  drawPickupMarkers(boostMeshes, '#f0d254', pixels, radius * 0.72);
  drawRemoteMarkers(pixels, radius);
  if (!S.dead) drawLocalArrow(pixels, radius);
}
