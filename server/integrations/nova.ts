import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { link, mkdir, open, realpath, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServiceStatus } from '../../shared/contracts.ts';
import type { TtsInput } from './elevenlabs.ts';
import { IntegrationError, throwIfAborted } from './errors.ts';
import { validateTtsInput, type TtsResult } from './speech.ts';

const renderer = fileURLToPath(new URL('../../scripts/nova-voice/render.py', import.meta.url));
const maxAudioBytes = 2_000_000;
const runtimePath = (dataDir: string) => join(dataDir, 'nova-voice');
const settingsPath = (dataDir: string) => join(runtimePath(dataDir), 'settings.json');
const audioFolder = (dataDir: string) => join(dataDir, 'speech', 'nova-v1');
const key = (text: string) => createHash('sha256').update(text).digest('hex') + '.mp3';
let pending: Promise<void> = Promise.resolve();

export function usesNova(input: Pick<TtsInput, 'locale' | 'dataDir'>) {
  return input.locale === 'en-US' && existsSync(settingsPath(input.dataDir));
}

function localPython(dataDir: string): string | undefined {
  try {
    const { version, python } = JSON.parse(readFileSync(settingsPath(dataDir), 'utf8'));
    if (version !== 1 || typeof python !== 'string' || !isAbsolute(python)) return;
    if (existsSync(python) && existsSync(renderer) && ['model.onnx', 'nova.npy', 'vocab.json', 'python'].every(name => existsSync(join(runtimePath(dataDir), name)))) return python;
  } catch { /* A partially installed runtime can still play existing cached files. */ }
}

export function novaStatus(dataDir: string): ServiceStatus {
  const ready = !!localPython(dataDir);
  return { provider: 'nova', configured: ready, available: ready, status: ready ? '本机就绪' : '等待准备工具',
    detail: ready ? '英文单词和短句使用 Nova 美式女声，家长备课时在本机生成。' : '已有 Nova 缓存可播放，准备新发音需要恢复本机语音工具。' };
}

function isMp3(bytes: Buffer) {
  return bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

export async function getNovaCache(input: TtsInput) {
  const text = validateTtsInput(input).text;
  const path = join(audioFolder(input.dataDir), key(text));
  try {
    // A local archive may use a different root, but a speech file must stay inside its own cache directory.
    const dataRoot = await realpath(input.dataDir);
    if (await realpath(path) !== join(audioFolder(dataRoot), key(text))) return;
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size <= 1024 || stat.size > maxAudioBytes) return;
      const header = Buffer.alloc(3);
      if ((await file.read(header, 0, 3, 0)).bytesRead === 3 && isMp3(header)) return path;
    } finally { await file.close(); }
  } catch { /* An absent or unreadable file remains a cache miss. */ }
}

function render(python: string, dataDir: string, text: string, signal?: AbortSignal) {
  // The renderer has its own local dependencies and does not receive cloud credentials.
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => ['systemroot', 'windir', 'path', 'temp', 'tmp', 'systemdrive'].includes(name.toLowerCase())));
  return new Promise<Buffer>((resolve, reject) => {
    const process = execFile(python, ['-I', '-X', 'utf8', renderer, '--runtime', runtimePath(dataDir)], {
      encoding: 'buffer', env, signal, timeout: 60_000, maxBuffer: maxAudioBytes, windowsHide: true,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    process.stdin?.on('error', () => { /* execFile reports a failed renderer. */ });
    process.stdin?.end(JSON.stringify({ text }));
  });
}

/** Called from explicit preparation paths. Listening requests only read existing files. */
export async function synthesizeNova(input: TtsInput): Promise<TtsResult> {
  throwIfAborted(input.signal);
  const text = validateTtsInput(input).text;
  const hit = await getNovaCache(input);
  if (hit) return { filePath: hit, mode: 'api', cached: true, costCny: 0 };
  const request = pending.then(async (): Promise<TtsResult> => {
    throwIfAborted(input.signal);
    const existing = await getNovaCache(input);
    if (existing) return { filePath: existing, mode: 'api', cached: true, costCny: 0 };
    const python = localPython(input.dataDir);
    if (!python) throw new IntegrationError('NOVA_RUNTIME_MISSING', '本机 Nova 准备工具尚未就绪。');
    const dataRoot = await realpath(input.dataDir);
    if (await realpath(runtimePath(input.dataDir)) !== runtimePath(dataRoot)) throw new IntegrationError('NOVA_RUNTIME_MISSING', '本机发音工具目录无效。');
    let bytes: Buffer;
    try { bytes = await render(python, dataRoot, text, input.signal); }
    catch { throwIfAborted(input.signal); throw new IntegrationError('NOVA_RENDER_FAILED', '这一条本机发音未生成，请检查后重试。'); }
    throwIfAborted(input.signal);
    if (bytes.length <= 1024 || bytes.length > maxAudioBytes || !isMp3(bytes)) throw new IntegrationError('NOVA_RENDER_FAILED', '本机发音文件不完整。');

    let folder = dataRoot;
    for (const part of ['speech', 'nova-v1']) {
      folder = join(folder, part);
      await mkdir(folder, { recursive: true });
      if (await realpath(folder) !== folder) throw new IntegrationError('NOVA_CACHE_INVALID', '本机发音缓存目录无效。');
    }
    const target = join(audioFolder(dataRoot), key(text));
    const temporary = join(folder, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      throwIfAborted(input.signal);
      try { await link(temporary, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !await getNovaCache(input)) throw error;
        return { filePath: target, mode: 'api', cached: true, costCny: 0 };
      }
      return { filePath: target, mode: 'api', cached: false, costCny: 0 };
    } finally { await unlink(temporary).catch(() => {}); }
  });
  pending = request.then(() => undefined, () => undefined);
  return request;
}
