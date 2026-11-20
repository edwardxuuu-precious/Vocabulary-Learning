import type { GameKind, LearningActivity, LearningSession } from './contracts.ts';

export type RuleDemoKind='pictures'|'meaning'|'sounds'|'match'|'remember'|'oral'|'sequence'|'place'|'move'|'difference'|'draw'|'letters'|'wires';
export interface LearningGuidanceProgress {version:1;seen:string[];ruleHelpActivityIds:string[];struggles:Record<string,number>}
export interface RuleGuide {key:string;title:string;demo:RuleDemoKind;steps:[string,string,string];burden:1|2|3}
const guide=(key:string,title:string,demo:RuleDemoKind,steps:RuleGuide['steps'],burden:RuleGuide['burden']=1):RuleGuide=>({key,title,demo,steps,burden});
const pictures=guide('pictures','听一听，再点图片','pictures',['点声音','点对应的图片','点箭头继续']);
const sounds=guide('sounds','看图片，选声音','sounds',['点声音听一听','点“选这个”','点箭头继续']);
const match=guide('match','看看是不是一对','match',['看上面的词和图片','是一对点勾，不是点叉','点箭头继续']);
const oral=guide('oral','自己说，保存后继续','oral',['点麦克风开始说','说完停一停，或点“说完了”','保存后点“继续”']);
const sequence=guide('sequence','按顺序点，再检查','sequence',['按任务顺序点卡片','放好后点检查','不合适可以撤回'],2);
const place=guide('place','先选，再放进去','place',['先点一块','再点要放的位置','放好后点检查'],2);
const move=guide('move','点相邻格，再前进','move',['看自己在哪一格','点旁边的格子','一步一步走过去'],2);
const remember=guide('remember','先看清，再藏起来','remember',['先看看位置','点按钮藏起来','想一想再选'],2);
const difference=guide('difference','仔细看，找不同','difference',['先看几张卡','点不一样的一张','再点检查'],2);
const byKind:Record<GameKind,RuleGuide>={
  flip:pictures,supply:pictures,portal:oral,bingo:pictures,repair:{...pictures,title:'听声音，修好连接',demo:'wires',steps:['点左边听声音','点右边对应的图片','修好后点“继续”']},gate:match,treasure:remember,'listen-first':guide('listen-first','先听，再打开图片','pictures',['点声音','点箭头打开图片','选图片，再继续']),missing:remember,'think-choice':oral,
  queue:sequence,collect:guide('collect','把听到的都选上','sequence',['先听清任务','把需要的图片都点上','点检查'],2),switch:sounds,peek:guide('peek','揭开一点，再选声音','sounds',['点小格揭开图片','点声音听一听','选对应声音'],2),draw:guide('draw','听完画一画','draw',['先听声音','在画板画一画','画好后点继续'],3),mimic:oral,associate:place,quiz:guide('quiz','交给家人猜一猜','oral',['先准备线索','交给家人','猜完再揭晓'],3),route:move,'letter-path':move,
  variants:pictures,assemble:place,detective:difference,opposites:pictures,sort:place,odd:difference,parts:place,paint:place,position:place,pantomime:oral,clue:oral,cloze:oral,story:sequence,program:sequence,combine:place,'sentence-repair':difference,negative:pictures,intersection:pictures,information:guide('information','和家人轮流说','oral',['自己先看清','给家人线索','轮流说一说'],3),assign:place,quantity:guide('quantity','按数量放好','place',['听清要几个','点物品，再点位置','数量够了点检查'],2),
  'letter-gap':place,chunks:sequence,'letter-sort':place,'letter-extra':difference,'letter-swap':guide('swap','点两块，交换位置','sequence',['点第一块','再点另一块交换','点检查'],2),dictation:sequence,'cover-spell':remember,'letter-push':move,'word-morph':place,
};
/** Guides contain only operation rules: never a word, image, answer, cue or material from the question. */
export function ruleGuide(activity:LearningActivity):RuleGuide|undefined {
  if(activity.step==='learn')return;
  if(activity.step==='practice-look')return guide('recognize','看词，点图片','meaning',['先看看英文','点对应的图片','点箭头继续']);
  if(activity.step==='recall'||activity.step==='read'||activity.step.startsWith('practice-'))return oral;
  if(activity.step==='recognize')return activity.kind==='gate'?match:guide('recognize','看词，点图片','meaning',['先看看英文','点对应的图片','点箭头继续']);
  if(activity.kind==='gate')return guide('match-listen','先听，再判断是不是它','match',['先点声音','一样点勾，不同点叉','点箭头继续']);
  if(activity.kind==='switch')return activity.direction==='hear-picture'?pictures:sounds;
  if(activity.kind==='standard')return activity.step==='spell'?{...sequence,title:'点字母，把词拼出来',demo:'letters',steps:['点下面的字母','放错了，点上面的字母撤回','排好后点“拼好啦”']}:activity.step==='sound'?guide('sounds','听完，点一个答案','sounds',['先把声音听完','点一个声音作答','选对后点“继续”']):pictures;
  return byKind[activity.kind];
}
export const blankGuidance=():LearningGuidanceProgress=>({version:1,seen:[],ruleHelpActivityIds:[],struggles:{}});
export function usesDirectTaskInteraction(activity:LearningActivity){return activity.kind==='repair'||['recognize','read'].includes(activity.step)||activity.step==='recall'&&activity.kind==='portal'||activity.kind==='standard'&&['listen','sound','recall','spell'].includes(activity.step);}
export function needsAutomaticRuleGuide(session:LearningSession,activity:LearningActivity){return session.learningPolicy?.guidanceVersion===1&&!usesDirectTaskInteraction(activity)&&needsRuleGuide(session,activity);}
export function needsRuleGuide(session:LearningSession,activity:LearningActivity){const guide=ruleGuide(activity);return !!guide&&!['correct','practice'].includes(session.activityStates?.[activity.id]?.outcome??'')&&!session.guidance?.seen.includes(guide.key)&&!session.completedSteps?.[activity.wordId]?.includes(activity.step);}
export function validGuidance(session:LearningSession){
  const value=session.guidance;if(value===undefined)return true;
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||Object.keys(value).some(key=>!['version','seen','ruleHelpActivityIds','struggles'].includes(key)))return false;
  const activities=session.activities??[],keys=new Set(activities.map(row=>ruleGuide(row)?.key).filter(Boolean)),ids=new Set(activities.map(row=>row.id));
  const strings=(rows:unknown,allowed:Set<string|undefined>)=>Array.isArray(rows)&&rows.length<=10000&&new Set(rows).size===rows.length&&rows.every(row=>typeof row==='string'&&allowed.has(row));
  return strings(value.seen,keys)&&strings(value.ruleHelpActivityIds,ids)&&!!value.struggles&&typeof value.struggles==='object'&&!Array.isArray(value.struggles)&&Object.entries(value.struggles).every(([id,n])=>ids.has(id)&&Number.isInteger(n)&&n>=0&&n<=2);
}
