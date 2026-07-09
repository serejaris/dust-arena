// audio.js — AudioContext, routed SFX/music, and procedural SFX fallbacks.
import { showMsg } from './hud.js';

export const AC = new (window.AudioContext || window.webkitAudioContext)();
const master = AC.createGain();
const sfxBus = AC.createGain();
const musicBus = AC.createGain();
master.connect(AC.destination);
sfxBus.connect(master);
musicBus.connect(master);
musicBus.gain.value = 0.055;

let muted = false;
export function toggleMute() {
  muted = !muted;
  master.gain.value = muted ? 0 : 1;
  showMsg(muted ? 'SOUND OFF' : 'SOUND ON', 900);
}

// Semantic keys stay stable while language/versioned files can be cache-busted safely.
const SFX = Object.create(null);
const AUDIO_FILES = {
  shot: 'shot.mp3', reload: 'reload.mp3', step: 'step.mp3', hit: 'hit.mp3',
  death: 'death.mp3', medkit: 'medkit.mp3', headshot: 'headshot.mp3',
  onfire: 'onfire-ru.mp3', rampage: 'rampage-ru.mp3',
  godlike: 'godlike-ru.mp3', unstoppable: 'unstoppable-ru.mp3',
};
const ANNOUNCER_KEYS = new Set(['onfire', 'rampage', 'godlike', 'unstoppable']);
for (const [name, filename] of Object.entries(AUDIO_FILES)) {
  fetch(`sfx/${filename}`)
    .then(response => response.ok ? response.arrayBuffer() : Promise.reject())
    .then(bytes => AC.decodeAudioData(bytes))
    .then(buffer => { SFX[name] = buffer; })
    .catch(() => {});
}

let musicBuffer = null;
let musicStarted = false;
let musicAllowed = false;
let duckUntil = 0;
fetch('sfx/arena-loop.mp3')
  .then(response => response.ok ? response.arrayBuffer() : Promise.reject())
  .then(bytes => AC.decodeAudioData(bytes))
  .then(buffer => {
    musicBuffer = buffer;
    startMusicIfReady();
  })
  .catch(() => {});

function startMusicIfReady() {
  if (!musicAllowed || musicStarted || !musicBuffer || AC.state !== 'running') return;
  musicStarted = true;
  const source = AC.createBufferSource();
  source.buffer = musicBuffer;
  source.loop = true;
  source.connect(musicBus);
  source.start();
}

// Must be called from a user gesture. The decode may complete before or after it.
export function resumeAudio() {
  musicAllowed = true;
  const resumed = AC.state === 'running' ? Promise.resolve() : AC.resume();
  resumed.then(startMusicIfReady).catch(() => {});
  startMusicIfReady();
}

function duckMusic(duration) {
  const now = AC.currentTime;
  const restoreAt = Math.max(duckUntil, now + duration);
  duckUntil = restoreAt;
  if (musicBus.gain.cancelAndHoldAtTime) musicBus.gain.cancelAndHoldAtTime(now);
  else {
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setValueAtTime(musicBus.gain.value, now);
  }
  musicBus.gain.linearRampToValueAtTime(0.02, now + 0.035);
  musicBus.gain.setValueAtTime(0.02, restoreAt);
  musicBus.gain.linearRampToValueAtTime(0.055, restoreAt + 0.18);
}

function connectSfx(source, gain, pan) {
  source.connect(gain);
  if (pan && AC.createStereoPanner) {
    const panner = AC.createStereoPanner();
    panner.pan.value = pan;
    gain.connect(panner).connect(sfxBus);
    return panner;
  }
  gain.connect(sfxBus);
  return null;
}

export function play(name, vol = 1, pan = 0, rate = 1) {
  const buffer = SFX[name];
  if (!buffer) return false;
  if (ANNOUNCER_KEYS.has(name)) duckMusic(buffer.duration / Math.max(rate, 0.01));
  const source = AC.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const gain = AC.createGain();
  gain.gain.value = vol;
  const panner = connectSfx(source, gain, pan);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    panner?.disconnect();
  };
  source.start();
  return true;
}

export function blip(freq = 1150, vol = 0.06) {
  const time = AC.currentTime;
  const oscillator = AC.createOscillator();
  oscillator.type = 'square';
  oscillator.frequency.value = freq;
  const gain = AC.createGain();
  gain.gain.setValueAtTime(vol, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
  oscillator.connect(gain).connect(sfxBus);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start();
  oscillator.stop(time + 0.08);
}

// hit-confirm variation for hitmark()'s fallback (#5), pitched/volumed by weapon damage.
export function hitConfirm(dmg = 18) {
  const freq = Math.max(650, 1500 - dmg * 7);
  const vol = 0.055 + Math.min(1, dmg / 100) * 0.05;
  blip(freq, vol);
}

export function healSound() {
  const time = AC.currentTime;
  const oscillator = AC.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(500, time);
  oscillator.frequency.linearRampToValueAtTime(950, time + 0.18);
  const gain = AC.createGain();
  gain.gain.setValueAtTime(0.12, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
  oscillator.connect(gain).connect(sfxBus);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start();
  oscillator.stop(time + 0.3);
}

export function shotSound(vol = 0.25, pan = 0, rate = 1) {
  if (play('shot', Math.min(1, vol * 2.6), pan, (0.94 + Math.random() * 0.12) * rate)) return;
  const time = AC.currentTime;
  const buffer = AC.createBuffer(1, 2205, 44100);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const source = AC.createBufferSource();
  source.buffer = buffer;
  const gain = AC.createGain();
  gain.gain.setValueAtTime(vol, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
  const panner = connectSfx(source, gain, pan);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    panner?.disconnect();
  };
  source.start();
}
