import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDialogueProvider } from '../server/integrations/dialogue.ts';

// Explicit manual smoke only. npm test never consumes OAuth or sends real child data.
if (!process.argv.includes('--live')) throw new Error('添加 --live 才会实际调用已登录的 Codex 账号。');
const envFile = resolve('.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = resolve('data', 'dialogue-smoke');
const profile = { nickname: '测试', interests: [], interestVersion: 0, onboardingCompleted: false };
let provider = createDialogueProvider({ dataDir, timeoutMs: 90_000 });
try {
  console.log(JSON.stringify({ phase: 'status', status: await provider.status() }));
  const first = await provider.turn({ message: '我喜欢会变身的挖掘机', context: {screen:'interest'}, profile, words: [] });
  console.log(JSON.stringify({ phase: 'first', ...first }));
  await provider.close();
  provider = createDialogueProvider({ dataDir, timeoutMs: 90_000 });
  const resumed = await provider.turn({ message: '我刚才说我喜欢什么？', conversationId: first.conversationId, context: {screen:'interest'}, profile, words: [] });
  console.log(JSON.stringify({ phase: 'resumed', ...resumed }));
  if (!/挖掘机/.test(resumed.reply.text)) throw new Error('恢复后的回答未复述测试兴趣，请人工检查输出。');
  console.log(JSON.stringify({ phase: 'verified', status: await provider.status() }));
} finally { await provider.close(); }
