import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Offline processing only. No credentials, network requests or app configuration.
const input = resolve('artifacts/voice-previews/2026-10-17-mecha-cn/mecha-cn-natural.wav');
const output = resolve('artifacts/voice-previews/2026-10-17-mecha-cn-v2');
const bytes = await readFile(input);
assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
assert.equal(bytes.readUInt16LE(20), 1);
assert.equal(bytes.readUInt16LE(22), 1);
assert.equal(bytes.readUInt16LE(34), 16);
const fs = bytes.readUInt32LE(24);
assert.equal(fs, 24000);
let dataOffset = 12, dataLength = 0;
while (dataOffset + 8 <= bytes.length) {
  const length = bytes.readUInt32LE(dataOffset + 4);
  if (bytes.toString('ascii', dataOffset, dataOffset + 4) === 'data') { dataLength = length; dataOffset += 8; break; }
  dataOffset += 8 + length + length % 2;
}
assert.ok(dataLength > 0 && dataOffset + dataLength <= bytes.length);
const source = Float64Array.from({ length: dataLength / 2 }, (_, i) => bytes.readInt16LE(dataOffset + i * 2) / 32768);
const interpolate = (samples, position) => {
  if (position < 0 || position >= samples.length - 1) return 0;
  const left = Math.floor(position), f = position - left;
  return samples[left] * (1 - f) + samples[left + 1] * f;
};
const slowRatio = 0.88;
const dry = Float64Array.from({ length: Math.floor(source.length / slowRatio) }, (_, i) => interpolate(source, i * slowRatio));

function filter(samples, frequency, q, kind = 'bandpass') {
  const omega = 2 * Math.PI * frequency / fs, cos = Math.cos(omega), alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
  const b0 = kind === 'highpass' ? (1 + cos) / (2 * a0) : alpha / a0;
  const b1 = kind === 'highpass' ? -(1 + cos) / a0 : 0;
  const b2 = kind === 'highpass' ? b0 : -b0;
  const result = new Float64Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    result[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return result;
}
function pitchLayer(samples, semitones) {
  // Two crossfaded moving delay heads avoid changing speech timing.
  const ratio = 2 ** (semitones / 12), window = Math.round(fs * 0.065);
  const result = new Float64Array(samples.length);
  for (let i = 0; i < result.length; i++) {
    const phase1 = (i * (1 - ratio) / window) % 1, phase2 = (phase1 + 0.5) % 1;
    const weight1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase1), weight2 = 1 - weight1;
    result[i] = weight1 * interpolate(samples, i - phase1 * window) + weight2 * interpolate(samples, i - phase2 * window);
  }
  return result;
}
function peak(samples) { let p = 0; for (const x of samples) p = Math.max(p, Math.abs(x)); return p; }
function rms(samples) { let sum = 0; for (const x of samples) sum += x * x; return Math.sqrt(sum / samples.length); }
function matchLevel(samples, reference) {
  const gain = Math.min(64, rms(reference) / Math.max(0.00001, rms(samples)));
  return Float64Array.from(samples, x => x * gain);
}

const lower = pitchLayer(dry, -4.2);
const sub = filter(pitchLayer(dry, -7), 175, 0.7);
const body = filter(dry, 230, 0.65);
const consonants = filter(dry, 2300, 0.7, 'highpass');
const metal = Float64Array.from(dry, (x, i) => {
  const t = i / fs;
  return x * (0.7 * Math.sin(2 * Math.PI * 55 * t) + 0.3 * Math.sin(2 * Math.PI * 82.4 * t));
});

// A speech-envelope filter-bank vocoder adds a synthesized metal voice layer.
const carrier = new Float64Array(dry.length);
let phase = 0, noise = 1701;
for (let i = 0; i < carrier.length; i++) {
  const t = i / fs, f0 = 78 + 2.5 * Math.sin(2 * Math.PI * 0.33 * t);
  phase = (phase + f0 / fs) % 1;
  noise = (Math.imul(noise, 1664525) + 1013904223) | 0;
  carrier[i] = 0.58 * (2 * phase - 1) + 0.22 * Math.sin(2 * Math.PI * phase) + 0.04 * noise / 2147483648;
}
const vocoder = new Float64Array(dry.length);
for (let band = 0; band < 22; band++) {
  const frequency = 100 * (6500 / 100) ** (band / 21);
  const mod = filter(dry, frequency, 4.4), synth = filter(carrier, frequency, 4.4);
  const attack = Math.exp(-1 / (fs * 0.0025)), release = Math.exp(-1 / (fs * 0.019));
  let envelope = 0;
  for (let i = 0; i < vocoder.length; i++) {
    const value = Math.abs(mod[i]), smoothing = value > envelope ? attack : release;
    envelope = envelope * smoothing + value * (1 - smoothing);
    vocoder[i] += synth[i] * envelope;
  }
}
const vocoderMatched = matchLevel(vocoder, dry);
const variants = [
  { file: 'mecha-commander.wav', label: '机甲指挥官：低沉金属叠声', mix: { dry: 0.58, lower: 0.32, sub: 0.15, body: 0.25, metal: 0.38, vocoder: 0.22, consonants: 0.13 }, comb: 0.19 },
  { file: 'heavy-robot.wav', label: '重装机器人：更强电子机械感', mix: { dry: 0.32, lower: 0.24, sub: 0.13, body: 0.13, metal: 0.57, vocoder: 0.54, consonants: 0.16 }, comb: 0.25 },
];
const layers = { dry, lower, sub, body, metal, vocoder: vocoderMatched, consonants };
function encode(samples) {
  const result = Buffer.alloc(44 + samples.length * 2);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(fs, 24); result.writeUInt32LE(fs * 2, 28); result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34);
  result.write('data', 36); result.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) result.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return result;
}
await mkdir(output, { recursive: true });
const report = { at: new Date().toISOString(), source: input, sourceSha256: createHash('sha256').update(bytes).digest('hex'), cloudRequests: 0, additionalCredits: 0, sampleRate: fs, baselinePitchSemitones: 12 * Math.log2(slowRatio), layerRms: Object.fromEntries(Object.entries(layers).map(([name, samples]) => [name, Number(rms(samples).toFixed(5))])), variants: [] };
for (const variant of variants) {
  const combined = new Float64Array(dry.length);
  for (const [name, gain] of Object.entries(variant.mix)) {
    for (let i = 0; i < combined.length; i++) combined[i] += layers[name][i] * gain;
  }
  const result = new Float64Array(combined.length);
  const delay1 = Math.round(fs * 0.0053), delay2 = Math.round(fs * 0.0117), delay3 = Math.round(fs * 0.0211);
  for (let i = 0; i < result.length; i++) {
    const resonance = combined[i] + variant.comb * (combined[i - delay1] ?? 0) - 0.12 * (combined[i - delay2] ?? 0) + 0.08 * (combined[i - delay3] ?? 0);
    const fade = Math.min(1, i / (fs * 0.015), (result.length - 1 - i) / (fs * 0.02));
    result[i] = Math.tanh(resonance * 1.7) * fade;
  }
  const gain = 0.90 / peak(result);
  for (let i = 0; i < result.length; i++) result[i] *= gain;
  assert.ok(result.every(Number.isFinite));
  assert.ok(rms(result) > 0.03 && rms(result) < 0.4);
  const path = resolve(output, variant.file);
  const encoded = encode(result);
  await writeFile(path, encoded);
  report.variants.push({ ...variant, path, durationSeconds: Number((result.length / fs).toFixed(2)), bytes: encoded.length, peak: Number(peak(result).toFixed(4)), rms: Number(rms(result).toFixed(4)) });
}
assert.equal(createHash('sha256').update(await readFile(input)).digest('hex'), report.sourceSha256, '原始音频被改动。');
await writeFile(resolve(output, 'processing.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
