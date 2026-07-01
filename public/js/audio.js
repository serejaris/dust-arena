// audio.js — AudioContext, SFX, play(), procedural fallbacks
import { showMsg } from './hud.js';

export const AC = new (window.AudioContext || window.webkitAudioContext)();
const master = AC.createGain();
master.connect(AC.destination);
let muted = false;
export function toggleMute() {
  muted = !muted;
  master.gain.value = muted ? 0 : 1;
  showMsg(muted ? 'SOUND OFF' : 'SOUND ON', 900);
}
// ElevenLabs-generated SFX; procedural synthesis stays as fallback when a file is missing
const SFX = {};
const SFX_NAMES = ['shot', 'reload', 'step', 'hit', 'death', 'medkit', 'onfire', 'rampage', 'godlike', 'unstoppable', 'roundstart', 'roundover'];
for (const n of SFX_NAMES) {
  fetch('sfx/' + n + '.mp3')
    .then(r => r.ok ? r.arrayBuffer() : Promise.reject())
    .then(b => AC.decodeAudioData(b))
    .then(buf => SFX[n] = buf)
    .catch(() => {});
}
export function play(name, vol = 1, pan = 0, rate = 1) {
  const buf = SFX[name];
  if (!buf) return false;
  const src = AC.createBufferSource();
  src.buffer = buf; src.playbackRate.value = rate;
  const g = AC.createGain(); g.gain.value = vol;
  src.connect(g);
  if (pan && AC.createStereoPanner) {
    const p = AC.createStereoPanner(); p.pan.value = pan;
    g.connect(p).connect(master);
  } else g.connect(master);
  src.start();
  return true;
}
export function blip() {
  const t = AC.currentTime;
  const o = AC.createOscillator(); o.type = 'square'; o.frequency.value = 1150;
  const g = AC.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o.connect(g).connect(master); o.start(); o.stop(t + 0.08);
}
export function healSound() {
  const t = AC.currentTime;
  const o = AC.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(500, t); o.frequency.linearRampToValueAtTime(950, t + 0.18);
  const g = AC.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  o.connect(g).connect(master); o.start(); o.stop(t + 0.3);
}
export function shotSound(vol = 0.25, pan = 0, rate = 1) {
  if (play('shot', Math.min(1, vol * 2.6), pan, (0.94 + Math.random() * 0.12) * rate)) return;
  const t = AC.currentTime;
  const buf = AC.createBuffer(1, 2205, 44100);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  const src = AC.createBufferSource(); src.buffer = buf;
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  src.connect(g);
  if (pan && AC.createStereoPanner) {
    const p = AC.createStereoPanner(); p.pan.value = pan;
    g.connect(p).connect(master);
  } else g.connect(master);
  src.start();
}
