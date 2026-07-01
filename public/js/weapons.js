// weapons.js — WEAPONS[] (client mirror of server.js WEAPONS — id = index, 0 = rifle default)
import { S } from './state.js';

export const WEAPONS = [
  { name: 'RIFLE',   mag: 30,  fireMs: 110,  range: 40, sndRate: 1.0,  sndVol: 0.25, spreadMul: 1.0, color: 0xffce54 },
  { name: 'SMG',     mag: 40,  fireMs: 70,   range: 30, sndRate: 1.25, sndVol: 0.18, spreadMul: 1.3, color: 0x4fd0e0 },
  { name: 'DEAGLE',  mag: 7,   fireMs: 350,  range: 36, sndRate: 0.8,  sndVol: 0.4,  spreadMul: 1.8, color: 0xd8d8d8 },
  { name: 'SHOTGUN', mag: 6,   fireMs: 650,  range: 14, sndRate: 0.55, sndVol: 0.5,  spreadMul: 2.2, color: 0xff8a3a },
  { name: 'AWP',     mag: 5,   fireMs: 1500, range: 62, sndRate: 0.45, sndVol: 0.55, spreadMul: 0.4, color: 0x7CFC00 },
  { name: 'LMG',     mag: 100, fireMs: 90,   range: 38, sndRate: 1.1,  sndVol: 0.3,  spreadMul: 1.4, color: 0xff5544 },
];
S.myW = 0;
export const curW = () => WEAPONS[S.myW];
S.curRange = WEAPONS[0].range; // hitscan range cap (Brawl-Stars rule: no cross-map shots) — varies by held weapon
