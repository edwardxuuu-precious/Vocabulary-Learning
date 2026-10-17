import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const phase = process.argv[2]; if (!['before', 'after'].includes(phase)) throw Error('使用 before 或 after');
const db = new DatabaseSync(path.resolve('data/playroom.sqlite'), { readOnly: true });
try {
  const data = JSON.parse((db.prepare('SELECT body FROM documents WHERE id=1').get() as { body: string }).body);
  if (data.jobs.some((job: any) => ['queued', 'running'].includes(job.status)) || data.assessments?.some((session: any) => ['queued', 'transcribing', 'grading'].includes(session.job?.status))) throw Error('仍有后台任务，不更新服务');
  const hashes = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, createHash('sha256').update(JSON.stringify(value)).digest('hex')]));
  writeFileSync(`artifacts/challenge-rollout-${phase}.json`, JSON.stringify(hashes, null, 2));
  if (phase === 'after') { const before = JSON.parse(readFileSync('artifacts/challenge-rollout-before.json', 'utf8')); const changed = Object.keys({ ...before, ...hashes }).filter(key => before[key] !== hashes[key]); console.log(JSON.stringify({ fields: Object.keys(hashes).length, changed })); if (changed.length) process.exitCode = 1; }
  else console.log(JSON.stringify({ fields: Object.keys(hashes).length, words: data.words.length, attempts: data.attempts.length, assessments: data.assessments?.length ?? 0, charges: data.charges.length }));
} finally { db.close(); }
