import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const treeFile = join(root, 'docs/TASK_TREE.md');
const workflowFile = join(root, 'docs/PROJECT_WORKFLOW.md');
const recordsFile = join(root, 'docs/BUSINESS_RECORDS.md');
const acceptanceFile = join(root, 'docs/ACCEPTANCE.md');
const outputFile = join(root, 'docs/PROJECT_DASHBOARD.html');
const templateFile = join(root, 'scripts/project-dashboard.template.html');
const fields = {
  '阶段': 'phase', '优先级': 'priority', '状态': 'status', '交付层级': 'level',
  '业务关联': 'goals', '目的与原因': 'purpose', '决策': 'decision', '取舍': 'tradeoff',
  '未来尝试': 'future', '产出': 'output', '收敛条件': 'close', '评估': 'evaluation',
  '预期场景': 'scenario', '依赖': 'deps', '并行与负责': 'parallel',
  '循环与反馈': 'loop', '当前证据': 'evidence',
};
const normal = text => text.replace(/\r\n/g, '\n').trimEnd() + '\n';
const digest = text => createHash('sha256').update(text).digest('hex');

function section(source, title) {
  const start = source.indexOf(`## ${title}\n`);
  assert.ok(start >= 0, `Missing section: ${title}`);
  const rest = source.slice(start + title.length + 4);
  const end = rest.indexOf('\n## ');
  return end < 0 ? rest : rest.slice(0, end);
}
function table(source, title) {
  const lines = section(source, title).split('\n').filter(line => line.startsWith('|'));
  const cells = line => line.split('|').slice(1, -1).map(cell => cell.trim());
  const header = cells(lines[0] ?? '');
  assert.ok(header.length, `Missing table: ${title}`);
  return lines.slice(2).map(line => {
    const values = cells(line);
    assert.equal(values.length, header.length, `Table shape: ${title}`);
    return Object.fromEntries(header.map((name, i) => [name, values[i]]));
  });
}
function sourceMetadata(text, name) {
  return { file: name, sha256: digest(text), classification: 'project-document', scope: 'project planning, not private child data' };
}
export function reviewedPlan() {
  const source = normal(readFileSync(treeFile, 'utf8'));
  const workflow = normal(readFileSync(workflowFile, 'utf8'));
  const records = normal(readFileSync(recordsFile, 'utf8'));
  const acceptance = normal(readFileSync(acceptanceFile, 'utf8'));
  const meta = label => {
    const match = source.match(new RegExp(`^- ${label}：(.+)$`, 'm'));
    assert.ok(match, `Missing metadata: ${label}`);
    return match[1];
  };
  const branches = [...source.matchAll(/^## ([A-Z]) · (.+)$/gm)].map(match => ({ id: match[1], title: match[2] }));
  const tasks = source.split(/(?=^### [A-Z]\d{2} · )/m).slice(1).map(block => {
    const content = block.split('\n## ')[0];
    const heading = content.match(/^### ([A-Z]\d{2}) · (.+)$/m);
    assert.ok(heading, 'Malformed task heading');
    const task = { id: heading[1], title: heading[2], branch: heading[1][0] };
    const entries = [...content.matchAll(/^- ([^：\n]+)：(.+)$/gm)];
    assert.equal(entries.length, Object.keys(fields).length, `${task.id}: unexpected/missing task fields`);
    for (const [label, key] of Object.entries(fields)) {
      const matches = entries.filter(entry => entry[1] === label);
      assert.equal(matches.length, 1, `${task.id}: missing/duplicate ${label}`);
      task[key] = key === 'deps' ? (matches[0][2] === '无' ? [] : matches[0][2].split(',')) : matches[0][2];
    }
    return task;
  });
  const gates = table(source, '阶段门');
  const phaseIds = new Set(gates.map(row => row.ID));
  const branchIds = new Set(branches.map(row => row.id));
  const byId = new Map(tasks.map(task => [task.id, task]));
  assert.equal(byId.size, tasks.length, 'Duplicate task ID');
  assert.equal(branchIds.size, branches.length, 'Duplicate branch ID');
  const declaredCount = source.match(/叶子共(\d+)项/);
  assert.equal(tasks.length, Number(declaredCount?.[1]), 'Declared task count differs from actual leaf count');
  for (const task of tasks) {
    assert.ok(branchIds.has(task.branch), `Unknown branch: ${task.id}`);
    assert.ok(phaseIds.has(task.phase), `Unknown phase: ${task.id}`);
    assert.match(task.priority, /^P[0-2]$/);
    assert.ok(['已收敛', '部分实现', '待执行', '待确认'].includes(task.status), `Unknown status: ${task.id}`);
    assert.ok(['工程已验证', '已集成', '已实现', '方案', '规划'].includes(task.level), `Unknown delivery: ${task.id}`);
    assert.equal(task.deps.length, new Set(task.deps).size, `Duplicate dependency: ${task.id}`);
    for (const dep of task.deps) {
      assert.ok(byId.has(dep), `Unknown dependency ${task.id} -> ${dep}`);
      assert.ok(byId.get(dep).phase <= task.phase, `Backward phase dependency ${task.id} -> ${dep}`);
      if (task.status === '已收敛') assert.equal(byId.get(dep).status, '已收敛', `Closed task has unresolved prerequisite: ${task.id}`);
    }
  }
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    assert.ok(!visiting.has(id), `Dependency cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    byId.get(id).deps.forEach(visit);
    visiting.delete(id); visited.add(id);
  };
  tasks.forEach(task => visit(task.id));
  const preparations=table(source,'本轮工程准备检查点').map(row=>({id:row.ID,tasks:row['关联任务'].split(','),title:row['工程产出'],deps:row['工程前置']==='无'?[]:row['工程前置'].split(','),status:row['状态'],close:row['收敛条件']}));
  const prepById=new Map(preparations.map(item=>[item.id,item]));
  assert.equal(prepById.size,preparations.length,'Duplicate engineering checkpoint');
  for(const item of preparations){
    assert.match(item.id,/^EP\d{2}$/);assert.ok(['已收敛','部分实现','待执行'].includes(item.status));
    item.tasks.forEach(id=>assert.ok(byId.has(id),`Unknown linked task: ${item.id}/${id}`));
    for(const id of item.deps){const prior=prepById.get(id)??byId.get(id);assert.ok(prior,`Unknown checkpoint dependency: ${id}`);if(item.status==='已收敛')assert.equal(prior.status,'已收敛',`Closed checkpoint has unresolved dependency: ${item.id}/${id}`);}
  }
  const prepVisited=new Set(),prepVisiting=new Set();
  const visitPrep=id=>{if(!prepById.has(id)||prepVisited.has(id))return;assert.ok(!prepVisiting.has(id),'Engineering checkpoint dependency cycle');prepVisiting.add(id);prepById.get(id).deps.forEach(visitPrep);prepVisiting.delete(id);prepVisited.add(id);};
  preparations.forEach(item=>visitPrep(item.id));
  const trialGates=table(source,'儿童验证依赖');
  for(const task of tasks)task.trialDeps=[];
  for(const row of trialGates){const ids=row['关联任务'].split(','),deps=row['孩子验证前置'].split(',');
    deps.forEach(id=>assert.ok(byId.has(id),`Unknown trial prerequisite: ${id}`));
    ids.forEach(id=>{assert.ok(byId.has(id),`Unknown trial task: ${id}`);assert.equal(byId.get(id).trialDeps.length,0,`Duplicate trial gate: ${id}`);byId.get(id).trialDeps=deps;byId.get(id).trialBoundary=row['边界'];});
  }
  const legacy = [...source.matchAll(/^\| \[([A-Z]\d+)\]\(LEARNING_STRATEGY\.html#task-\1\) \| ([^|]+) \|$/gm)];
  const strategy = readFileSync(join(root, 'docs/LEARNING_STRATEGY.html'), 'utf8');
  const original = JSON.parse(strategy.match(/<script\s+id="strategy-data"\s+type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(new Set(legacy.map(row => row[1])), new Set(original.tasks.map(task => task.id)), 'Incomplete legacy mapping');
  legacy.forEach(row => row[2].trim().split(',').forEach(id => assert.ok(byId.has(id), `Invalid migration target: ${id}`)));
  const recordFields=['类型','版本','关联任务','业务影响','事实与来源','原解释与替代解释','实际尝试','决策与取舍','结果与限制','下次默认动作','再开条件','修订记录'];
  let refactor;
  if(source.includes('## 完整重构任务树\n')){
    const phases=table(source,'重构阶段');
    const items=table(source,'完整重构任务树').map(row=>({id:row.ID,phase:row['阶段'],category:row['类型'],priority:row['优先级'],status:row['状态'],level:row['交付层级'],deps:row['依赖']==='无'?[]:row['依赖'].split(','),output:row['产出'],acceptance:row['验收条件']}));
    const indexed=new Map(items.map(item=>[item.id,item]));
    assert.equal(indexed.size,items.length,'Duplicate refactor task');
    assert.equal(items.length,Number(meta('重构叶子')),'Refactor task count differs from declaration');
    for(const item of items){
      assert.match(item.id,/^RF\d{2}$/);
      assert.ok(phases.some(phase=>phase.ID===item.phase),'Unknown refactor phase');
      assert.ok(['工程','真人'].includes(item.category),'Unknown refactor category');
      assert.ok(['待执行','进行中','已完成','待真人验证'].includes(item.status),'Unknown refactor status');
      assert.ok(['规划','方案','已实现','已集成','工程已验证','真人已验证'].includes(item.level),'Unknown refactor delivery');
      assert.match(item.priority,/^P[0-2]$/);
      assert.ok(item.output&&item.acceptance,'Missing refactor deliverable or acceptance');
      for(const dep of item.deps){assert.ok(indexed.has(dep),`Unknown refactor prerequisite ${item.id}/${dep}`);assert.ok(indexed.get(dep).phase<=item.phase,'Backward refactor phase dependency');if(item.status==='已完成')assert.equal(indexed.get(dep).status,'已完成','Closed refactor task has open prerequisite');}
    }
    const active=new Set(),done=new Set();const walk=id=>{assert.ok(!active.has(id),'Refactor dependency cycle');if(done.has(id))return;active.add(id);indexed.get(id).deps.forEach(walk);active.delete(id);done.add(id);};items.forEach(item=>walk(item.id));
    refactor={version:meta('重构规划版本'),approval:meta('重构审批'),tasks:items,phases,scope:'独立统计工程与真人任务，不与business-v1.2分母相加；完成数不代表学习效果。'};
  }
  const cards=[...records.matchAll(/^## ([DEH]\d{2}) · (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map(match=>{
    const entries=[...match[3].matchAll(/^- ([^：\n]+)：(.+)$/gm)];
    assert.equal(entries.length,recordFields.length,`Record ${match[1]}: unexpected/missing fields`);
    const card={id:match[1],title:match[2]};
    for(const field of recordFields){const values=entries.filter(entry=>entry[1]===field);assert.equal(values.length,1,`Record ${match[1]}: ${field}`);card[field]=values[0][2];}
    assert.ok(['决策','成功经验','失败经验','假设'].includes(card['类型']),'Unknown business record type');
    assert.match(card['版本'],/^[1-9]\d*$/);
    card['关联任务'].split(',').forEach(id=>assert.ok(byId.has(id)||refactor?.tasks.some(task=>task.id===id),`Record ${card.id}: invalid task ${id}`));
    return card;
  });
  assert.ok(cards.length,'No business records');
  assert.equal(new Set(cards.map(card=>card.id)).size,cards.length,'Duplicate business record ID');
  const sources = [sourceMetadata(source, 'docs/TASK_TREE.md'), sourceMetadata(workflow, 'docs/PROJECT_WORKFLOW.md'),sourceMetadata(records,'docs/BUSINESS_RECORDS.md'),sourceMetadata(acceptance,'docs/ACCEPTANCE.md'),sourceMetadata(normal(readFileSync(join(root,'docs/ENTRY_RULES.md'),'utf8')),'docs/ENTRY_RULES.md'),sourceMetadata(normal(readFileSync(join(root,'docs/ENTRY_PROTOTYPE.html'),'utf8')),'docs/ENTRY_PROTOTYPE.html')];
  if(refactor)sources.push(sourceMetadata(normal(readFileSync(join(root,'docs/LEARNING_REFACTOR.md'),'utf8')),'docs/LEARNING_REFACTOR.md'));
  return {
    version: meta('规划版本'), approval: meta('规划审批'), goal: meta('项目目标'), scopeChange: meta('本版范围变更'),
    buildStatus: 'complete', branches, tasks,preparations,trialGates,refactor,
    objectives: table(source, '业务目标'), metrics: table(source, '业务指标'), gates,
    workflowMarkdown: workflow,
    recordsMarkdown: records, businessRecords:cards,
    verification:table(acceptance,'工程与交付'),
    legacyMapping: legacy.map(row => ({ original: row[1], tasks: row[2].trim().split(',') })),
    provenance: { sources, metricScope: 'Leaf task counts describe this planning version, not learning outcomes or labor.', methods: [
      'Read the canonical Markdown task fields and workflow without reading private data.',
      'Count each leaf ID once. Closed rate = closed leaves / all version leaves; never sum branch and phase counts.',
      'UI filters and JSON export use the same selected leaf array. Top cards separately identify business leaves, engineering preparation and child validation; filtering does not change those scopes.',
      'Unknown business measurements remain textual missing states; no fictional observations or denominators are supplied.',
      'Engineering checkpoints are a bounded preparation subset, excluded from the business leaf count. Child validation counts A03, A04 and V01-V04 separately.',
    ] },
  };
}

export function renderDashboard() {
  const plan = reviewedPlan();
  const template = normal(readFileSync(templateFile, 'utf8'));
  assert.equal(template.split('__PROJECT_PLAN__').length, 2, 'Template must contain one data placeholder');
  const html = template.replace('__PROJECT_PLAN__', () => JSON.stringify(plan).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.ok(!/\bsrc\s*=/i.test(match[1]), 'Dashboard must not load external scripts');
    if (!/application\/json/.test(match[1])) new Script(match[2], { filename: 'PROJECT_DASHBOARD.html' });
  }
  return { html, plan };
}

const { html, plan } = renderDashboard();
const closed = plan.tasks.filter(task => task.status === '已收敛').length;
if (process.argv.includes('--check')) {
  assert.ok(existsSync(outputFile), 'Missing dashboard. Run npm run dashboard:build');
  assert.equal(normal(readFileSync(outputFile, 'utf8')), html, 'Dashboard is out of date. Run npm run dashboard:build');
  console.log(`Project dashboard verified: ${plan.tasks.length} leaves; ${plan.branches.length} branches; ${closed} closed; 33 original tasks mapped; DAG and source hashes checked.`);
} else if (process.argv.includes('--serve')) {
  const portArg = process.argv.find(arg => arg.startsWith('--port='));
  const port = portArg ? Number(portArg.slice(7)) : 8790;
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid dashboard port');
  const server = createServer((req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type + (type.startsWith('text/')?'; charset=utf-8':''), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'" });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(req.method ?? '')) return send(405, 'text/plain', 'Read-only dashboard');
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    try {
      if (path === '/' || path === '/PROJECT_DASHBOARD.html') return send(200, 'text/html', renderDashboard().html);
      if (path === '/favicon.ico') return send(204, 'text/plain', '');
      if(path.startsWith('/assets/')){
        const manifest=JSON.parse(readFileSync(join(root,'docs/ASSETS.json'),'utf8'));
        const asset=manifest.assets.find(asset=>'/'+asset.path.replace(/^public\//,'')===path);
        if(asset)return send(200,path.endsWith('.svg')?'image/svg+xml':'image/png',readFileSync(join(root,asset.path)));
        return send(404,'text/plain','Not an approved static asset');
      }
      if (path === '/README.md') return send(200, 'text/plain', readFileSync(join(root, 'README.md'), 'utf8'));
      if (/^\/[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:md|html)$/.test(path)) {
        const file = join(root, 'docs', path.slice(1));
        if (existsSync(file)) return send(200, path.endsWith('.html') ? 'text/html' : 'text/plain', readFileSync(file, 'utf8'));
      }
      send(404, 'text/plain', 'Not found');
    } catch (error) { send(500, 'text/plain', 'Source validation failed: ' + error.message); }
  });
  server.on('error', error => { console.error(`Dashboard could not start: ${error.message}. Leave other services running; select an unused port.`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Project dashboard: http://127.0.0.1:${port}/PROJECT_DASHBOARD.html (read-only; source refreshed on each request)`));
} else {
  writeFileSync(outputFile, html, 'utf8');
  console.log(`Generated docs/PROJECT_DASHBOARD.html: ${plan.tasks.length} leaves; ${closed} closed; ${Math.round(closed / plan.tasks.length * 1000) / 10}%.`);
}
