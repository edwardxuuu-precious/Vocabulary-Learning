import { AppError, type Store } from './store.ts';
import type { BusinessEvent, BusinessObservationView, EffortObservation, ObservationAudience, OpportunityObservation, ProbeObservation } from '../shared/contracts.ts';
import { learningEncounters } from '../shared/learning-history.ts';
import { observationDayGap, observationSummary, observationVersion, probeObservationFacts } from '../shared/business-observations.ts';

type RecordKind='opportunity'|'effort'|'probe'|'event';
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const key=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9-]{8,100}$/.test(value);
const count=(value:unknown,max=10000):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
const choice=(value:unknown,values:string[])=>typeof value==='string'&&values.includes(value);
const nullableBoolean=(value:unknown)=>value===null||typeof value==='boolean';
const nullableCount=(value:unknown)=>value===null||count(value);
const minutes=(value:unknown)=>value===null||typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=10000;
function requireShape(value:unknown,keys:string[]):asserts value is Record<string,unknown>{if(!plain(value)||Object.keys(value).some(field=>!keys.includes(field)))throw new AppError('观察字段无效，请刷新后重试。','OBSERVATION_INVALID');}
const canonical=(value:any):string=>JSON.stringify(value,(_key,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])):row);
const withoutStamp=(value:any)=>{const {revision,createdAt,updatedAt,audience,...fact}=value;return fact;};

/** Private tables are deliberately outside the public learning document, AppState and ordinary backup. */
export class BusinessObservations {
  constructor(private store:Store,readonly audience:ObservationAudience){
    store.db.exec('CREATE TABLE IF NOT EXISTS business_observations (ordinal INTEGER PRIMARY KEY, audience TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(audience,kind,record_id,revision)); CREATE INDEX IF NOT EXISTS business_observations_scope ON business_observations(audience,kind)');
  }
  private records<T>(kind:RecordKind):T[]{return this.store.db.prepare('SELECT body FROM business_observations WHERE audience=? AND kind=? ORDER BY ordinal').all(this.audience,kind).map(row=>JSON.parse(row.body as string));}
  private latest<T extends {id:string}>(kind:RecordKind):T[]{const map=new Map<string,T>();for(const row of this.records<T>(kind))map.set(row.id,row);return [...map.values()];}
  private save<T extends {id:string}>(kind:Exclude<RecordKind,'event'>,body:Record<string,unknown>,fact:T):T&{revision:number;createdAt:string;updatedAt:string;audience:ObservationAudience}{
    if(!key(body.id)||!count(body.expectedRevision))throw new AppError('观察版本无效。','OBSERVATION_INVALID');
    const all=this.records<any>(kind).filter(row=>row.id===body.id),old=all.at(-1),retry=all.find(row=>row.revision===Number(body.expectedRevision)+1);
    if(retry&&canonical(withoutStamp(retry))===canonical(fact))return retry;
    if((old?.revision??0)!==body.expectedRevision)throw new AppError('这条观察已被更新，请刷新后补记。','OBSERVATION_CONFLICT',409);
    if(all.length>200||Number(this.store.db.prepare('SELECT COUNT(*) AS n FROM business_observations WHERE audience=?').get(this.audience)!.n)>100000)throw new AppError('观察记录较多，请先导出检查。','OBSERVATION_LIMIT',409);
    const now=this.store.clock().toISOString(),saved={...fact,revision:Number(body.expectedRevision)+1,createdAt:old?.createdAt??now,updatedAt:now,audience:this.audience};
    this.store.db.prepare('INSERT INTO business_observations(audience,kind,record_id,revision,body) VALUES(?,?,?,?,?)').run(this.audience,kind,body.id,saved.revision,JSON.stringify(saved));return saved;
  }
  opportunity(input:unknown){
    requireShape(input,['id','expectedRevision','entry','eligibility','voluntary','stepByStepHelp','completed','end','stopAt','helpCount','sessionId']);
    if(!choice(input.entry,['learn','review'])||!choice(input.eligibility,['eligible','ineligible','unknown'])||!choice(input.end,['completed','rest','refused','device','unknown'])
      ||!choice(input.stopAt,['unknown','entry','meaning','understanding','recall','continue','audio','recording'])||![input.voluntary,input.stepByStepHelp,input.completed].every(nullableBoolean)||!nullableCount(input.helpCount))throw new AppError('请按实际观察选择；不知道的保留不知道。','OBSERVATION_INVALID');
    if(input.helpCount!==null&&Number(input.helpCount)>0&&input.stepByStepHelp===false)throw new AppError('有逐步指点时不能同时记为无需指点。','OBSERVATION_INVALID');
    const old=this.latest<OpportunityObservation>('opportunity').find(row=>row.id===input.id);
    if(old&&old.entry!==input.entry)throw new AppError('原机会的入口不能改，请另记一次机会。','OBSERVATION_CONFLICT',409);
    if(input.sessionId!==undefined&&!this.store.read().sessions.some(session=>session.id===input.sessionId&&(!session.entrySource||session.entrySource.entry===input.entry)))throw new AppError('关联轮次不存在。','OBSERVATION_INVALID');
    const {expectedRevision,...fact}=input;return this.save('opportunity',input,fact as unknown as OpportunityObservation);
  }
  effort(input:unknown,readyWordIds:string[]){
    requireShape(input,['id','expectedRevision','packId','completeCycle','activeMinutes','waitingMinutes','repairCount','reviewItems']);
    if(typeof input.packId!=='string'||typeof input.completeCycle!=='boolean'||!plain(input.activeMinutes)||Object.keys(input.activeMinutes).sort().join(',')!=='guidance,preparation,repair,review'
      ||!Object.values(input.activeMinutes).every(minutes)||!minutes(input.waitingMinutes)||!nullableCount(input.repairCount)||!nullableCount(input.reviewItems))throw new AppError('投入按实际分钟记，未记的留空。','OBSERVATION_INVALID');
    const data=this.store.read(),old=this.latest<EffortObservation>('effort').find(row=>row.id===input.id),pack=data.packs.find(pack=>pack.id===input.packId&&!pack.deletedAt&&!pack.isSample);
    if(!old&&!pack)throw new AppError('请先选择实际词书范围。','OBSERVATION_INVALID');
    if(old&&old.packId!==input.packId)throw new AppError('这组投入的原范围已冻结。','OBSERVATION_CONFLICT',409);
    const words=old?.words??data.words.filter(word=>word.packId===input.packId&&!word.deletedAt).map(word=>({id:word.id,learningVersion:word.learningVersion??0}));
    if(!words.length)throw new AppError('词组范围不能为空。','OBSERVATION_INVALID');
    const deliveredWordIds=old?.completeCycle?old.deliveredWordIds:words.filter(snapshot=>readyWordIds.includes(snapshot.id)&&data.words.some(word=>word.id===snapshot.id&&(word.learningVersion??0)===snapshot.learningVersion)).map(word=>word.id);
    const {expectedRevision,...fields}=input;
    return this.save('effort',input,{...fields,words,plannedWords:words.length,deliveredWordIds,deliveredWords:deliveredWordIds.length} as unknown as EffortObservation);
  }
  probe(input:unknown){
    requireShape(input,['id','expectedRevision','wordIds','direction','interval','externalContact']);
    if(!choice(input.direction,['listen','recognize','read','recall'])||!choice(input.interval,['next-day','day-7'])||!choice(input.externalContact,['unknown','none','reported']))throw new AppError('观察方向或间隔无效。','OBSERVATION_INVALID');
    const old=this.latest<ProbeObservation>('probe').find(row=>row.id===input.id);
    if(old){if(old.direction!==input.direction||old.interval!==input.interval||JSON.stringify(old.targets.map(target=>target.word.id))!==JSON.stringify(input.wordIds))throw new AppError('探测范围已经冻结，不能按结果换词或方向。','OBSERVATION_CONFLICT',409);
      return this.save('probe',input,{id:old.id,direction:old.direction,interval:old.interval,externalContact:input.externalContact,targets:old.targets} as ProbeObservation);}
    const data=this.store.read(),now=this.store.clock(),encounters=learningEncounters(data),enabled=new Set(data.packs.filter(pack=>pack.enabled&&!pack.isSample&&!pack.deletedAt).map(pack=>pack.id));
    if(!Array.isArray(input.wordIds)||!input.wordIds.length||input.wordIds.length>100||new Set(input.wordIds).size!==input.wordIds.length)throw new AppError('请选择已经认识的观察词。','OBSERVATION_INVALID');
    const targets=input.wordIds.map(id=>{
      const word=data.words.find(word=>word.id===id&&!word.deletedAt&&enabled.has(word.packId)&&word.assetStatus==='approved'),intro=encounters.find(fact=>fact.wordId===id);
      if(!word||!intro||Date.parse(intro.introducedAt)>now.getTime()||observationDayGap(intro.introducedAt,now.toISOString())>(input.interval==='next-day'?1:7))throw new AppError('有词未认识、已改义或已错过该间隔；不能事后补成预先计划。','OBSERVATION_WINDOW',409);
      return {word:{id:word.id,term:word.term,meaning:word.meaning,imageUrl:word.imageUrl,learningVersion:word.learningVersion??0},introducedAt:intro.introducedAt};
    });
    const prospective={id:String(input.id),revision:0,createdAt:targets.map(target=>target.introducedAt).sort()[0],updatedAt:now.toISOString(),audience:this.audience,direction:input.direction,interval:input.interval,externalContact:input.externalContact,targets} as ProbeObservation;
    if(probeObservationFacts(prospective,data,now).some(row=>row.actualDays!==null))throw new AppError('这些词在该条件下已有尝试，不能事后冻结并挑选结果。','OBSERVATION_WINDOW',409);
    return this.save('probe',input,{id:input.id,direction:input.direction,interval:input.interval,externalContact:input.externalContact,targets} as ProbeObservation);
  }
  events(input:unknown){
    requireShape(input,['events']);if(!Array.isArray(input.events)||input.events.length>20)throw new AppError('观察片段数量无效。','OBSERVATION_INVALID');
    const data=this.store.read(),now=this.store.clock(),events:BusinessEvent[]=[];
    for(const body of input.events){
      requireShape(body,['id','clientId','sessionId','activityId','at','kind','phase','durationMs','issue']);
      const session=data.sessions.find(session=>session.id===body.sessionId);
      if(!key(body.id)||!key(body.clientId)||!session||typeof body.at!=='string'||!Number.isFinite(Date.parse(body.at))||Date.parse(body.at)>now.getTime()+120000||Date.parse(body.at)<now.getTime()-86400000
        ||body.activityId!==undefined&&!session.activities?.some(activity=>activity.id===body.activityId)||!choice(body.kind,['interval','opened','issue']))throw new AppError('观察片段来源无效。','OBSERVATION_INVALID');
      if(body.kind==='interval'&&(!choice(body.phase,['foreground','system-wait','paused','background'])||!count(body.durationMs,15000)||body.issue!==undefined)
        ||body.kind==='issue'&&(!choice(body.issue,['audio','microphone','recording-save','request'])||body.phase!==undefined||body.durationMs!==undefined)
        ||body.kind==='opened'&&(body.phase!==undefined||body.durationMs!==undefined||body.issue!==undefined))throw new AppError('观察片段内容无效。','OBSERVATION_INVALID');
      events.push({...body,audience:this.audience,receivedAt:now.toISOString()} as unknown as BusinessEvent);
    }
    if(Number(this.store.db.prepare('SELECT COUNT(*) AS n FROM business_observations WHERE audience=?').get(this.audience)!.n)+events.length>100000)throw new AppError('观察记录较多，请先导出检查。','OBSERVATION_LIMIT',409);
    this.store.db.exec('BEGIN IMMEDIATE');try{
      for(const event of events){const found=this.store.db.prepare('SELECT body FROM business_observations WHERE audience=? AND kind=? AND record_id=?').get(this.audience,'event',event.id);
        if(found){const old=JSON.parse(found.body as string);if(canonical({...old,receivedAt:''})!==canonical({...event,receivedAt:''}))throw new AppError('同一观察片段冲突。','OBSERVATION_CONFLICT',409);continue;}
        this.store.db.prepare('INSERT INTO business_observations(audience,kind,record_id,revision,body) VALUES(?,?,?,?,?)').run(this.audience,'event',event.id,1,JSON.stringify(event));
      }this.store.db.exec('COMMIT');
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    return {accepted:events.length};
  }
  view():BusinessObservationView{
    const opportunities=this.latest<OpportunityObservation>('opportunity'),efforts=this.latest<EffortObservation>('effort'),probes=this.latest<ProbeObservation>('probe'),events=this.records<BusinessEvent>('event');
    return {...observationSummary(opportunities,efforts,probes,events,this.store.read(),this.store.clock()),audience:this.audience,opportunities,efforts,probes,eventCount:events.length};
  }
  export(){return {format:observationVersion,audience:this.audience,exportedAt:this.store.clock().toISOString(),records:{opportunities:this.records('opportunity'),efforts:this.records('effort'),probes:this.records('probe'),events:this.records('event')},view:this.view()};}
}
