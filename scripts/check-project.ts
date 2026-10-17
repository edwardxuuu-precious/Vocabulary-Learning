import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Check only current documentation; task evidence deliberately keeps historical paths.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'Current documentation must not contain links.');
    const file = join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith('.md') ? [file] : [];
  });
}
const documents = [join(root, 'README.md'), join(root, 'AGENTS.md'), ...markdownFiles(join(root, 'docs')), ...markdownFiles(join(root, 'scripts', 'desktop'))];
const errors: string[] = [];
let checked = 0;
for (const document of documents) {
  const content = readFileSync(document, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of content.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*["'])?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
    const pathname = decodeURIComponent(target.split(/[?#]/)[0]);
    if (!pathname) continue;
    checked++;
    const file = pathname.startsWith('/assets/') ? join(root, 'public', pathname) : resolve(dirname(document), pathname);
    if (!existsSync(file)) errors.push(`${relative(root, document)}: missing ${target}`);
  }
}
assert.equal(errors.length, 0, errors.join('\n'));
console.log(`Current documentation verified: ${documents.length} files; ${checked} local links.`);
