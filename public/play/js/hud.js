// hud.js — killfeed, флэши, scoreboard, showMsg
import { S, $ } from './state.js';
import { play, hitConfirm } from './audio.js';

export const teamName = t => t === 0 ? 'ORANGE' : 'BLUE';
export const TEAM_HUD = ['#e6b85a', '#62a0e6']; // HUD tints matching server team colors
export const sb = $('scoreboard');

let msgTimer = null;
export function showMsg(text, ms) {
  $('msg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => $('msg').textContent = '', ms);
}
export function feed(text) {
  const kf = $('killfeed');
  const d = document.createElement('div'); d.textContent = text;
  kf.prepend(d);
  while (kf.children.length > 6) kf.lastChild.remove();
  setTimeout(() => d.remove(), 6000);
}
export function flash() {
  const f = $('dmgflash');
  f.style.opacity = 1; setTimeout(() => f.style.opacity = 0, 120);
}
export function healFlash() {
  const f = $('healflash');
  f.style.opacity = 1; setTimeout(() => f.style.opacity = 0, 280);
}
let hmT = null;
// dmg drives both paths' pitch: heavier weapon → lower tone, whether the sampled 'hit' sfx plays
// (via playbackRate) or the procedural hitConfirm() fallback fires (#5)
export function hitmark(dmg = 18) {
  const h = $('hitmark');
  h.style.opacity = 1;
  const rate = Math.max(0.6, 1.35 - dmg / 130);
  if (!play('hit', 0.5, 0, rate)) hitConfirm(dmg);
  clearTimeout(hmT); hmT = setTimeout(() => h.style.opacity = 0, 90);
}
// directional hit indicator — red arc on the screen edge toward the attacker, ~600ms fade (#5).
// deg is a compass bearing (0 = up/screen-north, clockwise) because the camera never yaws
// (world -Z is always screen-up, world +X is always screen-right — see input.js WASD comment).
let hitdirT = null;
export function hitDir(deg) {
  const el = $('hitdir');
  el.style.setProperty('--ang', deg + 'deg');
  el.style.opacity = 1;
  clearTimeout(hitdirT);
  hitdirT = setTimeout(() => el.style.opacity = 0, 350);
}
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export function renderScores() {
  const rows = [{ name: 'you', team: S.myTeam, kills: S.myKills, deaths: S.myDeaths, me: true },
    ...[...S.remotes.values()].map(r => ({ name: r.name, team: r.team, kills: r.kills, deaths: r.deaths }))];
  const tk = [0, 0]; for (const r of rows) tk[r.team] += r.kills;
  rows.sort((a, b) => (a.team - b.team) || (b.kills - a.kills));
  const head = `<div style="text-align:center;margin-bottom:10px;font-size:18px;font-weight:bold">` +
    `<span style="color:${TEAM_HUD[0]}">${teamName(0)} ${tk[0]}</span>` +
    `<span style="color:#8a8060"> — </span>` +
    `<span style="color:${TEAM_HUD[1]}">${tk[1]} ${teamName(1)}</span></div>`;
  sb.innerHTML = head + '<table><tr><th>player</th><th>K</th><th>D</th></tr>' +
    rows.map(r => `<tr style="color:${TEAM_HUD[r.team]}${r.me ? ';font-weight:bold' : ''}"><td>${esc(r.name)}${r.me ? ' ◄' : ''}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`).join('') + '</table>';
}
