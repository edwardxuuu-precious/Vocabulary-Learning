import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = path.resolve(process.env.PLAYROOM_DATA_DIR ?? path.join(root, 'data'));
// Remove only this credential; vocabulary, progress and media stay in place.
rmSync(path.join(dataDir, 'parent-pin.json'), { force: true });
console.log('家长 PIN 已重置。启动网页后，请家长重新设置 6 位 PIN。');
