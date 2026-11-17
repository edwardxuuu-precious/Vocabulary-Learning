import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssessmentData, AssessmentDimension, AssessmentResult, Word } from '../shared/contracts.ts';
import { currentAssessmentAttempts, currentWordAttempt } from '../shared/learning-evidence.ts';
import { goalObservations, recallObservations } from '../shared/learning-goals.ts';
import { childGrowth } from '../shared/growth.ts';
import { learningWeakness } from '../shared/learning.ts';

const now=new Date('2026-10-25T04:00:00Z');
const word:Word={id:'w',packId:'p',term:'apple',meaning:'苹果',imageUrl:'/apple.png',imageSource:'upload',assetStatus:'approved',learningVersion:0};
function fixture(){return {words:[word],packs:[],settings:{} as any,progress:[],sessions:[],attempts:[],assessments:[],assessmentAttempts:[]} as Parameters<typeof childGrowth>[0]&Parameters<typeof learningWeakness>[0];}
export function addEvidence(data:AssessmentData,target:Word,id:string,dimension:AssessmentDimension,result:AssessmentResult,createdAt:string,confirmedAt=createdAt){
  const snapshot={id:target.id,term:target.term,meaning:target.meaning,imageUrl:target.imageUrl,learningVersion:target.learningVersion??0};
  data.assessments??=[];data.assessmentAttempts??=[];
  data.assessments.push({id,mode:'full',wordIds:[target.id],startedAt:createdAt,completedAt:createdAt,items:[{id,dimension,word:snapshot,choices:[],result}]});
  data.assessmentAttempts.push({id,sessionId:id,itemId:id,wordId:target.id,learningVersion:target.learningVersion??0,dimension,result,source:dimension==='look'?'server':'parent',createdAt,confirmedAt});
}
test('late review of an older answer cannot replace newer evidence in recommendation, parent and growth views',()=>{
  const data=fixture();
  for(const dimension of ['look','read','zh-en'] as const){
    addEvidence(data,word,`older-${dimension}`,dimension,'correct','2026-10-23T01:00:00Z','2026-10-25T03:00:00Z');
    addEvidence(data,word,`newer-${dimension}`,dimension,'incorrect','2026-10-24T01:00:00Z');
  }
  data.assessmentAttempts!.reverse();
  const before=structuredClone(data);
  assert.equal(goalObservations(data,word,now).read.verified,0);
  assert.equal(goalObservations(data,word,now).recognize.verified,0);
  assert.equal(recallObservations(data,word,now).verified,false);
  assert.equal(childGrowth(data,now).skills.read,0);
  assert.equal(learningWeakness(data,word,'read',now),0);
  assert.deepEqual(data,before);
});
test('orphan, unfinished, future, wrong-source and stale-meaning evidence cannot grant formal success',()=>{
  for(const flaw of ['orphan','unfinished','future','source','meaning','version','reset'] as const){
    const data=fixture();addEvidence(data,word,'a','read','correct','2026-10-24T01:00:00Z');
    const target={...word};
    if(flaw==='orphan')data.assessments=[];
    if(flaw==='unfinished')delete data.assessments![0].completedAt;
    if(flaw==='future')data.assessmentAttempts![0].confirmedAt='2026-10-26T01:00:00Z';
    if(flaw==='source')data.assessmentAttempts![0].source='server';
    if(flaw==='meaning')target.meaning='苹果公司';
    if(flaw==='version')target.learningVersion=1;
    if(flaw==='reset')target.learningResetAt='2026-10-25T00:00:00Z';
    assert.equal(currentAssessmentAttempts(data,target,now).length,0,flaw);
    assert.equal(goalObservations(data,target,now).read.verified,0,flaw);
    assert.equal(learningWeakness(data,target,'read',now),2,flaw);
    data.words=[target];assert.equal(childGrowth(data,now).skills.read,0,flaw);
  }
});
test('recorded, helped, skipped and formal success remain separate; optional practice never becomes independent',()=>{
  const data=fixture();
  data.attempts.push({id:'a',wordId:'w',learningVersion:0,skill:'recall',source:'speech',correct:false,hinted:true,practiceOnly:true,oralStatus:'recorded',sessionId:'s',createdAt:now.toISOString()},
    {id:'b',wordId:'w',learningVersion:0,skill:'recognize',source:'click',correct:true,hinted:false,sessionPracticeOnly:true,sessionId:'s',createdAt:now.toISOString()});
  addEvidence(data,word,'pending','zh-en','unconfirmed','2026-10-24T01:00:00Z');
  assert.deepEqual(recallObservations(data,word,now),{recorded:1,skipped:0,helped:1,unprompted:0,verified:false});
  assert.equal(goalObservations(data,word,now).recognize.independent,0);
  assert.equal(currentWordAttempt({...word,learningResetAt:'2026-10-25T05:00:00Z'},data.attempts[0]),false);
});
test('reading success cannot stand in for recall or English-to-Chinese evidence when ranking review targets',()=>{
  const data=fixture();
  addEvidence(data,word,'read-pass','read','correct','2026-10-24T02:00:00Z');
  addEvidence(data,word,'recall-needs-help','zh-en','hinted','2026-10-24T01:00:00Z');
  addEvidence(data,word,'meaning-needs-practice','en-zh','incorrect','2026-10-24T01:00:00Z');
  assert.equal(goalObservations(data,word,now).read.verified,1);
  assert.equal(recallObservations(data,word,now).verified,false);
  assert.equal(childGrowth(data,now).skills.read,1);
  assert.equal(childGrowth(data,now).skills['zh-en'],0);
  assert.equal(learningWeakness(data,word,'read',now),3);
  assert.equal(learningWeakness(data,word,'recall',now),0);
  assert.equal(learningWeakness(data,word,'practice-en-zh',now),0);
});
