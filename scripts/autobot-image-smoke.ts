import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateIllustration, illustrationPrompt } from '../server/integrations/codex.ts';

// One explicit OAuth asset-only smoke. Does not create packs, approve images or touch child learning history.
const directory = resolve('artifacts/autobot-cover-qa');
const input = { jobId: 'autobot-' + randomUUID(), term: 'apple', meaning: '苹果', partOfSpeech: 'noun' as const, pictureHint: '一个很大的新鲜红苹果，大黄蜂作为小陪伴角色捧着它，苹果占据画面主要位置，不能用机器人替代水果，不出现文字。', interests: ['变形金刚'], outputDir: join(directory, 'oauth-word-image') };
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'word-image-prompt.txt'), illustrationPrompt(input));
const started = performance.now();
try {
  const result = await generateIllustration(input);
  await writeFile(join(directory, 'word-image-result.json'), JSON.stringify({ provider: 'official-codex-chatgpt', real: true, filePath: result.filePath, elapsedMs: Math.round(performance.now() - started) }, null, 2));
  console.log(JSON.stringify({ verified: true, filePath: result.filePath, elapsedMs: Math.round(performance.now() - started) }));
} catch (error) {
  const safe = { verified: false, code: (error as { code?: string }).code, message: error instanceof Error ? error.message : '未完成', elapsedMs: Math.round(performance.now() - started) };
  await writeFile(join(directory, 'word-image-result.json'), JSON.stringify(safe, null, 2));
  console.log(JSON.stringify(safe)); process.exitCode = 1;
}
