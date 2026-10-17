import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { validateWav } from '../../server/integrations/speech.ts';
import type { ChatStreamEvent, VoiceServerMessage } from '../../shared/contracts.ts';

if (!process.argv.includes('--live')) throw new Error('添加 --live 才会发送固定测试文字/合成语音，并使用已配置的 API 额度。');
const base='http://127.0.0.1:8787';
const report: Record<string,unknown> = { at:new Date().toISOString(), synthetic:true };
const tts=await fetch(base+'/api/speech/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'嗨，我是小栗！今天我们一起玩英语吧。',locale:'zh-CN',tone:'cheerful'}),signal:AbortSignal.timeout(35_000)});
const speech=await tts.json();
if(!tts.ok||speech.mode!=='api'||!speech.audioUrl)throw new Error('云朗读未通过：'+(speech.error||speech.message||'当前为本机朗读模式'));
const audio=await fetch(new URL(speech.audioUrl,base));
if(!audio.ok||Number(audio.headers.get('content-length'))<32)throw new Error('云朗读文件不可用。');
report.tts={mode:speech.mode,cached:speech.cached,contentType:audio.headers.get('content-type'),bytes:Number(audio.headers.get('content-length')),audioUrl:speech.audioUrl};
await audio.body?.cancel();
console.log(JSON.stringify({phase:'tts',...report.tts as object}));
if(process.argv.includes('--english')) {
  const response=await fetch(base+'/api/speech/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'apple',locale:'en-US',tone:'clear'}),signal:AbortSignal.timeout(35_000)});
  const value=await response.json();
  if(!response.ok||value.mode!=='api'||!value.audioUrl)throw new Error('英文单词云朗读未通过。');
  report.englishTts={text:'apple',mode:value.mode,cached:value.cached,audioUrl:value.audioUrl};
  console.log(JSON.stringify({phase:'english',...report.englishTts as object}));
}
if(!process.argv.includes('--tts-only')){
  const wav=await readFile(resolve('artifacts/synthetic-stt-fixture.wav'));validateWav(wav);
  let pcm=Buffer.alloc(0);
  for(let offset=12;offset+8<=wav.length;){const bytes=wav.readUInt32LE(offset+4),start=offset+8;if(wav.toString('ascii',offset,offset+4)==='data')pcm=Buffer.concat([pcm,wav.subarray(start,start+bytes)]);offset=start+bytes+bytes%2;}
  if(!pcm.length)throw new Error('合成语音没有PCM数据，请先运行make-voice-fixture.ps1。');
  const automatic=process.argv.includes('--auto-endpoint');
  const stream=automatic?Buffer.concat([pcm,Buffer.alloc(4*32000)]):pcm;
  const transcript=await new Promise<string>((resolveTurn,reject)=>{
    const ws=new WebSocket(base.replace('http:','ws:')+'/api/voice/stream',{headers:{Origin:base}});
    let ended=false;
    const finish=(error?:Error,text?:string)=>{if(ended)return;ended=true;clearTimeout(timer);ws.close();error?reject(error):resolveTurn(text??'');};
    const timer=setTimeout(()=>finish(new Error('实时转写未在30秒内定稿。')),30_000);
    ws.on('open',()=>ws.send(JSON.stringify({type:'start',locale:'zh-CN'})));
    ws.on('error',()=>finish(new Error('本机实时语音连接失败。')));
    ws.on('close',()=>{if(!ended)finish(new Error('本机语音连接在定稿前关闭。'));});
    ws.on('message',raw=>{
      const event=JSON.parse(raw.toString()) as VoiceServerMessage;
      if(event.type==='ready')void(async()=>{for(let offset=0;offset<stream.length&&!ended;offset+=3200){ws.send(stream.subarray(offset,offset+3200));await new Promise(r=>setTimeout(r,100));}if(!ended&&!automatic)ws.send(JSON.stringify({type:'finish'}));})();
      else if(event.type==='endpoint')finish(undefined,event.text);
      else if(event.type==='error')finish(new Error(event.message));
    });
  });
  if(!/挖掘机/.test(transcript))throw new Error('真实转写完成，但没有识别出固定测试词，请人工检查。');
  report.stt={transcript,bytes:pcm.length,seconds:pcm.length/32000,automaticEndpoint:automatic};console.log(JSON.stringify({phase:'stt',...report.stt as object}));
  if(process.argv.includes('--dialogue')) {
    const chat=await fetch(base+'/api/chat/turn',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({message:transcript,context:{screen:'interest'}}),signal:AbortSignal.timeout(90_000)});
    if(!chat.ok)throw new Error('Codex 对话接口未成功。');
    const events=(await chat.text()).split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5).trim()) as ChatStreamEvent);
    const response=events.find(event=>event.type==='reply');
    const failed=events.find(event=>event.type==='error');
    if(failed?.type==='error')throw new Error(failed.message);
    if(response?.type!=='reply'||!events.some(event=>event.type==='done'))throw new Error('Codex 未返回经过校验的完整回复。');
    report.dialogue={reply:response.reply,source:'codex-oauth',interestConfirmed:false};
    const spoken=await fetch(base+'/api/speech/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:response.reply.text,locale:'zh-CN',tone:response.reply.tone}),signal:AbortSignal.timeout(35_000)});
    const playback=await spoken.json();
    if(!spoken.ok||playback.mode!=='api'||!playback.audioUrl)throw new Error('Codex 回复的云端朗读未通过。');
    const file=await fetch(new URL(playback.audioUrl,base));
    if(!file.ok)throw new Error('Codex 回复的音频文件不可用。');
    const bytes=Buffer.from(await file.arrayBuffer());
    if(bytes.length<32)throw new Error('Codex 回复的音频为空。');
    await writeFile(resolve('artifacts/xiaoli-voice-sample.mp3'),bytes);
    report.dialogueTts={mode:playback.mode,cached:playback.cached,bytes:bytes.length,audioUrl:playback.audioUrl};
    console.log(JSON.stringify({phase:'dialogue',...report.dialogue as object,audioBytes:bytes.length}));
  }
}
const reportPath=process.argv.includes('--auto-endpoint')?'artifacts/voice-auto-smoke.json':'artifacts/voice-live-smoke.json';
await writeFile(resolve(reportPath),JSON.stringify(report,null,2),'utf8');
console.log(`固定测试数据验收完成；没有使用儿童录音，结果保存在 ${reportPath}。`);
