/** Explicit demonstration content only. Never imported by the production app or enabled in a parent's pack. */
import type { GameKind, GameMaterial, GameTile, Word } from '../shared/contracts.ts';
import { automaticSpelling, builtInGameInstructions, materialCues } from '../shared/game-materials.ts';
const builtin=new Set(['apple','banana','cat','dog','ball','car','sun','moon','fish','bird','jump','run']);
const names:Record<string,string>={apple:'苹果',banana:'香蕉',cat:'猫',dog:'狗',ball:'球',car:'汽车',sun:'太阳',moon:'月亮',fish:'鱼',bird:'鸟',jump:'跳跃',run:'跑步',big:'大的',small:'小的',tail:'尾巴',red:'红色',blue:'蓝色',yellow:'黄色',in:'在里面',on:'在上面',under:'在下面',two:'二'};
const image=(term:string)=>builtin.has(term)?`/assets/words/${term}.svg`:`/media/images/game-demo/${term}.png`;
const tile=(id:string,term=id):GameTile=>({id,label:names[term]??term,imageUrl:image(term),wordId:`demo-${term}`});
const pictured=(id:string,path:string,label:string):GameTile=>({id,label,imageUrl:`/media/images/game-demo/${path}.png`});
const cue=(text:string,locale:'en-US'|'zh-CN'='zh-CN')=>({text,locale});
export function extendedDemo(kind:GameKind) {
  let terms=['apple','cat','dog'];
  if(kind==='intersection')terms=['apple','banana','cat'];
  if(kind==='variants')terms=['apple','banana','cat'];
  if(kind==='assemble')terms=['car','cat','dog'];
  if(kind==='detective'||kind==='clue'||kind==='cloze'||kind==='sentence-repair'||kind==='information')terms=['cat','dog','apple'];
  if(kind==='opposites')terms=['big','small','cat'];
  if(kind==='parts')terms=['tail','cat','dog'];
  if(kind==='paint')terms=['red','blue','yellow'];
  if(kind==='position')terms=['in','on','under'];
  if(kind==='pantomime'||kind==='story'||kind==='program'||kind==='assign')terms=['jump','run','cat'];
  if(kind==='combine')terms=['red','ball','cat'];
  if(kind==='quantity')terms=['two','apple','cat'];
  if(kind==='word-morph')terms=['car','cat','dog'];
  const words:Word[]=terms.map(term=>({id:`demo-${term}`,packId:'starter',term,meaning:names[term],partOfSpeech:['jump','run'].includes(term)?'verb':['big','small','red','blue','yellow'].includes(term)?'adjective':['in','on','under'].includes(term)?'preposition':term==='two'?'numeral':'noun',imageUrl:image(term),assetStatus:'approved',imageSource:'builtin',learningVersion:0}));
  const m:GameMaterial={version:1,wordVersion:0,approvedAt:'2026-10-17T05:00:00Z',wordIds:words.map(w=>w.id),wordVersions:Object.fromEntries(words.map(w=>[w.id,0])),instruction:'先听一听，再点图片。做完可以检查，也可以跳过。',tiles:[tile(terms[0]),tile(terms[1]),tile(terms[2])],answer:[terms[0]]};
  switch(kind){
    case 'variants':m.instruction='听这个词，把所有符合它的图片都点亮。再点一次可以取消。';m.tiles=[tile('apple'),pictured('green-apple','apple-green','另一种苹果'),tile('banana')];m.answer=['apple','green-apple'];break;
    case 'assemble':m.instruction='听汽车的英文。先点一个部件，再点虚线位置，把需要的车身和车轮拼好。';m.tiles=[pictured('body','car-body','车身'),pictured('wheels','car-wheels','车轮'),tile('sun')];delete m.tiles[2].wordId;m.answer=['body','wheels'];m.slots=[{id:'upper',label:'上方',symbol:'▱'},{id:'lower',label:'下方',symbol:'◉◉'}];m.placements={body:'upper',wheels:'lower'};break;
    case 'detective':m.instruction='先听英文，选猫或狗。然后找区别：尖耳朵和胡须，还是垂耳朵和长鼻子？';m.prompt=cue('cat','en-US');m.tiles=[tile('cat'),tile('dog')];m.slots=[{id:'whiskers',label:'尖耳朵、胡须',symbol:'=^='},{id:'nose',label:'垂耳朵、长鼻子',symbol:'U●U'}];m.placements={cat:'whiskers'};break;
    case 'opposites':m.instruction='听大或小的英文，选意思相反的图片，放到跷跷板另一边。';m.tiles=[tile('small'),tile('big')];m.answer=['small'];break;
    case 'sort':m.instruction='听这张卡的英文。先拿起卡片，再放进水果篮或动物篮。';m.tiles=[tile('apple')];m.slots=[{id:'fruit',label:'水果',symbol:'🍎'},{id:'animal',label:'动物',symbol:'🐾'}];m.placements={apple:'fruit'};break;
    case 'odd':m.instruction='听这三个英文词，找出和另外两个不属于同一类的一个。可以点喇叭单独重听。';m.tiles=[tile('cat'),tile('dog'),tile('apple')];break;
    case 'parts':m.instruction='听部件的英文。先拿起尾巴，再点完整猫图上它应该在的位置。';m.tiles=[pictured('tail','tail','尾巴'),tile('whole','cat')];m.slots=[{id:'tail-spot',label:'尾巴处',symbol:'◯',x:80,y:67},{id:'ear-spot',label:'耳朵处',symbol:'◯',x:42,y:20},{id:'face-spot',label:'脸部',symbol:'◯',x:45,y:42}];m.answer=['tail'];m.placements={tail:'tail-spot'};break;
    case 'paint':m.instruction='听颜色的英文。先点带纹理的颜料，再点小房子上色。';m.tiles=['red','blue','yellow'].map((c,i)=>({id:c,label:names[c],color:['#ec7770','#729de1','#e8c05e'][i]}));m.answer=['red'];break;
    case 'position':m.instruction='听位置的英文。点小球，再放到盒子里面、上面或下面。';m.tiles=[{id:'ball',label:'小球',imageUrl:image('ball')}];m.slots=[{id:'above',label:'在上面',symbol:'↑'},{id:'inside',label:'在里面',symbol:'⊙'},{id:'below',label:'在下面',symbol:'↓'}];m.answer=['ball'];m.placements={ball:'inside'};break;
    case 'pantomime':m.instruction='先看没有声音的动作。试着说英文并录下来，再打开答案听一听。';m.tiles=[{id:'jump',label:'无声跳跃演示',motion:'jump'}];m.answer=['jump'];break;
    case 'clue':m.instruction='听中文线索，试着说出对应的英文。点麦克风录下来，再听答案。';m.prompt=cue('我会喵喵叫，有胡须，也有一条长尾巴。我是谁？');break;
    case 'cloze':m.instruction='听熟悉的短句。空着的地方看图补说一个词，录下来后听完整的句子。';m.prompt=cue('I see a ...','en-US');m.sentence=['I','see','a','cat'];m.blank=3;break;
    case 'story':m.instruction='听小故事，把两张动作图按实际发生顺序排好。听到词的先后，不一定就是动作的先后。运行可以看自己的安排。';m.prompt=cue('The child jumps across the puddle after a run.','en-US');m.tiles=[tile('jump'),tile('run')];m.answer=['run','jump'];break;
    case 'program':m.instruction='先听任务，用动作积木编一个两步小程序。点运行让小人照着做，不合适可以撤回重排。';m.prompt=cue('First jump. Then run.','en-US');m.tiles=[{...tile('jump'),imageUrl:undefined,motion:'jump'},{...tile('run'),imageUrl:undefined,motion:'run'}];m.answer=['jump','run'];break;
    case 'combine':m.instruction='听颜色加物品的组合，分别把颜料和物品放入两个位置。';m.prompt=cue('red ball','en-US');m.tiles=[{id:'red',label:'红色',color:'#ec7770',wordId:'demo-red'},tile('ball'),tile('cat')];m.answer=['red','ball'];m.slots=[{id:'color',label:'颜色',symbol:'🎨'},{id:'object',label:'物品',symbol:'▧'}];m.placements={red:'color',ball:'object'};break;
    case 'sentence-repair':m.instruction='看猫的图片，听这句英文。点句子里不对的那个词，再选正确的声音词块替换。';m.prompt=cue('I see a dog','en-US');m.sentence=['I','see','a','dog'];m.blank=3;m.tiles=[{...tile('cat'),text:'cat'},{...tile('dog'),text:'dog'},{...tile('apple'),text:'apple'}];break;
    case 'negative':m.instruction='听否定指令，把仍然符合要求的图片都点亮，不只有一个答案。';m.prompt=cue('Not apple. Choose the others.','en-US');m.tiles=[tile('apple'),tile('cat'),tile('dog')];m.answer=['cat','dog'];break;
    case 'intersection':m.instruction='先听第一条线索，点掉不合适的图片。再听第二条，留下同时符合两条线索的朋友。';m.tiles=[tile('apple'),tile('banana'),tile('cat')];m.clues=[{...cue('Keep the fruit.','en-US'),matches:['apple','banana']},{...cue('Keep the round red fruit.','en-US'),matches:['apple']}];break;
    case 'information':m.instruction='请家长先记住秘密词，然后藏起来交给孩子。孩子听一个词、问这个吗，家长回答是或不是。最后说出秘密词并录下来。';break;
    case 'assign':m.instruction='听动作词，把动作卡交给能做它的角色。猫和小朋友都能跳，不止一个合理答案。';m.tiles=[{id:'jump',label:'跳跃动作卡',motion:'jump'}];m.answer=['jump'];m.slots=[{id:'cat',label:'猫',symbol:'🐈'},{id:'child',label:'小朋友',symbol:'🧒'},{id:'stone',label:'石头',symbol:'🪨'}];m.placements={jump:'cat'};m.acceptedSlots=['cat','child'];break;
    case 'quantity':m.instruction='听数量加物品的订单。每点一次加一件，放多了可以撤回。数量和物品各占一个学习步骤。';m.prompt=cue('two apples','en-US');m.tiles=[tile('apple'),tile('cat')];m.answer=['apple'];m.count=2;break;
    case 'chunks':m.instruction='听单词，把家长分好的字块按顺序拼起来。这是记忆字块，不是自然拼读规则。';m.chunks=['app','le'];break;
    case 'word-morph':m.instruction='从猫这个已学词出发，听新词。选位置，再换字母、插入或删除，把它变成新词。';m.source='cat';break;
  }
  // Only the main demo target owns the reviewed material; other targets retain the established basic flow.
  if(!automaticSpelling.has(kind))words[0].gameMaterials={[kind]:m};
  return {words,material:m};
}
export function demoAudioCues(kinds:GameKind[]) {
  const cues=new Map<string,{text:string;locale:'zh-CN'|'en-US'}>();
  for(const kind of kinds){const {words,material}=extendedDemo(kind);for(const c of [...words.map(w=>cue(w.term,'en-US')),...materialCues(material),...(kind==='cloze'?[cue(material.sentence!.join(' '),'en-US')]:[])])cues.set(c.locale+':'+c.text,c);}
  for(const [term,meaning] of Object.entries(names))for(const c of [cue(term,'en-US'),cue(`意思是，${meaning}。`)])cues.set(c.locale+':'+c.text,c);
  for(const text of Object.values(builtInGameInstructions))cues.set('zh-CN:'+text,cue(text));
  return [...cues.values()];
}
