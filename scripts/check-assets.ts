import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualTheme } from '../shared/visual-theme.ts';
import { learningBackgrounds } from '../shared/learning-backgrounds.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const inventoryFile = join(root, 'docs', 'ASSETS.json');
async function files(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Static assets must not be links.');
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}
const assets = await Promise.all((await files(publicDir)).map(async path => {
  const bytes = await readFile(path);
  return { path: relative(root, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
const inventory = { formatVersion: 1, themeId: visualTheme.id, assets };
function themeUrls(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith('/assets/') ? [value] : [];
  if (value && typeof value === 'object') return Object.values(value).flatMap(themeUrls);
  return [];
}
for (const url of themeUrls([visualTheme, learningBackgrounds])) assert.ok(assets.some(asset => asset.path === 'public' + url), `Missing theme asset: ${url}`);
if (process.argv.includes('--write')) await writeFile(inventoryFile, JSON.stringify(inventory, null, 2) + '\n', 'utf8');
else assert.deepEqual(JSON.parse(await readFile(inventoryFile, 'utf8')), inventory, 'Assets changed: review the files, then run npm run assets:update.');
console.log(`Static assets verified: ${assets.length}; theme: ${visualTheme.id}`);
