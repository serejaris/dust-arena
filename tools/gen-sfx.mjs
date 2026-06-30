// Generates game SFX via ElevenLabs: sound-generation API for effects, TTS for the announcer.
// Key source: ELEVENLABS_API_KEY env or ~/.config/elevenlabs/key. The key is never printed.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sfx');
mkdirSync(OUT, { recursive: true });

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  try { return readFileSync(join(os.homedir(), '.config', 'elevenlabs', 'key'), 'utf8').trim(); }
  catch { console.error('No API key: set ELEVENLABS_API_KEY or put it in ~/.config/elevenlabs/key'); process.exit(1); }
}
const KEY = apiKey();
const H = { 'xi-api-key': KEY, 'Content-Type': 'application/json' };

const SFX = [
  ['shot', 'Single gunshot from an AK-47 assault rifle, sharp loud crack with a short tail, close perspective, dry, no music, no voice', 0.8],
  ['reload', 'Assault rifle reload: magazine release click, new magazine inserted with a snap, charging handle racked, mechanical, no voice', 2.0],
  ['step', 'One single quick footstep on dry sand and gravel, soft scuff, very short', 0.5],
  ['headshot', 'Sharp metallic ding of a bullet ricocheting off a steel helmet, short bright ping', 0.6],
  ['hit', 'Short punchy digital hit marker tick, video game UI shot feedback, dry click', 0.5],
  ['death', 'Body collapsing onto dusty ground with light tactical gear rattle, short heavy thud', 0.9],
  ['medkit', 'Bright positive healing pickup chime, video game item pickup, two ascending notes', 0.8],
];

// deep announcer voice (premade "Adam")
const VOICE = 'pNInz6obpgDQGcFmaJgB';
const TTS = [
  ['onfire', 'On fire!'],
  ['rampage', 'Rampage!'],
  ['godlike', 'God like!'],
  ['unstoppable', 'Unstoppable!'],
  ['roundstart', 'Round start. Go go go!'],
  ['roundover', 'Round over.'],
];

async function save(name, res) {
  if (!res.ok) {
    const err = (await res.text()).slice(0, 300);
    console.error(`✗ ${name}: HTTP ${res.status} ${err}`);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(OUT, name + '.mp3'), buf);
  console.log(`✓ ${name}.mp3  ${(buf.length / 1024).toFixed(1)} KB`);
  return true;
}

let fails = 0;
for (const [name, text, duration] of SFX) {
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST', headers: H,
    body: JSON.stringify({ text, duration_seconds: duration, prompt_influence: 0.4 }),
  });
  if (!await save(name, res)) fails++;
}
for (const [name, text] of TTS) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      text, model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.7 },
    }),
  });
  if (!await save(name, res)) fails++;
}
console.log(fails ? `done with ${fails} failures` : 'all sounds generated');
process.exit(fails ? 1 : 0);
