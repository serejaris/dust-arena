// visibility.js — client fog of war (#1): enemies are only rendered inside the
// view cone (facing S.aimPoint) with clear 2D line of sight, or within a close
// "sense them nearby" radius. Reuses the same wall model as bullet occlusion
// (nearestWallT/shotBlockers, combat.js) — no separate raycast logic.
// Result is cached on the remote record (r.visible) so aim-assist (input.js)
// and enemy tracers (net.js) can reuse it without recomputing.
import { S } from './state.js';
import { nearestWallT } from './combat.js';
import { SPECTATE } from './net.js';
import { triggerRevealCue } from './fx.js';
import { VISION_NEAR_RADIUS, VISION_CONE_HALF_ANGLE_DEG } from './vision-policy.js';

export const VISIBILITY_NEAR_ENTER = VISION_NEAR_RADIUS;
export const VISIBILITY_NEAR_STAY = 7;
export const VISIBILITY_CONE_ENTER_DEG = VISION_CONE_HALF_ANGLE_DEG;
export const VISIBILITY_CONE_STAY_DEG = 65;
const CONE_IN = Math.cos(VISIBILITY_CONE_ENTER_DEG * Math.PI / 180);
const CONE_OUT = Math.cos(VISIBILITY_CONE_STAY_DEG * Math.PI / 180);

export function updateVisibility() {
  // spectators and dead players see everyone (no fog); teammates are always visible (below).
  const foggy = !SPECTATE && !S.dead;
  let fx = S.aimPoint.x - S.pos.x, fz = S.aimPoint.z - S.pos.z;
  const flen = Math.hypot(fx, fz);
  if (flen > 1e-4) { fx /= flen; fz /= flen; } else { fx = 0; fz = -1; }

  for (const r of S.remotes.values()) {
    if (!foggy || r.team === S.myTeam) { r.visible = true; r.group.visible = true; r.visibilityInitialized = true; continue; }
    const dx = r.group.position.x - S.pos.x, dz = r.group.position.z - S.pos.z;
    const dist = Math.hypot(dx, dz);
    const wasVisible = r.visible === true;

    let visible = dist <= (wasVisible ? VISIBILITY_NEAR_STAY : VISIBILITY_NEAR_ENTER); // close range: any angle, no wall check
    if (!visible && dist > 1e-4) {
      const cos = (dx * fx + dz * fz) / dist;
      if (cos >= (wasVisible ? CONE_OUT : CONE_IN)) {
        const wallT = nearestWallT(S.pos.x, S.pos.z, dx / dist, dz / dist);
        visible = wallT >= dist; // no wall strictly between viewer and target
      }
    }
    r.visible = visible;
    r.group.visible = visible; // HP-bar/label are children of the group — hidden together
    if (r.visibilityInitialized && !wasVisible && visible && !r.dead) triggerRevealCue(r);
    r.visibilityInitialized = true;
  }
}
