// Loaded only by the explicit QA HTML, never imported by the production app.
type Trace={ms:number;event:string;detail?:string};
let epoch=performance.now(),microphoneClickedAt=0;const events:Trace[]=[];
function trace(event:string,detail?:string){events.push({ms:Math.round(performance.now()-epoch),event,...(detail?{detail}:{})});document.querySelector('#qa-events')!.textContent=JSON.stringify(events.slice(-160),null,1);}
document.querySelector('#qa-clear')!.addEventListener('click',()=>{events.length=0;epoch=performance.now();trace('trace:reset');});
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{const path=String(input);const begin=performance.now();if(path.startsWith('/api/'))trace('fetch:start',path);if(path.startsWith('/api/speech/tts')&&typeof init?.body==='string'){try{const request=JSON.parse(init.body);trace('tts:request',JSON.stringify({text:request.text,locale:request.locale,tone:request.tone,streaming:path.endsWith('/stream')}));}catch{}}if(path==='/api/attempts'&&typeof init?.body==='string'){try{const request=JSON.parse(init.body);trace('learning:attempt',JSON.stringify({wordId:request.wordId,skill:request.skill,correct:request.correct,hinted:request.hinted,practiceOnly:request.practiceOnly,source:request.source}));}catch{}}const response=await originalFetch(input,init);if(path.startsWith('/api/'))trace('fetch:headers',`${path} ${Math.round(performance.now()-begin)}ms ${response.status}`);
  if(path==='/api/chat/turn'&&response.body){const reader=response.clone().body!.getReader();void(async()=>{const decoder=new TextDecoder();let pending='';try{while(true){const chunk=await reader.read();if(chunk.done)break;pending+=decoder.decode(chunk.value,{stream:true});let end:number;while((end=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);for(const line of frame.split('\n'))if(line.startsWith('data:')){const item=JSON.parse(line.slice(5));trace('chat:'+item.type,item.type==='timing'?JSON.stringify({phase:item.phase,elapsedMs:item.elapsedMs}):item.stage??item.reply?.action?.type??item.code);}}}}catch{trace('chat:stream-cancel');}finally{reader.releaseLock();}})();}
  if(path==='/api/speech/tts')void response.clone().json().then(value=>trace('tts:ready',JSON.stringify({mode:value.mode,cached:value.cached}))).catch(()=>{});
  if(path==='/api/speech/tts/stream')trace('tts:stream',JSON.stringify({mode:response.headers.get('X-TTS-Mode'),cached:response.headers.get('X-TTS-Cached'),contentType:response.headers.get('Content-Type')}));
  if(path==='/api/speech/tts/stream'&&response.ok&&response.body){const probe=response.clone().body!.getReader();void probe.read().then(first=>{if(!first.done)trace('tts:first-body',`${Math.round(performance.now()-begin)}ms ${first.value.byteLength}bytes`);}).catch(()=>{}).finally(()=>{void probe.cancel().catch(()=>{});});}
  return response;};
const OriginalMediaSource=window.MediaSource;
if(OriginalMediaSource){window.MediaSource=class extends OriginalMediaSource{constructor(){super();trace('mse:created');this.addEventListener('sourceopen',()=>trace('mse:sourceopen'),{once:true});}};const append=SourceBuffer.prototype.appendBuffer,seen=new WeakSet<SourceBuffer>();SourceBuffer.prototype.appendBuffer=function(bytes){if(!seen.has(this)){seen.add(this);trace('mse:first-append',`${bytes.byteLength}bytes`);this.addEventListener('updateend',()=>trace('mse:first-updateend'),{once:true});}return append.call(this,bytes);};}
const OriginalSocket=window.WebSocket;
window.WebSocket=class extends OriginalSocket{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);if(!String(url).includes('/api/voice/stream'))return;microphoneClickedAt=performance.now();trace('ws:created');
  const slow=(document.querySelector('#qa-slow-ready') as HTMLInputElement).checked,created=performance.now();
  let handler:((this:WebSocket,event:MessageEvent)=>unknown)|null=null,queued:MessageEvent[]=[],timer:ReturnType<typeof setTimeout>|undefined;
  Object.defineProperty(this,'onmessage',{configurable:true,get:()=>handler,set:value=>{handler=value;}});
  const deliver=(event:MessageEvent)=>{if(this.readyState===OriginalSocket.OPEN)handler?.call(this,event);};
  this.addEventListener('open',()=>trace('ws:open'));this.addEventListener('message',e=>{try{const v=JSON.parse(String(e.data));trace('ws:'+v.type,v.type==='transcript'?(v.final?'final ':'partial ')+v.text:v.text??v.code);
    const remaining=3000-(performance.now()-created);
    if(slow&&(timer||v.type==='ready'&&remaining>0)){queued.push(e);if(!timer)timer=setTimeout(()=>{timer=undefined;trace('qa:ready-released');const pending=queued;queued=[];for(const event of pending)deliver(event);},Math.max(0,remaining));return;}
  }catch{}deliver(e);});this.addEventListener('close',()=>{if(timer)clearTimeout(timer);queued=[];trace('ws:closed');});}};
const OriginalAudio=window.Audio;
let audioId=0;
window.Audio=function(src?:string){const player=new OriginalAudio(src),id=++audioId;const detail=()=>`${id} ${player.src||src||''}`;trace('audio:created',detail());player.addEventListener('loadedmetadata',()=>trace('audio:loaded',`${detail()} duration=${player.duration}`));player.addEventListener('playing',()=>trace('audio:playing',detail()));player.addEventListener('pause',()=>trace('audio:pause',detail()));player.addEventListener('ended',()=>trace('audio:ended',detail()));player.addEventListener('error',()=>trace('audio:error',detail()));return player;} as typeof Audio;
window.Audio.prototype=OriginalAudio.prototype;
const contexts=new Set<AudioContext>();
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
  const name=(document.querySelector('#qa-fixture') as HTMLSelectElement).value;
  const context=new AudioContext();contexts.add(context);await context.resume();
  const bytes=await(await originalFetch(`/__qa/audio/${name}.wav`)).arrayBuffer();const raw=await context.decodeAudioData(bytes);
  const lead=0.5,tail=5;const padded=context.createBuffer(1,Math.ceil((lead+raw.duration+tail)*context.sampleRate),context.sampleRate);padded.getChannelData(0).set(raw.getChannelData(0),Math.round(lead*context.sampleRate));
  const source=context.createBufferSource();source.buffer=padded;const target=context.createMediaStreamDestination();source.connect(target);
  // The child starts after the tap, not after the provider handshake. A delayed microphone loses that prefix.
  const offset=microphoneClickedAt?Math.max(0,(performance.now()-microphoneClickedAt)/1000):0;
  // Separate the last acoustic activity from trailing silence in the synthetic WAV.
  const data=raw.getChannelData(0),frame=Math.max(1,Math.round(raw.sampleRate*.02));let lastVoice=0,priorVoice=0;const resumed:number[]=[];
  for(let at=0;at<data.length;at+=frame){let energy=0;const end=Math.min(data.length,at+frame);for(let i=at;i<end;i++)energy+=data[i]*data[i];if(Math.sqrt(energy/(end-at))>.015){if(priorVoice&&(at/raw.sampleRate-priorVoice)>.5)resumed.push(at/raw.sampleRate);lastVoice=end/raw.sampleRate;priorVoice=lastVoice;}}
  const timers=[setTimeout(()=>trace('fixture:speech-end',name),Math.max(0,lead+raw.duration-offset)*1000)];
  if(lastVoice)timers.push(setTimeout(()=>trace('fixture:voice-end',name),Math.max(0,lead+lastVoice-offset)*1000));
  for(const at of resumed)timers.push(setTimeout(()=>trace('fixture:voice-resume',name),Math.max(0,lead+at-offset)*1000));
  source.start(0,Math.min(offset,padded.duration-.01));trace('fixture:start',`${name} ${raw.duration.toFixed(2)}s delayedCapture=${Math.round(offset*1000)}ms`);
  for(const track of target.stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{for(const timer of timers)clearTimeout(timer);try{source.stop();}catch{}stop();void context.close();contexts.delete(context);trace('fixture:stopped',name);};}
  return target.stream;
}});
trace('qa:ready','合成麦克风，真实云服务，独立档案');
await import('/src/main.tsx');
