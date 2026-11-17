import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeK1, summarizeK2, summarizeK3, type OpportunityFact, type ProbeFact } from '../shared/business-metrics.ts';

const opportunity:OpportunityFact={id:'1',eligibility:'eligible',voluntary:true,stepByStepHelp:false,completed:true,end:'completed'};
const probe:ProbeFact={id:'a',wordId:'apple',learningVersion:0,direction:'recall',interval:'next-day',outcome:'correct',authority:'parent',evidenceId:'reviewed-attempt'};

test('K1 includes refusals, rest and mid-session device failure; preflight failures stay separately visible',()=>{
  const rows:OpportunityFact[]=[opportunity,{...opportunity,id:'2',voluntary:false,completed:false,end:'refused'},
    {...opportunity,id:'3',completed:false,end:'rest'},{...opportunity,id:'4',completed:false,end:'device'},
    {...opportunity,id:'5',eligibility:'ineligible',completed:false,end:'device'},
    {...opportunity,id:'6',eligibility:'unknown'},{...opportunity,id:'7',stepByStepHelp:null}];
  const original=structuredClone(rows), result=summarizeK1(rows);
  assert.deepEqual([result.numerator,result.denominator,result.rate],[1,5,0.2]);
  assert.deepEqual([result.refused,result.rest,result.deviceFailures,result.excluded,result.eligibilityUnknown,result.missing],[1,1,1,1,1,1]);
  assert.deepEqual(rows,original);
});
test('empty samples are unknown; repeated reads do not create opportunities and conflicting facts fail',()=>{
  assert.equal(summarizeK1([]).rate,null);
  assert.equal(summarizeK1([opportunity,opportunity]).denominator,1);
  assert.throws(()=>summarizeK1([opportunity,{...opportunity,completed:false}]),/冲突/);
});
test('K2 keeps helped completions in the denominator, displays coverage and never grades raw oral practice',()=>{
  const rows:ProbeFact[]=[probe,{...probe,id:'b',wordId:'b',outcome:'incorrect'},
    {...probe,id:'c',wordId:'c',outcome:'helped',authority:'practice'},
    {...probe,id:'d',wordId:'d',authority:'practice'},
    {...probe,id:'e',wordId:'e',outcome:'missing'},
    {...probe,id:'f',wordId:'f',outcome:'skipped'},
    {...probe,id:'g',wordId:'g',outcome:'unavailable'},
    {...probe,id:'h',wordId:'h',outcome:'unconfirmed'}];
  const before=structuredClone(rows), [result]=summarizeK2(rows);
  assert.deepEqual([result.numerator,result.denominator,result.planned,result.rate,result.coverage],[1,3,8,1/3,3/8]);
  assert.deepEqual([result.unconfirmed,result.missing,result.skipped,result.unavailable],[2,1,1,1]);
  assert.deepEqual(rows,before);
});
test('K2 separates direction and delay; does not substitute retry success for the frozen first probe',()=>{
  assert.deepEqual(summarizeK2([probe,{...probe,id:'b',direction:'listen',authority:'objective'},
    {...probe,id:'c',interval:'day-7',outcome:'unconfirmed'}]).map(row=>[row.scope,row.rate]),
    [['next-day:recall',1],['next-day:listen',1],['day-7:recall',null]]);
  assert.throws(()=>summarizeK2([probe,{...probe,id:'retry'}]),/重试/);
  assert.throws(()=>summarizeK2([probe,{...probe,id:'changed-meaning',learningVersion:1}]),/冻结义项/);
  assert.equal(summarizeK2([probe,probe])[0].planned,1);
  assert.equal(summarizeK2([{...probe,evidenceId:undefined}])[0].unconfirmed,1);
  assert.equal(summarizeK2([{...probe,authority:'objective'}])[0].rate,null);
  assert.deepEqual(summarizeK2([]),[]);
});
test('K3 reports one fixed cohort, excludes waiting and refuses to invent missing active minutes',()=>{
  const row={id:'cohort-1',plannedWords:8,deliveredWords:5,completeCycle:true,
    activeMinutes:{preparation:3,repair:1,guidance:2,review:4},waitingMinutes:20};
  assert.equal(summarizeK3(row).minutesPerTen,20);
  assert.equal(summarizeK3({...row,completeCycle:false}).minutesPerTen,null);
  assert.equal(summarizeK3({...row,deliveredWords:0}).minutesPerTen,null);
  const partial=summarizeK3({...row,activeMinutes:{...row.activeMinutes,repair:null}});
  assert.equal(partial.activeMinutes,null); assert.equal(partial.missingCategories,1);
  assert.throws(()=>summarizeK3({...row,waitingMinutes:-1}),/无效/);
});
