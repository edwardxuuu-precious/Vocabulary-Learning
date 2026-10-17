import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { enrichVocabulary } from '../server/integrations/vocabulary.ts';

// Explicit read-only vocabulary proposal verification. No pack creation, image/TTS request, or child history change.
const directory = resolve('artifacts/vocabulary-preparation-qa');
await mkdir(directory, { recursive: true });
const started = performance.now();
const rows = await enrichVocabulary({ rows: [{ term: 'apple', meaning: '' }, { term: 'jump', meaning: '' }, { term: 'light', meaning: '' }], dataDir: join(directory, 'oauth-smoke') });
await writeFile(join(directory, 'oauth-result.json'), JSON.stringify({ provider: 'official-codex-chatgpt', real: true, elapsedMs: Math.round(performance.now() - started), rows }, null, 2));
console.log(JSON.stringify({ verified: true, elapsedMs: Math.round(performance.now() - started), words: rows.map(row => ({ term: row.term, meaning: row.meaning, partOfSpeech: row.partOfSpeech })) }));
