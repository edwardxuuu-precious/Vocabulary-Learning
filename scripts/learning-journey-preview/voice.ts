import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import type { Word } from '../../shared/contracts.ts';
import { sentenceLesson } from '../../shared/sentence-study.ts';

export function trialEnglishTexts(words: Pick<Word, 'term' | 'meaning'>[]) {
  return [...new Set([...words.map(word => word.term), ...words.flatMap(word => sentenceLesson(word)?.full ?? [])])];
}

interface VoiceManifest {
  version: 1;
  variant: string;
  voice: string;
  speed: number;
  clips: { text: string; file: string; sha256: string }[];
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Only install complete, exact-scope audio under the test instance's private media root. */
export function installTrialVoice(directory: string, dataDir: string, texts: readonly string[]) {
  assert.ok(isAbsolute(directory));
  const source = realpathSync(directory);
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8')) as VoiceManifest;
  assert.ok(manifest.version === 1 && /^[a-z0-9-]{1,60}$/.test(manifest.variant) &&
    /^[A-Za-z0-9 .-]{1,45}$/.test(manifest.voice) && Number.isFinite(manifest.speed) && manifest.speed >= 0.55 && manifest.speed <= 1 &&
    Array.isArray(manifest.clips) && manifest.clips.length === texts.length && texts.length > 0 && texts.length <= 80);
  const expected = new Set(texts);
  const ready = manifest.clips.map(clip => {
    assert.ok(expected.delete(clip.text) && clip.file === sha(Buffer.from(clip.text)).slice(0, 20) + '.mp3' && /^[a-f0-9]{64}$/.test(clip.sha256));
    const original = realpathSync(join(source, clip.file));
    assert.ok(original.startsWith(source + sep));
    const bytes = readFileSync(original);
    assert.ok(bytes.length > 1024 && bytes.length < 2_000_000 && sha(bytes) === clip.sha256);
    assert.ok(bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    return { clip, bytes };
  });
  assert.equal(expected.size, 0);
  const dataRoot = realpathSync(dataDir);
  let destination = dataRoot;
  for (const part of ['speech', 'trial-english', manifest.variant]) {
    destination = join(destination, part);
    if (!existsSync(destination)) mkdirSync(destination);
    assert.equal(realpathSync(destination), destination, '试用音频目录不能是链接。');
  }
  const byText = new Map<string, string>();
  for (const { clip, bytes } of ready) {
    const path = join(destination, clip.file);
    if (existsSync(path)) {
      assert.equal(realpathSync(path), path);
      assert.equal(sha(readFileSync(path)), clip.sha256, '同版本试用发音已有不同内容。');
    } else writeFileSync(path, bytes, { flag: 'wx' });
    byText.set(clip.text, path);
  }
  return { byText, voice: manifest.voice, speed: manifest.speed, variant: manifest.variant, clips: byText.size };
}
