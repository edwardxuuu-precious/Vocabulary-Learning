import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 8798);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('验收端口无效');
const dir = path.join(root, 'artifacts', `challenge-qa-${randomUUID()}`), dataDir = path.join(dir, 'data');
mkdirSync(path.join(dataDir, 'speech', 'qa'), { recursive: true });
// Offline Windows voices prepare synthetic test material. No child or microphone audio is used.
const ps = path.join(dir, 'prepare.ps1');
writeFileSync(ps, '\uFEFF' + `Add-Type -AssemblyName System.Speech
$speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer
$format=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
$speaker.SelectVoice('Microsoft Huihui Desktop')
$words=@('苹果','香蕉','猫','狗','球','汽车')
for($i=0;$i -lt $words.Length;$i++){ $speaker.SetOutputToWaveFile((Join-Path $PSScriptRoot ('data/speech/qa/prompt-'+$i+'.wav')),$format); $speaker.Speak(('意思是，'+$words[$i]+'。')); $speaker.SetOutputToNull() }
$speaker.SelectVoice('Microsoft Zira Desktop')
$speaker.SetOutputToWaveFile((Join-Path $PSScriptRoot 'data/speech/qa/answer.wav'),$format); $speaker.Speak('apple'); $speaker.SetOutputToNull(); $speaker.Dispose()
`, 'utf8');
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { windowsHide: true, stdio: 'pipe' });
for (const name of Object.keys(process.env)) if (/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(name)) delete process.env[name];
const load = process.loadEnvFile; process.loadEnvFile = () => {};
const { createApp } = await import('../server/index.ts'); process.loadEnvFile = load;
const { ParentGate } = await import('../server/parent-gate.ts');
const disabled = { configured: false, available: false, status: 'qa_disabled', detail: '隔离模拟，未调用真实云服务' };
let offset = 0, stt = 0, grades = 0, requests = 0; const prompts = new Map(['苹果','香蕉','猫','狗','球','汽车'].map((meaning, i) => [`意思是，${meaning}。`, path.join(dataDir, 'speech', 'qa', `prompt-${i}.wav`)]));
globalThis.fetch = async () => { throw Error('隔离验收禁止外部请求'); };
const app = createApp({ rootDir: root, dataDir, clock: () => new Date(Date.now() + offset), integrations: { probeIntegrations: async () => ({ speech: disabled, codex: disabled }), getCachedSpeech: async input => prompts.get(input.text), synthesizeSpeech: async () => { throw Error('禁止生成'); } }, challengeServices: {
  transcribe: async input => { stt++; return input.language === 'zh' ? '苹果' : 'apple'; },
  grade: async answers => { grades++; return answers.map((answer, index) => ({ id: answer.id, verdict: index === 1 ? 'practice' as const : index === 2 ? 'unclear' as const : 'matched' as const, reason: '隔离测试替身：只验证流程，不代表真实识别结果' })); },
} });
new ParentGate(dataDir).setup('097531'); app.store.enablePack('starter', true);
const ids = app.store.read().words.slice(0, 6).map(word => word.id);
app.store.mutate(data => { const at = app.store.clock().toISOString(); data.profile.nickname = '挑战验收示例'; data.settings.monthlyBudgetCny = 0; data.sessions.push({ id: 'qa-lesson', wordIds: ids, completedWordIds: ids, startedAt: at, completedAt: at, rewardGranted: true }); data.attempts.push(...ids.map(wordId => ({ id: wordId, wordId, sessionId: 'qa-lesson', learningVersion: 0, skill: 'listen' as const, correct: true, hinted: false, source: 'click' as const, createdAt: at }))); });
const initial = app.store.read();
const audit = () => { const data = app.store.read(); const value = { isolated: true, mockedProviders: true, stt, grades, requests, data }; writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(value, null, 2)); return value; };
const handler = app.server.listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => void; app.server.removeAllListeners('request');
const syntheticMic = `<script>navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();const b=await c.decodeAudioData(await(await fetch('/__qa/answer.wav')).arrayBuffer());const s=c.createBufferSource();s.buffer=b;s.loop=true;const d=c.createMediaStreamDestination();s.connect(d);s.start();for(const t of d.stream.getTracks()){const stop=t.stop.bind(t);t.stop=()=>{s.stop();void c.close();stop()}}return d.stream};</script>`;
app.server.on('request', (req, res) => {
  requests++; const route = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname;
  if (route === '/__qa/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(audit())); return; }
  if (route === '/__qa/next-day' && req.method === 'POST') { offset += 86400000; res.setHeader('Content-Type', 'application/json'); res.end('{}'); return; }
  if (route === '/__qa/answer.wav') { res.setHeader('Content-Type', 'audio/wav'); res.end(readFileSync(path.join(dataDir, 'speech', 'qa', 'answer.wav'))); return; }
  const client = path.join(root, 'artifacts', 'challenge-qa-client');
  if (route === '/' || route === '/index.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(readFileSync(path.join(client, 'scripts', 'challenge-qa.html'), 'utf8').replace('</head>', `${syntheticMic}</head>`)); return; }
  if (route.startsWith('/__challenge/assets/')) { const name = route.slice('/__challenge/assets/'.length); if (!/^[\w.-]+\.(js|css)$/.test(name) || !existsSync(path.join(client, 'assets', name))) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/css'); res.end(readFileSync(path.join(client, 'assets', name))); return; }
  handler(req, res);
});
await new Promise<void>(resolve => app.server.listen(port, '127.0.0.1', resolve)); audit();
console.log(JSON.stringify({ dir, url: `http://127.0.0.1:${port}`, pin: '097531', isolated: true }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { audit(); void app.close().then(() => process.exit(0)); });
