// minimap-policy.js — pure coordinate and disclosure policy for the tactical map.
export const MAP_EXTENT = 75;
const MAP_SPAN = MAP_EXTENT * 2;
// World -Z is north/screen-up, so map Y follows world Z directly.
export function worldToMap(x, z, pixels) {
  return {
    x: (x + MAP_EXTENT) * pixels / MAP_SPAN,
    y: (z + MAP_EXTENT) * pixels / MAP_SPAN,
  };
}

// Teammates are strategic information; enemy markers mirror the authoritative
// fog verdict cached on each remote record, never render-group visibility.
export function canDrawRemote(remote, { myTeam, spectator, localDead }) {
  if (remote.team === myTeam) return true;
  if (spectator) return false;
  return !localDead && !remote.dead && remote.visible === true;
}
