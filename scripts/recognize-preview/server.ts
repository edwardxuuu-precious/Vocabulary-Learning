import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from '../../server/store';
import { visualTheme } from '../../shared/visual-theme';
import type { Word } from '../../shared/contracts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const sourceArg = args.find(arg => arg.startsWith('--source='))?.slice(9);
const targetTerm = args.find(arg => arg.startsWith('--word='))?.slice(7);
const port = Number(args.find(arg => arg.startsWith('--port='))?.slice(7) ?? '8836');
assert.ok(sourceArg && isAbsolute(sourceArg) && targetTerm, '需要显式指定 --source=原data绝对路径 与 --word=原词。');
assert.ok(args.every(arg => /^--(?:source|word|port)=/.test(arg)) && Number.isInteger(port) && port >= 1024 && port <= 65535);
const source = realpathSync(sourceArg), dist = join(root, 'artifacts/recognize-picture-preview/dist');
assert.ok(existsSync(join(dist, 'index.html')), '请先构建独立预览。');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function readSource() {
  const db = new DatabaseSync(join(source, 'playroom.sqlite'), { readOnly: true });
  try { return (db.prepare('SELECT body FROM documents WHERE id=1').get() as { body: string }).body; } finally { db.close(); }
}
const baseline = readSource(), snapshot = JSON.parse(baseline) as ReturnType<Store['read']>;
const usable = (word: Word) => word.assetStatus === 'approved' && !word.deletedAt && snapshot.packs.some(pack => pack.id === word.packId && pack.enabled && !pack.isSample && !pack.deletedAt);
const target = snapshot.words.find(word => word.term === targetTerm && usable(word));
assert.ok(target, '目标词必须来自已交付词书，并保留已批准原图。');
const session = [...snapshot.sessions].reverse().find(row => row.wordIds.includes(target.id));
assert.ok(session, '目标词须有既有学习范围，不拿其他词书凑选项。');
const candidates = session.wordIds.map(id => snapshot.words.find(word => word.id === id)).filter((word): word is Word => !!word && usable(word) && word.id !== target.id && word.imageUrl !== target.imageUrl);
const selected = [candidates[0], target, candidates.find(word => word.imageUrl !== candidates[0]?.imageUrl)].filter((word): word is Word => !!word);
assert.equal(selected.length, 3, '该学习范围没有三张不同的批准原词图。');

const files = new Map<string, { path: string; hash: string }>();
function include(url: string, base: string, prefix: string) {
  assert.ok(url.startsWith(prefix));
  const path = realpathSync(resolve(base, decodeURIComponent(url.slice(prefix.length))));
  assert.ok(path.startsWith(realpathSync(base) + sep) && ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(extname(path).toLowerCase()));
  files.set(url, { path, hash: hash(readFileSync(path)) });
}
for (const word of selected) include(word.imageUrl, word.imageUrl.startsWith('/media/') ? source : join(root, 'public'), word.imageUrl.startsWith('/media/') ? '/media/' : '/');
for (const url of [visualTheme.characters.optimus.image, visualTheme.brandIcon]) include(url, join(root, 'public'), '/');
const content = { isolated: true, targetId: target.id, words: selected.map(word => ({ id: word.id, term: word.term, meaning: word.meaning, imageUrl: word.imageUrl, learningVersion: word.learningVersion ?? 1 })) };
let requests = 0, rejectedWrites = 0;
const audit = () => ({ isolated: true, readOnlySource: true, sourceUnchanged: hash(readSource()) === hash(baseline), originalImagesUnchanged: [...files.values()].every(file => hash(readFileSync(file.path)) === file.hash), imageCount: selected.length, requests, rejectedWrites, cloudRequests: 0, origin: `http://127.0.0.1:${port}` });
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  requests++;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
  if (!['GET', 'HEAD'].includes(req.method ?? '')) { rejectedWrites++; res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('只读界面预览'); return; }
  const route = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname;
  if (route === '/__preview/content' || route === '/__preview/audit') { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(route.endsWith('audit') ? audit() : content)); return; }
  const approved = files.get(route);
  const local = route === '/' || route === '/index.html' ? join(dist, 'index.html') : resolve(dist, '.' + decodeURIComponent(route));
  if (approved || local.startsWith(dist + sep) && existsSync(local) && ['.html', '.js', '.css'].includes(extname(local))) {
    const path = approved?.path ?? local;
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : readFileSync(path)); return;
  }
  res.writeHead(404); res.end('未找到预览资源');
});
await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
const evidence = join(root, 'artifacts/recognize-picture-preview'); mkdirSync(evidence, { recursive: true });
writeFileSync(join(evidence, 'source-audit.json'), JSON.stringify(audit(), null, 2));
console.log(JSON.stringify(audit()));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { writeFileSync(join(evidence, 'source-audit.json'), JSON.stringify(audit(), null, 2)); server.close(() => process.exit(0)); });
