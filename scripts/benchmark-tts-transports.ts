import { loadEnvFile } from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { Store } from '../server/store.ts';
if(!process.argv.includes('--live'))throw new Error('需要--live，固定短句将使用当前真实语音额度。');
loadEnvFile(resolve('.env'));
const key=process.env.ELEVENLABS_API_KEY,voice=process.env.ELEVENLABS_VOICE_ID_ZH||process.env.ELEVENLABS_VOICE_ID;
const model=process.env.ELEVENLABS_TTS_MODEL||'eleven_v4_turbo';
if(!key||!voice||model!=='eleven_v4_turbo')throw new Error('仅测试已配置的原女声和v4 Turbo。');
const dir=resolve('artifacts/tts-transport-latency');await mkdir(dir,{recursive:true});
const store=new Store(dir);store.updateSettings({monthlyBudgetCny:1});
const rows:Record<string,unknown>[]=[];
const phrase='[curious] 会变身的挖掘机听起来好酷！';
const price=Number(process.env.ELEVENLABS_TTS_CNY_PER_MILLION||400);
const cost=[...phrase].length*price/1e6;
const holdMs=Number(process.argv.find(v=>v.startsWith('--hold-ms='))?.split('=')[1]||0);
if(!Number.isInteger(holdMs)||holdMs<0||holdMs>11000)throw new Error('预连接测试等待必须在0至11000ms。');
const valid=(audio:Buffer)=>audio.length>32&&(audio.subarray(0,3).toString()==='ID3'||audio[0]===255&&(audio[1]&224)===224);
try{
  for(const transport of process.argv.includes('--ws-only')?['ws','ws']:['http','ws','http','ws']){
    let charge:string|undefined;
    try{
      if(transport==='http'){
        const started=performance.now();charge=store.reserve('tts',cost,[...phrase].length);
        const response=await fetch('https://api.elevenlabs.io/v1/text-to-dialogue/stream?output_format=mp3_44100_128',{method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({model_id:model,language_code:'zh',inputs:[{text:phrase,voice_id:voice}],settings:{stability:.5},seed:1234,apply_text_normalization:'auto'}),signal:AbortSignal.timeout(15000)});
        const headersMs=Math.round(performance.now()-started);
        if(!response.ok||!response.body){await response.body?.cancel();throw new Error('HTTP_'+response.status);}
        const chunks:Buffer[]=[];let firstMs:number|undefined;
        for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){firstMs??=Math.round(performance.now()-started);chunks.push(Buffer.from(chunk));}
        const audio=Buffer.concat(chunks);if(!valid(audio))throw new Error('INVALID_AUDIO');
        store.settle(charge,cost,[...phrase].length);
        rows.push({transport,headersMs,firstMs,completeMs:Math.round(performance.now()-started),bytes:audio.length,region:response.headers.get('x-region')});
      }else{
        const started=performance.now();
        const row=await new Promise<Record<string,unknown>>((done,reject)=>{
          const url=new URL('wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input');url.searchParams.set('model_id',model);url.searchParams.set('output_format','mp3_44100_128');url.searchParams.set('language_code','zh');url.searchParams.set('seed','1234');
          const ws=new WebSocket(url,{headers:{'xi-api-key':key},handshakeTimeout:10000});
          let connectedMs=0,sentAt=0,firstMs:number|undefined,finished=false;const chunks:Buffer[]=[];
          const timer=setTimeout(()=>finish(new Error('WS_TIMEOUT')),15000);
          const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);ws.terminate();if(error)return reject(error);const audio=Buffer.concat(chunks);if(!valid(audio))return reject(new Error('INVALID_AUDIO'));done({transport,connectedMs,firstMs,firstAfterSendMs:firstMs===undefined?undefined:Math.round(firstMs-sentAt),completeMs:Math.round(performance.now()-started),bytes:audio.length});};
          ws.on('open',()=>{try{connectedMs=Math.round(performance.now()-started);ws.send(JSON.stringify({voices:[voice],voice_settings:{stability:.5}}));setTimeout(()=>{if(finished)return;try{charge=store.reserve('tts',cost,[...phrase].length);sentAt=performance.now()-started;ws.send(JSON.stringify({inputs:[{text:phrase,voice_id:voice,new_turn:true}],flush:true}));ws.send(JSON.stringify({close_socket:true}));}catch{finish(new Error('WS_BUDGET_OR_SEND'));}},holdMs);}catch{finish(new Error('WS_BUDGET_OR_SEND'));}});
          ws.on('message',raw=>{try{const message=JSON.parse(raw.toString());if(message.error)return finish(new Error('WS_PROVIDER_ERROR'));if(message.audio){firstMs??=Math.round(performance.now()-started);chunks.push(Buffer.from(message.audio,'base64'));}if(message.is_final)finish();}catch{finish(new Error('WS_PROTOCOL_ERROR'));}});
          ws.on('error',()=>finish(new Error('WS_CONNECTION_ERROR')));ws.on('close',()=>{if(!finished)finish(new Error('WS_EARLY_CLOSE'));});
        });
        if(charge)store.settle(charge,cost,[...phrase].length);rows.push(row);
      }
    }catch(error){rows.push({transport,error:error instanceof Error?error.message:'FAILED',reservationRetained:!!charge});}
    console.log(JSON.stringify(rows.at(-1)));await writeFile(resolve(dir,holdMs?'preconnected-results.json':'results.json'),JSON.stringify({at:new Date().toISOString(),model,syntheticVoice:true,phrase,holdMs,rows},null,2));
  }
}finally{store.close();}
