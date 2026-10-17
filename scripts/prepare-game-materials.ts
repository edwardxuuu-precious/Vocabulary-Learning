/** Default is check-only. --apply is an explicit local parent operation; it never approves semantic proposals. */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../server/store.ts';
import { buildGameMaterialProposals, derivedGameKinds, derivedWordMaterial } from '../shared/game-material-builder.ts';
import { validGameMaterial } from '../shared/game-materials.ts';
import { readyGameMaterialKeys } from '../server/game-material-readiness.ts';
import { gameMaterialAudioCues, prepareGameAudio } from '../server/game-audio-preparation.ts';

if (process.argv.slice(2).some(arg => arg !== '--apply'&&!/^--pack=[a-zA-Z0-9_-]{1,80}$/.test(arg))||process.argv.filter(arg=>arg.startsWith('--pack=')).length>1) throw Error('支持 --apply 和 --pack=正式词书ID；不传 --apply 时仅检查缓存。');
const selectedPack=process.argv.find(arg=>arg.startsWith('--pack='))?.slice(7);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(join(root,'.env')))process.loadEnvFile(join(root,'.env'));
const integration=await import('../server/integrations/index.ts');
const dataDir=resolve(root,process.env.PLAYROOM_DATA_DIR??'data'),store=new Store(dataDir),apply=process.argv.includes('--apply');
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
try{
  const data=store.read(),enabled=new Set(data.packs.filter(p=>(selectedPack?p.id===selectedPack:p.enabled)&&!p.isSample&&!p.deletedAt).map(p=>p.id));
  if(selectedPack&&!enabled.has(selectedPack))throw Error('找不到指定的正式词书，未开始准备。');
  const words=data.words.filter(w=>enabled.has(w.packId)&&!w.deletedAt&&w.assetStatus==='approved');
  const proposals=buildGameMaterialProposals(words),automatic=words.flatMap(word=>derivedGameKinds.map(kind=>({wordId:word.id,kind,material:derivedWordMaterial(word,kind)!})));
  const items=[...automatic,...proposals];
  if(items.some(p=>!validGameMaterial(p.kind,p.material)))throw Error('候选素材校验失败，未开始准备。');
  const cues=[...new Map(items.flatMap(p=>gameMaterialAudioCues(words.find(w=>w.id===p.wordId)!,p.kind,p.material)).map(c=>[c.locale+':'+c.text,c])).values()];
  const missing=[];
  for(const cue of cues)if(!await integration.getCachedSpeech({...cue,tone:'clear',dataDir}))missing.push(cue);
  console.log(JSON.stringify({apply,words:words.length,automaticMaterials:automatic.length,reviewProposals:proposals.length,uniqueCues:cues.length,missingCues:missing.length,missingCharacters:missing.reduce((n,c)=>n+c.text.length,0)}));
  if(!apply)process.exitCode=0;
  else{
    // A finite per-run budget in addition to the persisted monthly and provider-free-quota gates.
    if(missing.reduce((n,c)=>n+c.text.length,0)>5000)throw Error('本次缺失发音超过5000字符，停止；请在家长页按词书分批准备。');
    const out=join(dataDir,'game-material-proposals');await mkdir(out,{recursive:true});
    await writeFile(join(out,'current.json'),JSON.stringify({at:new Date().toISOString(),status:'pending-parent-review',proposals},null,2),'utf8');
    let completed=0;
    for(const p of items){
      const word=words.find(w=>w.id===p.wordId)!;
      const check=()=>{const current=store.read().words.find(w=>w.id===word.id);if(!current||JSON.stringify([current.term,current.meaning,current.imageUrl,current.learningVersion,current.assetStatus])!==JSON.stringify([word.term,word.meaning,word.imageUrl,word.learningVersion,word.assetStatus]))throw Error('词表已变化，准备停止；已缓存音频保留。');};
      await prepareGameAudio({word,kind:p.kind,material:p.material,integration,store,dataDir,signal:controller.signal,check});
      console.log(JSON.stringify({completed:++completed,total:items.length,term:word.term,kind:p.kind}));
    }
    const ready=await readyGameMaterialKeys(words,words,url=>existsSync(url.startsWith('/media/')?join(dataDir,url.slice(7)):join(root,'public',url)),async cue=>!!await integration.getCachedSpeech({...cue,tone:'clear',dataDir}));
    console.log(JSON.stringify({complete:true,automaticReady:ready.length,pendingParentReview:proposals.length}));
  }
}catch(error){console.error(error instanceof Error?error.message:'游戏素材准备失败。');process.exitCode=1;}finally{store.close();}
