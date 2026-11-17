import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,extname,isAbsolute,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {LearningData} from '../shared/learning.ts';
import {dailyLearningPlan} from '../shared/learning.ts';
import {currentActivity} from '../shared/game-plan.ts';
import {wordLearningProfiles,wordLearningLabels,type WordLearningData,type WordLearningStatus} from '../shared/word-learning.ts';
import {buildStudyAgenda} from '../shared/study-agenda.ts';
import {studyReadModel} from '../server/study-read-model.ts';
import {reconcileStudySession} from '../server/study-migration.ts';

const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const inside=(root:string,path:string)=>(process.platform==='win32'?path.toLowerCase():path).startsWith((process.platform==='win32'?root.toLowerCase():root)+sep);
function readDocument(source:string){
  const file=realpathSync(join(source,'playroom.sqlite'));if(!inside(source,file))throw Error('数据库链接超出指定来源。');
  const db=new DatabaseSync(file,{readOnly:true});try{const row=db.prepare('SELECT body FROM documents WHERE id=1').get() as {body:string}|undefined;if(!row)throw Error('来源缺少学习正文。');return row.body;}finally{db.close();}
}
function mediaSummary(source:string,data:unknown){
  const names=new Set<string>(),missing:string[]=[],files=new Map<string,string>();
  const collect=(value:unknown)=>{if(typeof value==='string'&&value.startsWith('/media/')&&/\.(png|jpg|jpeg|webp|svg)$/i.test(value))names.add(decodeURIComponent(value.slice(7)));else if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')Object.values(value).forEach(collect);};collect(data);
  const add=(file:string)=>{if(!inside(source,resolve(file)))throw Error('媒体路径超出来源。');if(!existsSync(file)){missing.push(file.slice(source.length+1));return;}const real=realpathSync(file);if(!inside(source,real))throw Error('媒体链接超出来源。');files.set(real.slice(source.length+1),digest(readFileSync(real)));};
  for(const name of names){if(isAbsolute(name))throw Error('媒体引用必须在指定来源内。');add(resolve(source,name));}
  const walk=(folder:string)=>{if(!existsSync(folder))return;if(!inside(source,realpathSync(folder)))throw Error('私有媒体目录链接超出来源。');for(const row of readdirSync(folder,{withFileTypes:true})){if(row.isSymbolicLink())throw Error('私有媒体含链接，须先明确审计来源。');const file=join(folder,row.name);if(row.isDirectory())walk(file);else if(row.isFile())add(file);}};
  for(const folder of ['speech','practice-recordings','assessment-recordings'])walk(join(source,folder));
  return {referencedImages:names.size,mediaAndPrivateFiles:files.size,missingImages:missing.length,sha256:digest(JSON.stringify([...files].sort(([a],[b])=>a.localeCompare(b))))};
}

/** This command deliberately does not open Store, load .env, inspect auth or call a provider. */
export function auditWordLearning(sourceArg:string,now=new Date()){
  if(!isAbsolute(sourceArg)||!Number.isFinite(now.getTime()))throw Error('需要明确的来源绝对路径与有效时间。');
  const source=realpathSync(sourceArg),before=readDocument(source),data=JSON.parse(before) as LearningData&WordLearningData;
  if(!Array.isArray(data.words)||!Array.isArray(data.packs)||!data.settings)throw Error('来源不是可识别的学习档案。');
  const objectBefore=JSON.stringify(data),mediaBefore=mediaSummary(source,data),profiles=wordLearningProfiles(data,now);
  const model=studyReadModel(data,{now,mode:'child'}),agendas={today:model.agenda,learn:buildStudyAgenda(data,{now,purpose:'learn'}),review:buildStudyAgenda(data,{now,purpose:'review'})};
  const oldLearn=dailyLearningPlan(data,now,'learn'),oldReview=dailyLearningPlan(data,now,'review');
  const sessionMap=(data.sessions??data.resumableSessions??[]).map(session=>{const current=currentActivity(session),word=data.words.find(word=>word.id===current?.wordId);return {sessionId:session.id,state:session.completedAt?'completed':session.suspendedAt?'suspended':'unfinished',wordCount:session.wordIds.length,completedWords:session.completedWordIds.length,completedSteps:Object.values(session.completedSteps??{}).reduce((sum,steps)=>sum+steps.length,0),currentActivityId:current?.id,currentWordId:current?.wordId,currentSnapshotStale:!!current&&(!word||word.term!==current.word.term||word.meaning!==current.word.meaning||(word.learningVersion??0)!==current.word.learningVersion),hasSavedPosition:!!session.pauseState};});
  const aliases=new Map<string,string[]>();for(const word of data.words){const key=JSON.stringify([word.term.normalize('NFC').trim().toLowerCase(),word.meaning.normalize('NFC').trim()]);aliases.set(key,[...(aliases.get(key)??[]),word.id]);}
  const after=readDocument(source),mediaAfter=mediaSummary(source,data),unchanged=before===after&&JSON.stringify(data)===objectBefore&&JSON.stringify(mediaBefore)===JSON.stringify(mediaAfter);
  const statuses=Object.fromEntries((Object.keys(wordLearningLabels) as WordLearningStatus[]).map(status=>[status,profiles.filter(profile=>profile.status===status).length]));
  const differences=profiles.flatMap(profile=>{
    const newGoals=agendas.today.goals.filter(goal=>goal.wordId===profile.wordId),oldKinds=[...(oldLearn.fresh.some(word=>word.id===profile.wordId)?['learn']:[]),...(oldReview.review.some(word=>word.id===profile.wordId)?['review']:[])];
    return oldKinds.length||newGoals.length?[{wordId:profile.wordId,status:profile.status,oldKinds,newGoals:newGoals.map(goal=>({kind:goal.kind,ability:goal.ability,reason:goal.reason})),profileNext:profile.next,deferred:agendas.today.deferred.filter(row=>row.wordId===profile.wordId).map(row=>row.reason)}]:[];
  });
  const proposed=structuredClone(data),beforeSessions=JSON.stringify(data.sessions);
  for(const session of proposed.sessions??[])if(!session.completedAt&&!session.suspendedAt)reconcileStudySession(proposed as any,session,now);
  const rawSessions=(rows:typeof data.sessions)=>JSON.stringify(rows?.map(({studyPlan,...row})=>row));
  const migration={mode:'proposal-only-no-write',rawSessionFieldsPreserved:rawSessions(data.sessions)===rawSessions(proposed.sessions),originalSessionObjectsUnchanged:JSON.stringify(data.sessions)===beforeSessions,proposals:(proposed.sessions??[]).filter(session=>session.studyPlan).map(session=>({sessionId:session.id,coveredActivityIds:session.studyPlan!.covered.map(row=>row.activityId)}))};
  return {schemaVersion:1,mode:'read-only-shadow',at:now.toISOString(),sourceUnchanged:unchanged,sourceDocumentSha256:digest(before),media:mediaBefore,
    counts:{words:data.words.length,sessions:sessionMap.length,attempts:data.attempts?.length??0,assessmentSessions:data.assessments?.length??0,assessmentAttempts:data.assessmentAttempts?.length??0},statuses,
    sessions:sessionMap,identityCandidates:[...aliases.values()].filter(ids=>ids.length>1).map(wordIds=>({wordIds,action:'review-only-no-automatic-merge'})),
    oldPlan:{learnWordIds:oldLearn.fresh.map(word=>word.id),reviewWordIds:oldReview.review.map(word=>word.id)},agendas,differences,
    binding:{version:model.version,mode:model.mode,planId:model.planId,sourceRevision:model.sourceRevision},continuity:model.continuity,migration,
    integrity:{inputObjectsUnchanged:JSON.stringify(data)===objectBefore,documentUnchanged:before===after,mediaUnchanged:JSON.stringify(mediaBefore)===JSON.stringify(mediaAfter),sourceHasMissingImages:mediaBefore.missingImages>0},
    limits:['影子计划没有接管正式执行，也不修改旧轮次或分数。','素材就绪依据原档案和已有就绪标识；未额外探测云服务或生成发音。','同词同义仅列候选映射，不自动合并跨书历史。','正式口头成绩与永久奖励仍由现有合法核验合同维护。']};
}

/** Explicit report-only write. Existing ancestors are resolved to reject junctions back into the source. */
export function writeWordLearningAudit(source:string,out:string,now=new Date()){
  const root=realpathSync(source),target=resolve(out);let ancestor=dirname(target),suffix:string[]=[];
  while(!existsSync(ancestor)){const parent=dirname(ancestor);if(parent===ancestor)throw Error('报告路径没有可访问的现有父目录。');suffix.unshift(ancestor.slice(parent.length+1));ancestor=parent;}
  const resolvedParent=resolve(realpathSync(ancestor),...suffix),resolvedTarget=join(resolvedParent,target.slice(dirname(target).length+1));
  const same=(a:string,b:string)=>(process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b);
  if(!isAbsolute(out)||inside(root,resolvedTarget)||same(resolvedTarget,root)||extname(target)!=='.json')throw Error('报告须为来源目录外的显式JSON绝对路径。');
  if(existsSync(target))throw Error('报告已存在，请使用新的输出路径；不会覆盖原文件。');
  const report=auditWordLearning(source,now);if(!report.sourceUnchanged)throw Error('审计期间来源发生变化；未写回，请在来源稳定后重试。');
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.some(arg=>!/^--(?:source|out|at)=/.test(arg)))throw Error('仅支持--source、--out与--at。');
  const source=args.find(arg=>arg.startsWith('--source='))?.slice(9);if(!source)throw Error('必须明确--source=学习data的绝对路径。');
  const out=args.find(arg=>arg.startsWith('--out='))?.slice(6),at=args.find(arg=>arg.startsWith('--at='))?.slice(5);
  const report=out?writeWordLearningAudit(source,out,at?new Date(at):new Date()):auditWordLearning(source,at?new Date(at):new Date());if(!report.sourceUnchanged)throw Error('审计期间来源发生变化；未写回，请在来源安静时重新核对。');
  if(out)console.log(JSON.stringify({out,counts:report.counts,statuses:report.statuses,sourceUnchanged:report.sourceUnchanged,media:report.media}));
  else console.log(JSON.stringify(report,null,2));
}
