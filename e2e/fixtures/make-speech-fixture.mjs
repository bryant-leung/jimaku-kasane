// Builds e2e/fixtures/speech-music.wav + .json: TTS speech clips over a loud music bed, with the
// exact speech intervals. Regenerate (macOS): see the header of e2e/pr-5-auto-sync.spec.ts.
// Usage: node e2e/fixtures/make-speech-fixture.mjs <dir with u1.wav..uN.wav (16 kHz mono PCM16)>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RATE = 16000;
const dir = process.argv[2];
let seed = 1234;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function readWav(file) {
  const b = readFileSync(file);
  let p = 12;
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'data') {
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
      return out;
    }
    p += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${file}`);
}

const clips = readdirSync(dir)
  .filter((f) => /^u\d+\.wav$/.test(f))
  .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
  .map((f) => readWav(path.join(dir, f)));

// Place clips with gaps; record where each clip is audible.
const placed = [];
let t = 1.0;
for (const clip of clips) {
  const first = clip.findIndex((v) => Math.abs(v) > 0.02);
  const last = clip.length - 1 - [...clip].reverse().findIndex((v) => Math.abs(v) > 0.02);
  placed.push({ at: Math.round(t * RATE), clip, start: t + first / RATE, end: t + last / RATE });
  t += clip.length / RATE + 0.4 + rand() * 2.1;
}
const total = Math.round((t + 1) * RATE);
const speech = new Float32Array(total);
for (const p of placed) speech.set(p.clip, p.at);

// Music: chord changes every 2 s + a noise hit every 0.5 s, scaled to ~0.7x speech loudness.
const music = new Float32Array(total);
const chords = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [247, 311, 370]];
for (let i = 0; i < total; i++) {
  const s = i / RATE;
  const chord = chords[Math.floor(s / 2) % chords.length];
  let v = 0;
  for (const f of chord) v += Math.sin(2 * Math.PI * f * s);
  const beat = (s % 0.5) / 0.5;
  v += (rand() * 2 - 1) * Math.exp(-beat * 25) * 2;
  music[i] = v;
}
const rms = (a) => Math.sqrt(a.reduce((n, v) => n + v * v, 0) / a.length);
const speechRms = rms(speech.filter((v) => v !== 0));
const k = (0.7 * speechRms) / rms(music);
const out = Buffer.alloc(44 + total * 2);
out.write('RIFF', 0); out.writeUInt32LE(36 + total * 2, 4); out.write('WAVEfmt ', 8);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(total * 2, 40);
for (let i = 0; i < total; i++) {
  const v = Math.max(-1, Math.min(1, (speech[i] + music[i] * k) * 0.8));
  out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
const here = import.meta.dirname;
writeFileSync(path.join(here, 'speech-music.wav'), out);
const intervals = placed.map((p) => ({ start: +p.start.toFixed(3), end: +p.end.toFixed(3) }));
writeFileSync(path.join(here, 'speech-music.json'), JSON.stringify({ rate: RATE, seconds: total / RATE, speech: intervals }, null, 2) + '\n');
console.log(`wrote ${(total / RATE).toFixed(1)} s, ${intervals.length} utterances, music/speech rms 0.7`);
