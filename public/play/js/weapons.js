// weapons.js — WEAPONS[] (client mirror of server.js WEAPONS — id = index, 0 = pistol, the spawn
// sidearm every operator starts and respawns with; map pickups only ever hand out ids 1..6)
import { S } from './state.js';

export const WEAPONS = [
  // dmg mirrors server.js's WEAPONS table (the only authority for actual damage dealt) — the client
  // never applies it to hp itself, but hit-feedback (#5: hitmark pitch, shake/knockback amplitude)
  // scales by it, so it has to match exactly.
  { name: 'PISTOL',  dmg: 22,  mag: 12,  fireMs: 260,  range: 26, sndRate: 0.9,  sndVol: 0.22, spreadMul: 1.5, color: 0x8fa3b5 },
  { name: 'RIFLE',   dmg: 18,  mag: 30,  fireMs: 110,  range: 40, sndRate: 1.0,  sndVol: 0.25, spreadMul: 1.0, color: 0xffce54 },
  { name: 'SMG',     dmg: 12,  mag: 40,  fireMs: 70,   range: 30, sndRate: 1.25, sndVol: 0.18, spreadMul: 1.3, color: 0x4fd0e0 },
  { name: 'DEAGLE',  dmg: 50,  mag: 7,   fireMs: 350,  range: 36, sndRate: 0.8,  sndVol: 0.4,  spreadMul: 1.8, color: 0xd8d8d8 },
  { name: 'SHOTGUN', dmg: 65,  mag: 6,   fireMs: 650,  range: 14, sndRate: 0.55, sndVol: 0.5,  spreadMul: 2.2, color: 0xff8a3a },
  { name: 'AWP',     dmg: 100, mag: 5,   fireMs: 1500, range: 62, sndRate: 0.45, sndVol: 0.55, spreadMul: 0.4, color: 0x7CFC00 },
  { name: 'LMG',     dmg: 16,  mag: 100, fireMs: 90,   range: 38, sndRate: 1.1,  sndVol: 0.3,  spreadMul: 1.4, color: 0xff5544 },
];
S.myW = 0;
export const curW = () => WEAPONS[S.myW];
S.curRange = WEAPONS[0].range; // hitscan range cap (Brawl-Stars rule: no cross-map shots) — varies by held weapon
