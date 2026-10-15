import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const jobs = [
  spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: root, stdio: 'inherit', windowsHide: true }),
  spawn(node, ['node_modules/vite/bin/vite.js'], { cwd: root, stdio: 'inherit', windowsHide: true })
];
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  for (const job of jobs) job.kill();
  setTimeout(() => process.exit(code), 200);
}
for (const job of jobs) {
  job.on('error', error => { console.error(error.message); stop(1); });
  job.on('exit', code => { if (!ending) stop(code || 0); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
