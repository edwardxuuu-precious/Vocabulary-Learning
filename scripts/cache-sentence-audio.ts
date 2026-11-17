import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../server/store.ts';
import {sentenceLesson} from '../shared/sentence-study.ts';

// Parent-authorized preparation only. Exact selected voice and confirmed free quota; no fallback or retry.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const speech=await import('../server/integrations/speech-router.ts');
const apply=process.argv.includes('--apply'),allEnabled=process.argv.includes('--all-enabled');if(process.argv.slice(2).some(arg=>!['--apply','--all-enabled'].includes(arg)))throw Error('支持 --apply 补缺、--all-enabled 显式包含全部已交付词；默认只检查当前挑战或最近完成轮次。');
const dataDir=resolve(root,process.env.PLAYROOM_DATA_DIR??'data'),store=new Store(dataDir),out=resolve(root,'artifacts','sentence-study-'+new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).replaceAll('-',''));mkdirSync(out,{recursive:true});
const data=store.read(),currentTest=[...(data.assessments??[])].reverse().find(row=>!row.submittedAt&&row.workflow==='recorded'),lastRound=data.sessions.filter(row=>row.completedAt&&!row.suspendedAt).sort((a,b)=>b.completedAt!.localeCompare(a.completedAt!))[0],scope=new Set(currentTest?.wordIds??lastRound?.completedWordIds??[]);
const texts=[...new Set(data.words.filter(word=>!word.deletedAt&&(allEnabled||scope.has(word.id))&&data.packs.some(pack=>pack.id===word.packId&&pack.enabled&&!pack.isSample)).flatMap(word=>{const lesson=sentenceLesson(word);return lesson?[lesson.full]:[];}))];
const report:{apply:boolean;rows:{text:string;cached:boolean;generated?:boolean}[];error?:string}={apply,rows:[]};
try{
  for(const text of texts){
    const input={text,locale:'en-US' as const,tone:'clear' as const,dataDir,freeOnly:true};let cached=!!await speech.getCachedSpeech(input);let generated=false;
    if(!cached&&apply){let charge:string|undefined;const result=await speech.synthesizeSpeech({...input,beforeRequest:()=>{charge=store.reserve('tts',speech.estimateTtsCost(text),text.length);}});if(charge)store.settle(charge,result.costCny,text.length);if(result.mode!=='api'||!result.filePath)throw Error('未获得所选音色的真实音频，已停止。');cached=!!await speech.getCachedSpeech(input);generated=!result.cached;if(!cached)throw Error('短句缓存未保存，已停止。');}
    report.rows.push({text,cached,generated});writeFileSync(resolve(out,'audio-preparation.json'),JSON.stringify(report,null,2));
  }
}catch(error){report.error=error instanceof Error?error.message:'准备失败';process.exitCode=1;}
finally{writeFileSync(resolve(out,'audio-preparation.json'),JSON.stringify(report,null,2));store.close();console.log(JSON.stringify(report));}
