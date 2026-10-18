import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

// Check current documentation only; task evidence deliberately keeps historical paths.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strategyFile = join(root, 'docs', 'LEARNING_STRATEGY.html');
const htmlAnchors = new Map<string, Set<string>>();
function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'Current documentation must not contain links.');
    const file = join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith('.md') ? [file] : [];
  });
}
function resolveLink(document: string, target: string): { file: string; fragment: string } {
  const [pathname, fragment = ''] = target.split('#', 2);
  const path = decodeURIComponent(pathname.split('?')[0]);
  return {
    file: !path ? document : path.startsWith('/assets/') ? join(root, 'public', path) : resolve(dirname(document), path),
    fragment: decodeURIComponent(fragment),
  };
}
function linkError(document: string, target: string): string | undefined {
  const { file, fragment } = resolveLink(document, target);
  if (!existsSync(file)) return `${relative(root, document)}: missing ${target}`;
  if (fragment && htmlAnchors.has(file) && !htmlAnchors.get(file)!.has(fragment)) return `${relative(root, document)}: missing anchor ${target}`;
}

if (existsSync(strategyFile)) {
  const html = readFileSync(strategyFile, 'utf8');
  const dataBlock = html.match(/<script\s+id="strategy-data"\s+type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(dataBlock, 'Strategy must include its self-contained task definitions.');
  interface Task { id: string; phase: number; priority: string; deps: string[]; deliver: string[]; accept: string[]; files: string[]; refs: string[]; title: string; owner: string; risk: string }
  const data = JSON.parse(dataBlock[1]) as { branches: { id: string }[]; tasks: Task[]; criticalPath: string[] };
  assert.ok(Array.isArray(data.branches) && data.branches.length && Array.isArray(data.tasks) && data.tasks.length);
  const branches = new Set(data.branches.map(branch => branch.id));
  const tasks = new Map(data.tasks.map(task => [task.id, task]));
  assert.equal(branches.size, data.branches.length, 'Duplicate strategy branch.');
  assert.equal(tasks.size, data.tasks.length, 'Duplicate strategy task.');
  const staticHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const staticIds = [...staticHtml.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(new Set(staticIds).size, staticIds.length, 'Duplicate HTML id.');
  const anchors = new Set([...staticIds, ...data.tasks.map(task => 'task-' + task.id)]);
  htmlAnchors.set(strategyFile, anchors);
  for (const task of data.tasks) {
    assert.match(task.id, /^[A-Z]\d+$/);
    assert.ok(branches.has(task.id[0]), `Unknown branch for ${task.id}`);
    assert.ok(Number.isInteger(task.phase) && task.phase >= 0 && task.phase <= 3, `Invalid phase for ${task.id}`);
    assert.match(task.priority, /^P[0-2]$/);
    assert.ok(task.title && task.owner && task.risk, `Missing task details for ${task.id}`);
    for (const field of ['deliver', 'accept', 'files'] as const) assert.ok(Array.isArray(task[field]) && task[field].length && task[field].every(item => typeof item === 'string' && item.trim()), `Missing ${field} for ${task.id}`);
    assert.ok(Array.isArray(task.deps) && new Set(task.deps).size === task.deps.length);
    for (const dependency of task.deps) assert.ok(tasks.has(dependency) && tasks.get(dependency)!.phase <= task.phase, `Invalid dependency ${task.id} -> ${dependency}`);
    for (const ref of task.refs) assert.ok(anchors.has('ref-' + ref), `Missing reference ${ref}`);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string): void {
    assert.ok(!visiting.has(id), `Strategy dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasks.get(id)!.deps) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of tasks.keys()) visit(id);
  assert.ok(Array.isArray(data.criticalPath) && data.criticalPath.length);
  data.criticalPath.forEach((id, index) => assert.ok(tasks.has(id) && (!index || tasks.get(id)!.deps.includes(data.criticalPath[index - 1])), `Invalid critical-path step ${id}`));
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.ok(!/\bsrc\s*=/i.test(match[1]), 'Strategy must not load scripts.');
    if (!/type=["']application\/json["']/i.test(match[1])) new Script(match[2], { filename: strategyFile });
  }
  assert.ok(!/<(?:iframe|img|audio|video|source|object|embed|link)\b[^>]*\b(?:src|href|data|poster)\s*=/i.test(staticHtml), 'Strategy must remain self-contained.');
  assert.ok(!/@import|url\(\s*["']?(?:https?:|\/\/)/i.test(html), 'Strategy must not load external styles.');
  let links = 0;
  for (const match of staticHtml.matchAll(/\bhref=["']([^"']+)["']/g)) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(match[1])) continue;
    assert.equal(linkError(strategyFile, match[1]), undefined); links++;
  }
  const tree = readFileSync(join(root, 'docs', 'TASK_TREE.md'), 'utf8');
  const indexed = [...tree.matchAll(/^\|\s*\[([A-Z]\d+)\]\(LEARNING_STRATEGY\.html#task-\1\)/gm)].map(match => match[1]);
  assert.equal(indexed.length, new Set(indexed).size, 'Duplicate task-tree row.');
  assert.deepEqual(new Set(indexed), new Set(tasks.keys()), 'Task tree must index every strategy task.');
  console.log(`Learning strategy verified: ${branches.size} branches; ${tasks.size} tasks; acyclic dependencies; ${links} local HTML links.`);
}

const documents = [join(root, 'README.md'), join(root, 'AGENTS.md'), ...markdownFiles(join(root, 'docs')), ...markdownFiles(join(root, 'scripts', 'desktop'))];
const errors: string[] = [];
let checked = 0;
for (const document of documents) {
  const content = readFileSync(document, 'utf8').replace(/^\x60\x60\x60[^\n]*\n[\s\S]*?^\x60\x60\x60\s*$/gm, '');
  for (const match of content.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*["'])?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
    checked++;
    const error = linkError(document, target);
    if (error) errors.push(error);
  }
}
assert.equal(errors.length, 0, errors.join('\n'));
console.log(`Current documentation verified: ${documents.length} files; ${checked} local links.`);
