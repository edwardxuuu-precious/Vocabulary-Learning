import type {AssessmentItem,AssessmentResult,GameWord} from './contracts.ts';

export interface AssessmentCue {version:1|2;kind:'meaning'|'context'|'needs-context';text:string;instruction?:string;sentence?:string}
const bareMeaning=(text:string)=>text.normalize('NFKC').trim().replace(/[\s。；;，,]+/gu,'');
const contexts:Record<string,string>={am:'我是……',are:'你是……',is:'他是……'};
// Authored question contexts. Match the confirmed sense; never change the word, its meaning or its approved assets.
const sentenceCues:Record<string,{meaning:string;text:string;sentence:string}>={
  all:{meaning:'所有的',text:'所有的小朋友都到了。',sentence:'___ the children are here.'},
  am:{meaning:'是',text:'我是一个孩子。',sentence:'I ___ a child.'},
  are:{meaning:'是',text:'你是我的朋友。',sentence:'You ___ my friend.'},
  is:{meaning:'是',text:'他是我的朋友。',sentence:'He ___ my friend.'},
  at:{meaning:'在……处',text:'我在学校。',sentence:'I am ___ school.'},
  ate:{meaning:'吃了',text:'昨天，我吃了一个苹果。',sentence:'Yesterday, I ___ an apple.'},
  be:{meaning:'是',text:'长大后，我想当厨师。',sentence:'I want to ___ a cook.'},
  black:{meaning:'黑色的',text:'这个书包是黑色的。',sentence:'The bag is ___.'},
  brown:{meaning:'棕色的',text:'小熊是棕色的。',sentence:'The bear is ___.'},
  but:{meaning:'但是',text:'我想出去玩，但是下雨了。',sentence:'I want to play, ___ it is raining.'},
  came:{meaning:'来了',text:'昨天，他来我家了。',sentence:'Yesterday, he ___ to my home.'},
};

/** Necessary question context is distinct from optional help. Never ask a child to guess a word form. */
export function assessmentCue(word:Pick<GameWord,'term'|'meaning'>,pool:Pick<GameWord,'term'|'meaning'>[]=[],version:AssessmentCue['version']=2):AssessmentCue {
  const term=word.term.trim().toLowerCase(),meaning=bareMeaning(word.meaning);
  const sentence=sentenceCues[term];
  if(version===2&&sentence&&bareMeaning(sentence.meaning)===meaning)return {version,kind:'context',text:sentence.text,sentence:sentence.sentence,instruction:'用学过的词，补上空白。只说一个词。'};
  if(meaning==='是'&&contexts[term])return {version,kind:'context',text:contexts[term],instruction:'说现在的“是”，用哪个英语词？'};
  const competing=new Set(pool.filter(other=>bareMeaning(other.meaning)===meaning).map(other=>other.term.trim().toLowerCase()));
  if(meaning==='是'||competing.size>1)return {version,kind:'needs-context',text:'这题先放一放',instruction:'中文还没说清楚，先请家长补充题目。'};
  return {version,kind:'meaning',text:word.meaning};
}

/** Active questions can use the authored replacement; saved answers retain their original frozen question until an explicit new recording. */
export function activeAssessmentCue(item:AssessmentItem,pool:Pick<GameWord,'term'|'meaning'>[]=[]):AssessmentCue {
  const latest=assessmentCue(item.word,pool);
  return !item.response||item.cue?.kind==='needs-context'&&latest.kind!=='needs-context'?latest:item.cue??latest;
}
export function repairableAssessmentItem(item:AssessmentItem,pool:Pick<GameWord,'term'|'meaning'>[]=[]){
  return item.dimension==='zh-en'&&item.response?.kind==='unavailable'&&item.cue?.kind==='needs-context'&&assessmentCue(item.word,pool).kind!=='needs-context';
}

export function validAssessmentCue(value:unknown,word:GameWord):value is AssessmentCue {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const cue=value as AssessmentCue;
  if(Object.keys(cue).some(key=>!['version','kind','text','instruction','sentence'].includes(key))||![1,2].includes(cue.version)||!['meaning','context','needs-context'].includes(cue.kind)||typeof cue.text!=='string'||!cue.text||cue.text.length>240||cue.instruction!==undefined&&(typeof cue.instruction!=='string'||cue.instruction.length>240)||cue.sentence!==undefined&&(typeof cue.sentence!=='string'||cue.sentence.length>240))return false;
  if(cue.kind==='context'){const expected=assessmentCue(word,[],cue.version);return expected.kind==='context'&&cue.text===expected.text&&cue.instruction===expected.instruction&&cue.sentence===expected.sentence;}
  if(cue.kind==='meaning')return cue.text===word.meaning&&cue.instruction===undefined&&cue.sentence===undefined&&bareMeaning(word.meaning)!=='是';
  return cue.text==='这题先放一放'&&cue.instruction==='中文还没说清楚，先请家长补充题目。'&&cue.sentence===undefined;
}

/** A bad/ambiguous prompt cannot establish an error or independent success. */
export function challengeReviewResult(item:AssessmentItem,result:AssessmentResult,pool:Pick<GameWord,'term'|'meaning'>[]=[]):AssessmentResult {
  if(item.dimension==='zh-en'){
    const cue=item.cue??assessmentCue(item.word,pool,item.response?.cueVersion??1);
    if(item.response?.kind==='unavailable'||cue.kind==='needs-context')return 'unavailable';
    if(cue.kind==='context'&&item.response?.cueVersion!==cue.version&&['correct','incorrect','hinted'].includes(result))return 'unconfirmed';
  }
  return result==='correct'&&item.response?.pictureHinted?'hinted':result;
}
