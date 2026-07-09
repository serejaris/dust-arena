// Generates game SFX, Russian announcer voices, and music through ElevenLabs.
// Key source: ELEVENLABS_API_KEY env or ~/.config/elevenlabs/key. The key is never printed.
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sfx');
const API = 'https://api.elevenlabs.io/v1';
const TTS_VOICE = 'pNInz6obpgDQGcFmaJgB';
const MODES = new Set(['sfx', 'voices', 'music', 'all']);
const mode = process.argv[2];

const SFX = [
  ['shot', 'Single gunshot from an AK-47 assault rifle, sharp loud crack with a short tail, close perspective, dry, no music, no voice', 0.8],
  ['reload', 'Assault rifle reload: magazine release click, new magazine inserted with a snap, charging handle racked, mechanical, no voice', 2.0],
  ['step', 'One single quick footstep on dry sand and gravel, soft scuff, very short', 0.5],
  ['headshot', 'Sharp metallic ding of a bullet ricocheting off a steel helmet, short bright ping', 0.6],
  ['hit', 'Short punchy digital hit marker tick, video game UI shot feedback, dry click', 0.5],
  ['death', 'Body collapsing onto dusty ground with light tactical gear rattle, short heavy thud', 0.9],
  ['medkit', 'Bright positive healing pickup chime, video game item pickup, two ascending notes', 0.8],
];

// Runtime semantic key -> cache-safe Russian asset name and spoken Russian text.
const VOICES = {
  onfire: ['onfire-ru.mp3', 'В огне!'],
  rampage: ['rampage-ru.mp3', 'Бойня!'],
  godlike: ['godlike-ru.mp3', 'Божественно!'],
  unstoppable: ['unstoppable-ru.mp3', 'Не остановить!'],
};
const LEGACY_VOICE_FILES = ['onfire.mp3', 'rampage.mp3', 'godlike.mp3', 'unstoppable.mp3', 'roundstart.mp3', 'roundover.mp3'];
const MUSIC_FILE = 'arena-loop.mp3';
const MUSIC_PROMPT = 'Instrumental 60-second seamless loop for a desert tactical arena score at 120 BPM: dry hand percussion, restrained electronic pulse, sparse sub-bass, distant desert wind, open midrange for gunfire and announcer. No vocals, speech, chant, hooks, stingers, drops, gunshots, explosions, or UI sounds.';

function usage() {
  console.error('Usage: node tools/gen-sfx.mjs <sfx|voices|music|all>');
}

function apiKey() {
  const envKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (envKey) return envKey;
  try {
    const fileKey = readFileSync(join(os.homedir(), '.config', 'elevenlabs', 'key'), 'utf8').trim();
    if (fileKey) return fileKey;
  } catch {}
  throw new Error('No ElevenLabs API key: set ELEVENLABS_API_KEY or put it in ~/.config/elevenlabs/key');
}

function headers() {
  return { 'xi-api-key': apiKey(), 'Content-Type': 'application/json' };
}

async function saveMp3(filename, response) {
  if (!response.ok) {
    console.error(`✗ ${filename}: HTTP ${response.status}`);
    return false;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    console.error(`✗ ${filename}: empty audio response`);
    return false;
  }
  const temp = join(OUT, `.${filename}.tmp`);
  writeFileSync(temp, buffer);
  renameSync(temp, join(OUT, filename));
  console.log(`✓ ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
  return true;
}

async function generateSfx() {
  let failures = 0;
  for (const [name, text, duration] of SFX) {
    const response = await fetch(`${API}/sound-generation`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ text, duration_seconds: duration, prompt_influence: 0.4 }),
    });
    if (!await saveMp3(`${name}.mp3`, response)) failures++;
  }
  return failures === 0;
}

async function generateVoices() {
  let failures = 0;
  for (const [, [filename, text]] of Object.entries(VOICES)) {
    const response = await fetch(`${API}/text-to-speech/${TTS_VOICE}?output_format=mp3_44100_128`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.7 },
      }),
    });
    if (!await saveMp3(filename, response)) failures++;
  }
  if (failures === 0) {
    for (const filename of LEGACY_VOICE_FILES) rmSync(join(OUT, filename), { force: true });
  }
  return failures === 0;
}

async function generateMusic() {
  const response = await fetch(`${API}/music?output_format=mp3_44100_128`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({
      prompt: MUSIC_PROMPT,
      model_id: 'music_v2',
      music_length_ms: 60_000,
      force_instrumental: true,
      generation_mode: 'loop',
    }),
  });
  return saveMp3(MUSIC_FILE, response);
}

async function main() {
  if (!MODES.has(mode)) {
    usage();
    process.exitCode = 1;
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const tasks = mode === 'all'
    ? [generateSfx, generateVoices, generateMusic]
    : mode === 'sfx' ? [generateSfx]
      : mode === 'voices' ? [generateVoices]
        : [generateMusic];
  let failed = false;
  for (const generate of tasks) failed ||= !await generate();
  process.exitCode = failed ? 1 : 0;
}

await main();
