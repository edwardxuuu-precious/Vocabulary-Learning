import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAssessmentStt } from '../server/integrations/assessment-stt.ts';
import { createAssessmentGrader } from '../server/integrations/assessment-grader.ts';
import { IntegrationError } from '../server/integrations/errors.ts';
// Explicit smoke test with the offline adult synthetic "apple" take, never a child's recording.
const directory = path.resolve(process.argv[2] ?? '');
if (!directory.startsWith(path.resolve('artifacts') + path.sep) || !path.basename(directory).startsWith('challenge-qa-')) throw Error('只接受本项目隔离挑战验收目录。');
process.loadEnvFile('.env');
const result: Record<string, unknown> = { synthetic: true, formalChildWrites: 0, at: new Date().toISOString() };
const audio = await readFile(path.join(directory, 'data/speech/qa/answer.wav'));
let pcm: Buffer | undefined;
for (let offset = 12; offset + 8 < audio.length;) { const size = audio.readUInt32LE(offset + 4); if (audio.toString('ascii', offset, offset + 4) === 'data') { pcm = audio.subarray(offset + 8, offset + 8 + size); break; } offset += 8 + size + size % 2; }
if (!pcm) throw Error('合成录音无效');
const wav = Buffer.alloc(44 + pcm.length); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
let transcript = 'apple';
try {
  transcript = await createAssessmentStt()({ audio: wav, language: 'en', seconds: pcm.length / 32000, signal: AbortSignal.timeout(50000), beforeRequest: estimate => { result.sttBudgetEstimateCny = estimate; } });
  result.stt = { status: 'verified', recognizedTarget: transcript.toLowerCase().includes('apple') };
} catch (error) { result.stt = { status: 'pending', message: error instanceof IntegrationError ? error.message : '未完成真实转写' }; }
try {
  const grade = createAssessmentGrader({ dataDir: path.join(directory, 'cloud-smoke') });
  const suggestions = await grade([{ id: 'synthetic:read', dimension: 'read', term: 'apple', meaning: '苹果', transcript }], AbortSignal.timeout(60000));
  result.codex = { status: 'verified', items: suggestions.length, verdict: suggestions[0].verdict, reason: suggestions[0].reason };
} catch (error) { result.codex = { status: 'pending', message: error instanceof IntegrationError ? error.message : '未完成真实初判' }; }
await writeFile(path.join(directory, 'cloud-smoke.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
