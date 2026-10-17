import type { GameKind, GameMaterial, Word } from './contracts.ts';

export const batchThreeKinds = ['variants','assemble','detective','opposites','sort','odd','parts','paint','position','pantomime'] as const;
export const batchFourKinds = ['clue','cloze','story','program','combine','sentence-repair','negative','intersection','information','assign'] as const;
export const batchFiveKinds = ['quantity','letter-gap','chunks','letter-sort','letter-extra','letter-swap','dictation','cover-spell','letter-push','word-morph'] as const;
export const extendedKinds = new Set<string>([...batchThreeKinds,...batchFourKinds,...batchFiveKinds]);
export const spokenKinds = new Set<string>(['pantomime','clue','cloze','information']);
export const automaticSpelling = new Set<string>(['letter-gap','letter-sort','letter-extra','letter-swap','dictation','cover-spell','letter-push']);
export const builtInGameInstructions:Record<string,string>={
  'letter-gap':'先听英文，点一个字母补到问号里，再检查。',
  'letter-sort':'先听两个词，再点混在一起的字母，按顺序放进对应图片的字母篮。放错了可以撤回。',
  'letter-extra':'听单词，点多出来的字母把它拿走，再检查。想改可以撤回。',
  'letter-swap':'先听单词，再点两个字母交换位置，直到拼好。撤回可以还原上次交换。',
  'dictation':'先听英文，再点下面的字母键拼出单词。没有图片和长度提示，想改可以撤回。',
  'cover-spell':'先听英文，记住完整单词，准备好就合上书，再点字母拼出来。可以随时打开核对。',
  'letter-push':'先听单词，点一个字母箱，再点它旁边的空格，一步一步移动。让顶排的虚线格从左到右组成单词，下面还有空位可以绕行。',
};
const id = (v:unknown):v is string => typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const text = (v:unknown,max=300):v is string => typeof v==='string'&&v.trim().length>0&&v.length<=max;
export const materialMedia = (v:unknown):v is string => typeof v==='string'&&(/^\/assets\/words\/[a-z-]+\.svg$/.test(v)||/^\/media\/images\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp|gif)$/.test(v)&&!v.includes('..'));
const cue = (v:any) => v&&Object.keys(v).every(k=>['text','locale'].includes(k))&&text(v.text)&&['zh-CN','en-US'].includes(v.locale);

/** Shape validation is separate from the parent's semantic review. No relation is inferred by AI. */
export function validGameMaterial(kind:string, m:any):m is GameMaterial {
  if(!extendedKinds.has(kind)||!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['version','wordVersion','approvedAt','instruction','prompt','tiles','answer','slots','placements','clues','sentence','blank','source','chunks','count','wordIds','wordVersions','acceptedSlots'].includes(k)))return false;
  if(m.version!==1||!Number.isInteger(m.wordVersion)||m.wordVersion<0||typeof m.approvedAt!=='string'||m.approvedAt.length>40||!Number.isFinite(Date.parse(m.approvedAt))||!text(m.instruction)||!Array.isArray(m.wordIds)||m.wordIds.length>12||new Set(m.wordIds).size!==m.wordIds.length||m.wordIds.some((v:unknown)=>!id(v)))return false;
  if(!m.wordVersions||typeof m.wordVersions!=='object'||Array.isArray(m.wordVersions)||Object.keys(m.wordVersions).length!==m.wordIds.length||m.wordIds.some((id:string)=>!Number.isInteger(m.wordVersions[id])||m.wordVersions[id]<0))return false;
  if(m.prompt!==undefined&&!cue(m.prompt)||!Array.isArray(m.tiles)||m.tiles.length>12||!m.tiles.length||new Set(m.tiles.map((t:any)=>t?.id)).size!==m.tiles.length)return false;
  if(m.tiles.some((t:any)=>!t||Object.keys(t).some(k=>!['id','label','imageUrl','text','wordId','color','motion'].includes(k))||!id(t.id)||!text(t.label,100)||t.imageUrl!==undefined&&!materialMedia(t.imageUrl)||t.text!==undefined&&!text(t.text,80)||t.wordId!==undefined&&!m.wordIds.includes(t.wordId)||t.color!==undefined&&!/^#[a-f0-9]{6}$/i.test(t.color)||t.motion!==undefined&&!['run','jump','wave','turn','sit','stand'].includes(t.motion)))return false;
  const ids=new Set(m.tiles.map((t:any)=>t.id));
  if(!Array.isArray(m.answer)||!m.answer.length||m.answer.length>12||m.answer.some((v:unknown)=>!ids.has(v)))return false;
  if(m.slots!==undefined&&(!Array.isArray(m.slots)||!m.slots.length||m.slots.length>12||new Set(m.slots.map((s:any)=>s?.id)).size!==m.slots.length||m.slots.some((s:any)=>!s||Object.keys(s).some(k=>!['id','label','symbol','x','y'].includes(k))||!id(s.id)||!text(s.label,80)||s.symbol!==undefined&&!text(s.symbol,8)||s.x!==undefined&&(!Number.isFinite(s.x)||s.x<0||s.x>100)||s.y!==undefined&&(!Number.isFinite(s.y)||s.y<0||s.y>100))))return false;
  if(m.acceptedSlots!==undefined&&(!Array.isArray(m.acceptedSlots)||!m.acceptedSlots.length||new Set(m.acceptedSlots).size!==m.acceptedSlots.length||m.acceptedSlots.some((id:string)=>!m.slots?.some((s:any)=>s.id===id))))return false;
  if(m.placements!==undefined&&(!m.slots||typeof m.placements!=='object'||Array.isArray(m.placements)||Object.entries(m.placements).some(([k,v])=>!ids.has(k)||!m.slots.some((s:any)=>s.id===v))))return false;
  if(m.clues!==undefined&&(!Array.isArray(m.clues)||m.clues.length!==2||m.clues.some((c:any)=>!c||Object.keys(c).some(k=>!['text','locale','matches'].includes(k))||!cue({text:c.text,locale:c.locale})||!Array.isArray(c.matches)||!c.matches.length||c.matches.some((v:unknown)=>!ids.has(v)))))return false;
  if(m.sentence!==undefined&&(!Array.isArray(m.sentence)||m.sentence.length<2||m.sentence.length>8||m.sentence.some((v:unknown)=>!text(v,80))))return false;
  if(m.blank!==undefined&&(!Number.isInteger(m.blank)||!m.sentence||m.blank<0||m.blank>=m.sentence.length))return false;
  if(m.source!==undefined&&(!text(m.source,12)||!/^[a-z]{2,8}$/i.test(m.source)))return false;
  if(m.chunks!==undefined&&(!Array.isArray(m.chunks)||m.chunks.length<2||m.chunks.length>3||m.chunks.some((v:unknown)=>!text(v,6)||!/^[a-z]+$/i.test(v as string))))return false;
  if(m.count!==undefined&&(!Number.isInteger(m.count)||m.count<1||m.count>5))return false;
  if(['assemble','sort','parts','position','combine','assign','detective'].includes(kind)&&(!m.slots||!m.placements||!m.answer.every((v:string)=>m.placements[v])))return false;
  if(['detective','clue','cloze','story','combine','sentence-repair','negative','quantity'].includes(kind)&&!m.prompt)return false;
  if(kind==='detective'&&(!m.slots||m.slots.length<2)||kind==='variants'&&(m.answer.length<2||m.answer.length>=m.tiles.length||new Set(m.answer.map((v:string)=>m.tiles.find((t:any)=>t.id===v)?.imageUrl)).size!==m.answer.length))return false;
  if(['sort','odd','opposites','paint','position','parts','sentence-repair','word-morph','cloze','assign'].includes(kind)&&m.answer.length!==1)return false;
  if(kind==='paint'&&m.tiles.some((t:any)=>!t.color)||kind==='pantomime'&&!m.tiles.some((t:any)=>t.motion)||kind==='intersection'&&!m.clues||kind==='quantity'&&!m.count||['cloze','sentence-repair'].includes(kind)&&(!m.sentence||m.blank===undefined)||kind==='chunks'&&!m.chunks||kind==='word-morph'&&!m.source)return false;
  if(['story','program','combine'].includes(kind)&&m.answer.length!==2)return false;
  if(kind==='odd'&&(m.tiles.length!==3||new Set(m.tiles.map((t:any)=>t.wordId)).size!==3||m.tiles.some((t:any)=>!t.wordId)))return false;
  if(kind==='variants'&&m.tiles.some((t:any)=>!t.imageUrl)||kind==='parts'&&(!m.tiles.some((t:any)=>!m.answer.includes(t.id)&&t.imageUrl)||m.slots!.some((s:any)=>s.x===undefined||s.y===undefined)))return false;
  if(kind==='intersection'){const intersection=m.tiles.filter((t:any)=>m.clues.every((c:any)=>c.matches.includes(t.id))).map((t:any)=>t.id);if(new Set(m.answer).size!==m.answer.length||intersection.length!==m.answer.length||m.answer.some((id:string)=>!intersection.includes(id)))return false;}
  return true;
}
export function materialCues(m:GameMaterial) {return [{text:m.instruction,locale:'zh-CN' as const},...(m.prompt?[m.prompt]:[]),...(m.clues??[]).map(c=>({text:c.text,locale:c.locale}))];}
export function readyMaterial(word:Word,kind:string,words:Word[]) {
  if(kind==='pantomime'&&word.partOfSpeech!=='verb')return;
  const m=word.gameMaterials?.[kind as GameKind];
  return m&&validGameMaterial(kind,m)&&m.wordVersion===(word.learningVersion??0)&&m.wordIds.every(id=>words.some(w=>w.id===id&&w.assetStatus==='approved'&&(w.learningVersion??0)===m.wordVersions[id]))?m:undefined;
}
