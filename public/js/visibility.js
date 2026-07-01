// visibility.js — client fog of war (#1): enemies are only rendered inside the
// view cone (facing S.aimPoint) with clear 2D line of sight, or within a close
// "sense them nearby" radius. Reuses the same wall model as bullet occlusion
// (nearestWallT/shotBlockers, combat.js) — no separate raycast logic.
// Result is cached on the remote record (r.visible) so aim-assist (input.js)
// and enemy tracers (net.js) can reuse it without recomputing.
import { S } from './state.js';
import { nearestWallT } from './combat.js';
import { SPECTATE } from './net.js';

// hysteresis: wider "stay visible" threshold than "become visible", so a target
// sitting right on the edge doesn't flicker in/out every frame.
const CONE_IN = Math.cos(60 * Math.PI / 180);  // half-angle 60° to appear
const CONE_OUT = Math.cos(65 * Math.PI / 180); // half-angle 65° to stay visible
const NEAR_IN = 6, NEAR_OUT = 7;               // units — appear / stay-visible radius

export function updateVisibility() {
  // spectators and dead players see everyone (no fog); teammates are always visible (below).
  const foggy = !SPECTATE && !S.dead;
  let fx = S.aimPoint.x - S.pos.x, fz = S.aimPoint.z - S.pos.z;
  const flen = Math.hypot(fx, fz);
  if (flen > 1e-4) { fx /= flen; fz /= flen; } else { fx = 0; fz = -1; }

  for (const r of S.remotes.values()) {
    if (!foggy || r.team === S.myTeam) { r.visible = true; r.group.visible = true; continue; }
    const dx = r.group.position.x - S.pos.x, dz = r.group.position.z - S.pos.z;
    const dist = Math.hypot(dx, dz);
    const wasVisible = r.visible === true;

    let visible = dist <= (wasVisible ? NEAR_OUT : NEAR_IN); // close range: any angle, no wall check
    if (!visible && dist > 1e-4) {
      const cos = (dx * fx + dz * fz) / dist;
      if (cos >= (wasVisible ? CONE_OUT : CONE_IN)) {
        const wallT = nearestWallT(S.pos.x, S.pos.z, dx / dist, dz / dist);
        visible = wallT >= dist; // no wall strictly between viewer and target
      }
    }
    r.visible = visible;
    r.group.visible = visible; // HP-bar/label are children of the group — hidden together
  }
}
