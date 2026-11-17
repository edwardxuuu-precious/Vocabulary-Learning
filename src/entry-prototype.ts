import {createEntryPrototype,prototypeScenarios,prototypeContent,prototypePools,prototypeLanding,prototypeSession,prototypeCurrent,prototypeTransition,prototypeStorageKey,restoreEntryPrototype,type PrototypeAction,type PrototypeScenario} from '../shared/entry-prototype.ts';
import {visualTheme} from '../shared/visual-theme';
import {learningBackgrounds} from '../shared/learning-backgrounds';
import entryHomeCSS from './entry-home.css?inline';

const themeStyle=document.createElement('style');
themeStyle.textContent=entryHomeCSS+`
:root{color:#2e466c;background:#f5f8ff;--green:#5868dc;--purple:#5868dc;--line:#dbe4f2;--muted:#7b8ba5}
body{background:linear-gradient(155deg,#edf4ffed,#fffaf2ed),url('${learningBackgrounds[0].image}') center/cover fixed;color:#2e466c}
body:has(.entry-home)>header,body:has(.entry-home)>.prototype-footer{display:none}
#prototype-view:has(.entry-home){max-width:none;padding:0;margin:0;min-height:0}
.entry-home{min-height:calc(100svh - 89px)}.entry-home .entry-hall-header{padding:0;margin:0;max-width:none}.entry-home .entry-hall-modules-demo{grid-template-rows:minmax(390px,auto)}.entry-home .entry-hall-modules-demo .entry-hall-learn{grid-row:auto}
.entry-home .quiet-group{margin:20px 0 0;border:0;padding:0}
.entry-home .quiet-group h2{display:none}.entry-home .link-button{color:#2f597c;background:#ffffffe6;border-radius:12px;padding:10px 15px}
.brand{color:#29435b}.robot{display:none}.prototype-insignia{width:32px;height:36px;color:#477e9c}
.hero .hero-art,.landing-symbol{display:block;filter:none;transform:none}.prototype-companion{width:140px;height:160px;object-fit:contain;filter:drop-shadow(0 8px 6px #385c7a16)}
.hero-art .prototype-companion{width:115px;height:130px}.primary,.mode-learn .primary{background:#5868dc;box-shadow:0 4px 0 #4453b8}.secondary{background:#f1f4ff;color:#526bb4}
.landing-card,.activity-card,.break-card,.done-card{border-color:#dbe4f2;background:linear-gradient(120deg,#fff 45%,#f5f5ff);box-shadow:0 8px 24px #47638a08}
.eyebrow,.book,.word-en{color:#2e466c}.word-chip,.demo-cue{background:#f1f5fc;color:#7185a4}.picture{background:#f8faff}.choice{background:#f8faff;border-color:#dce5f2;box-shadow:0 4px 0 #dbe4f2}.progress-track{background:#e9edf7}.progress-track span{background:#8796dc}
@media(max-width:680px){.hero-art .prototype-companion{width:78px;height:96px}.landing-symbol{display:none}}
@media(max-width:519px){.entry-home .entry-hall-modules-demo{grid-template-rows:252px 196px}}
`;
document.head.append(themeStyle);
document.documentElement.dataset.visualTheme=visualTheme.id;
const companionArt=()=>`<img class="prototype-companion" src="${visualTheme.characters.bumblebee.image}" alt="${visualTheme.characters.bumblebee.name}，原有变形金刚伙伴">`;
const insignia='<svg class="prototype-insignia" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="m9 8 11-4 11 4 3 13-14 15L6 21Z" fill="currentColor"/><path d="m12 15 6 3v4l-6-2Zm16 0-6 3v4l6-2ZM17 27h6" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>';
document.querySelector('header .brand')!.innerHTML=insignia+'单词游乐园';

const $=(id:string)=>document.getElementById(id)!;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
let storageAvailable=true;
let demoEnabled=false;
let state=createEntryPrototype();
try{state=restoreEntryPrototype(localStorage.getItem(prototypeStorageKey))??state;}catch{storageAvailable=false;}
const b=(label:string,type:string,kind='primary',attrs:Record<string,string>={})=>`<button class="${kind}" data-type="${type}" ${Object.entries(attrs).map(([key,value])=>`data-${key}="${esc(value)}"`).join(' ')}>${label}</button>`;
const open=(entry:'learn'|'review',label:string,kind='primary',packId?:string)=>b(label,'open',kind,{entry,...(packId?{pack:packId}:{})});
const chips=(words:{id:string}[])=>`<div class="mini-words">${words.map(word=>{const target=prototypeContent(state.scenario).words.find(item=>item.id===word.id)!;return `<div class="word-chip"><span>${target.symbol}</span>${esc(target.meaning)}</div>`;}).join('')}</div>`;
const title=()=>state.entry==='learn'?'学习':'复习';
function home(){
  const legacy=demoEnabled?state.sessions.filter(session=>session.intent==='legacy'&&session.status!=='completed'):[];
  return `<section class="entry-home page-enter" style="--entry-base-scene:url('${visualTheme.homeDesktop}')"><div class="entry-hall">
    <header class="entry-hall-header"><h1 class="entry-hall-brand"><img src="${visualTheme.brandIcon}" width="36" height="36" alt=""><span>单词游乐园</span></h1><button class="entry-hall-parent" data-type="preview-tools" aria-label="家长入口，查看原型说明">家长空间</button></header>
    <section class="entry-hall-welcome" aria-label="机甲学习大厅"><div><h2>今天，一起出发吧</h2><p>认识新词，也记住老朋友。</p></div></section>
    <nav class="entry-hall-modules entry-hall-modules-demo" aria-label="选择学习或复习">
      <button class="entry-hall-module entry-hall-learn" data-type="open" data-entry="learn" aria-label="进入学习，学习新词"><span class="entry-hall-title">学习</span><span class="entry-hall-description">认识新单词</span><span class="entry-hall-detail">先认识，再一起玩</span><img class="entry-hall-character" src="${visualTheme.characters.optimus.image}" alt=""><span class="entry-hall-go">进入学习<span aria-hidden="true">→</span></span></button>
      <button class="entry-hall-module entry-hall-review" data-type="open" data-entry="review" aria-label="进入复习，复习已经学过的词"><span class="entry-hall-title">复习</span><span class="entry-hall-description">把学过的词再想一想</span><img class="entry-hall-character" src="${visualTheme.characters.megatron.image}" alt=""><span class="entry-hall-go">进入复习<span aria-hidden="true">→</span></span></button>
    </nav>${legacy.length?`<div class="quiet-group"><h2>以前留下的进度</h2>${legacy.map(session=>b('继续以前的综合练习','legacy','link-button',{id:session.id})).join('')}</div>`:''}
  </div></section>`;
}
function books(){
  const content=prototypeContent(state.scenario),pools=prototypePools(state);
  return `<details class="book-section"><summary>按词书挑选</summary><div class="book-grid">${content.packs.filter(pack=>pack.enabled).map(pack=>{
    const ready=pools.ready.filter(word=>word.packId===pack.id),learned=pools.review.filter(word=>word.packId===pack.id).length;
    return open(state.entry,`<strong>📚 ${esc(pack.title)}</strong><span>已学 ${learned} 个 · 未学 ${ready.length-learned} 个</span>`,'book',pack.id);
  }).join('')}</div>${state.packId?open(state.entry,'回到推荐','link-button'):''}</details>`;
}
function landing(){
  const {pools,resume,candidates,all,issue}=prototypeLanding(state),learning=state.entry==='learn';
  const pack=prototypeContent(state.scenario).packs.find(pack=>pack.id===state.packId);
  let card='';
  if(resume){card=`<div class="landing-card"><div><span class="pill">上次的进度还在</span><h2>${issue?'词语有更新，需要先确认':`继续${learning?'认识新朋友':'复习老朋友'}`}</h2><p>${issue?'保留原来的位置，不偷偷换词。请家长确认后再继续。':`已经走到第 ${Math.min(resume.cursor+1,resume.items.length)} / ${resume.items.length} 步，接着原来的小段。`}</p>${chips(resume.words)}${b(issue?'查看需要确认的进度':`继续${title()}`,'start')}<div class="soft-note">${pack?esc(pack.title):'本入口推荐'} · 另一入口的进度独立保留</div></div><div class="landing-symbol">${learning?'📖':'🌿'}</div></div>`;}
  else if(candidates.length){card=`<div class="landing-card"><div><span class="pill">${pack?'自己选的额外练习':learning?'下一组新朋友':'今天再想一想'}</span><h2>${learning?`认识 ${candidates.length} 个新朋友`:`复习 ${candidates.length} 个老朋友`}</h2><p>${learning?'先认识声音和意思，穿插练习，再自己想一想。':'先自己试一试，需要时再点帮助。'}${pack?' 只用这本书里的词。':''}</p>${chips(candidates)}${b(learning?'开始学习':'开始复习','start')}<div class="soft-note">${pack?esc(pack.title):'推荐小段'} · 可以随时保存休息${pack?' · 额外练习不改变正式到期日期':''}</div></div><div class="landing-symbol">${learning?'🌼':'🍃'}</div></div>`;}
  else{
    const noContent=!pools.ready.length,noLearned=!learning&&!pools.review.length;
    const heading=noContent?'请家长准备好词语':noLearned?'先认识几个新朋友':learning?'暂时没有新词啦':state.packId?'这本书还没有学过的词':'今天的推荐复习完成啦';
    const description=noContent?'图片和声音准备好、家长交付后，再来开始。':noLearned||state.packId&&!all.length?'复习只和已经认识的词打招呼。去学习认识它们吧。':learning?'可以和学过的老朋友再见面。':'想多玩一会儿，可以按词书选老朋友；也可以去学习。';
    card=`<div class="landing-card empty" style="display:block"><div class="empty-symbol">${noContent?'🧺':learning?'🌻':'🌤️'}</div><h2>${heading}</h2><p>${description}</p>${noContent?b('回首页','home'):open(learning?'review':'learn',learning?'去复习':'去学习')}</div>`;
  }
  const unlearned=state.packId&&!learning?pools.learn.filter(word=>word.packId===state.packId).length:0;
  return `<div class="hero"><div><div class="eyebrow">${learning?'新词学习':'已学词复习'}${pack?' · '+esc(pack.title):''}</div><h1 tabindex="-1">${learning?'一起认识新朋友':'和老朋友再见面'}</h1><p>${learning?'先学明白，再慢慢记住。':'想起一点点，也是一种进步。'}</p></div></div>${card}
    ${unlearned?`<div class="soft-note">这本书还有 ${unlearned} 个未学词。${open('learn','去学习这些新词','link-button',state.packId)}</div>`:''}${books()}`;
}
function play(){
  const session=prototypeSession(state)!,item=prototypeCurrent(state)!;
  const answer=session.states[item.id]??{},learning=session.intent==='learn',origin=session.intent==='legacy'?'以前的综合练习':learning?'学习':'复习';
  const a=(label:string,action:string,kind='primary',choice?:string)=>b(label,'activity',kind,{action,session:session.id,item:item.id,...(choice?{choice}:{})});
  if(session.atBreak)return `<div class="break-card"><div class="big-symbol">🌳</div><h1 tabindex="-1">这一小段做完了</h1><p>进度已经记在这里。想休息就先停下，也可以继续下一小段。</p><div class="actions">${b('保存休息','pause')}${b('继续下一小段','continue-segment','secondary')}</div></div>`;
  let content='',controls='',feedback='';
  const picture=`<div class="picture" aria-label="${esc(item.word.meaning)}">${esc(item.word.symbol)}</div>`;
  if(item.step==='introduce'){
    content=`<h1 tabindex="-1">认识一个新朋友</h1>${picture}<div class="word-en">${esc(item.word.term)}</div><div class="word-cn">${esc(item.word.meaning)}</div><div class="demo-cue">${answer.heard?'已演示播放词语发音':'发音与短讲解位置'}</div>`;
    controls=`${a('听一听（演示）','listen','secondary')}${a('认识啦','choose')}`;
  }else if(item.step==='recognize'||item.step==='listen'){
    const choices=session.words.map(word=>prototypeContent(state.scenario).words.find(row=>row.id===word.id)!).filter(Boolean);
    content=`<h1 tabindex="-1">${item.step==='recognize'?'哪个是它？':'听一听，找一找'}</h1>${item.step==='recognize'?`<div class="word-en">${esc(item.word.term)}</div>`:a(answer.heard?'再听一次（演示）':'播放题干（演示）','listen','secondary')}
      ${item.step==='listen'&&answer.heard?`<div class="demo-cue">发音占位演示：${esc(item.word.term)}</div>`:''}
      ${answer.hinted?`<div class="word-cn">${esc(item.word.meaning)} ${esc(item.word.symbol)}</div>`:''}`;
    if(choices.length<2){content+='<p class="muted">这一组词太少，这次先跳过选择题。</p>';controls=a('这题先跳过','skip');}
    else content+=`<div class="choice-row">${choices.map(word=>a(`<span aria-hidden="true">${word.symbol}</span><span style="font-size:0">${esc(word.meaning)}</span>`,'choose','choice',word.id).replace('class="choice"',`class="choice" aria-label="选择${esc(word.meaning)}"${item.step==='listen'&&!answer.heard||answer.feedback||answer.device?' disabled':''}`)).join('')}</div>`;
    if(answer.wrong&&!answer.feedback)feedback=`<div class="feedback warn">${answer.wrong>1?'可以点下面的帮助，一起看看。':'再想一想，也可以点帮助。'}</div>`;
  }else{
    const target=item.step==='read'?`<div class="word-en" style="margin:45px 0">${esc(item.word.term)}</div>`
      :`${picture}<div class="word-cn">${esc(item.word.meaning)}</div>${answer.hinted?`<div class="word-en">${esc(item.word.term)}</div>`:''}`;
    content=`<h1 tabindex="-1">${item.step==='read'?'试着读出这个词':'看图，想一想英文'}</h1>${target}`;
    if(answer.oral==='recording'){content+='<div class="record-light">录音界面演示中 · 没有采集声音</div>';controls=a('演示“说完了”','finish-recording');}
    else controls=a('演示“开始录音”','record');
    controls+=a('听示范（演示）','listen','secondary');
  }
  if(answer.device){content+=`<div class="demo-cue" role="status">${answer.device==='audio'?'声音暂时没播出来':'麦克风暂时不可用'}。可以重试，也可以先跳过；这不算答错。</div>`;controls=a('重试（演示）','retry')+a('这题先跳过','skip','secondary');}
  if(answer.feedback){controls=a('继续','next');feedback=`<div class="feedback">${answer.feedback==='correct'?'这次选对啦！':answer.feedback==='helped'?'借助帮助，也走完这一步啦。':answer.feedback==='skipped'?'这次先跳过，进度会保留。':item.step==='introduce'?'认识过啦，再试一试。':'已演示保存步骤；没有录音或正式成绩。'}</div>`;}
  const help=!answer.feedback&&!answer.device&&item.step!=='introduce'?`<div class="help-row">${a(item.step==='read'||item.step==='recall'?'给我一点帮助':'帮帮我','help','link-button')}${a('这次先不做','skip','link-button')}</div>`:'';
  const total=session.items.length,segmentStart=session.checkpoint&&session.cursor>=session.checkpoint?session.checkpoint:0,segmentEnd=segmentStart?total:session.checkpoint??total;
  return `<div class="activity-nav">${b('‹ 返回并保存','pause','link-button')}<span>${origin}</span><span class="step-label">本小段 ${session.cursor-segmentStart+1} / ${segmentEnd-segmentStart} 步</span></div><div class="progress-track" aria-label="当前小段进度"><span style="width:${(session.cursor-segmentStart)/(segmentEnd-segmentStart)*100}%"></span></div><div class="activity-card">${content}<div class="activity-bottom">${feedback}<div class="actions">${controls}</div>${help}</div></div><p class="foot-hint">${b('先休息，保存进度','pause','link-button')}</p>`;
}
function done(){
  const session=prototypeSession(state)!,help=Object.values(session.states).filter(answer=>answer.hinted||answer.feedback==='helped').length,skipped=Object.values(session.states).filter(answer=>answer.feedback==='skipped').length;
  return `<div class="done-card"><div class="big-symbol">🌟</div><h1 tabindex="-1">${session.intent==='learn'?'这组新朋友认识过啦':session.intent==='legacy'?'以前的小段完成啦':'这组老朋友复习过啦'}</h1><p>你走完了这次小段。下次再见面，慢慢想起来。</p><div class="done-detail"><span>${session.words.length} 个词参与练习</span>${help?`<span>${help} 步用过帮助</span>`:''}${skipped?`<span>${skipped} 步先跳过</span>`:''}</div>${session.intent==='legacy'?b('完成，回首页','home'):open(session.intent,`完成，回${session.intent==='learn'?'学习':'复习'}`,'primary',session.packId)}<div class="soft-note">练过不等于记牢；原型不产生正式成绩。</div></div>`;
}
function render(){
  $('prototype-view').className=`mode-${state.entry}`;
  $('prototype-view').innerHTML=(!demoEnabled||state.screen==='home'?home():state.screen==='landing'?landing():state.screen==='play'?play():state.screen==='done'?done():`<div class="done-card"><div class="big-symbol">${companionArt()}</div><h1 tabindex="-1">词语更新了，先找家长确认</h1><p>原来的范围和位置都保留着。这次不偷偷换词，也不记作已经完成。</p>${open(state.entry,`回${title()}`)}</div>`)
    .replace(/<div class="landing-symbol">[^<]*<\/div>/g,`<div class="landing-symbol">${companionArt()}</div>`)
    .replace(/<div class="big-symbol">[^<]*<\/div>/g,`<div class="big-symbol">${companionArt()}</div>`);
  const select=$('scenario') as HTMLSelectElement;select.value=state.scenario;
  select.disabled=!demoEnabled;($('reset-preview') as HTMLButtonElement).disabled=!demoEnabled;
  $('preview-summary').innerHTML=`<table><thead><tr><th>来源</th><th>范围</th><th>位置</th><th>状态</th></tr></thead><tbody>${state.sessions.map(session=>`<tr><td>${session.intent==='legacy'?'旧综合':session.intent==='learn'?'学习':'复习'} · ${session.source==='book'?'按书':'推荐/旧计划'}</td><td>${session.words.map(word=>esc(word.term)).join('、')}</td><td>${session.cursor}/${session.items.length}${session.atBreak?' · 小段保存处':''}</td><td>${{active:'正在预演',paused:'已保存休息',completed:'已演示完成'}[session.status]}</td></tr>`).join('')||'<tr><td colspan="4">尚未开始；打开入口不创建轮次。</td></tr>'}</tbody></table>`;
  $('storage-warning').innerHTML=storageAvailable?'':'<div class="storage-warning">本页暂存不可用；可以继续预演，刷新后可能丢失本原型进度。</div>';
}
function save(){try{localStorage.setItem(prototypeStorageKey,JSON.stringify(state));}catch{storageAvailable=false;}}
function act(action:PrototypeAction){
  if(!demoEnabled&&action.type==='open'){location.assign(`http://127.0.0.1:8787/#${action.entry}`);return;}
  state=prototypeTransition(state,action);save();render();
}
$('enable-demo').addEventListener('change',()=>{demoEnabled=($('enable-demo') as HTMLInputElement).checked;render();});
$('scenario').innerHTML=Object.entries(prototypeScenarios).map(([id,name])=>`<option value="${id}">${name}</option>`).join('');
$('scenario').addEventListener('change',()=>{state=createEntryPrototype(($('scenario') as HTMLSelectElement).value as PrototypeScenario);save();render();});
$('reset-preview').addEventListener('click',()=>{state=createEntryPrototype(state.scenario);save();render();});
document.addEventListener('click',event=>{
  const element=(event.target as Element).closest<HTMLButtonElement>('button[data-type]');if(!element||element.disabled)return;
  const data=element.dataset;
  if(data.type==='preview-tools'){const tools=document.querySelector<HTMLDetailsElement>('.review-tools')!;tools.open=true;tools.scrollIntoView({block:'start'});return;}
  if(data.type==='open')act({type:'open',entry:data.entry as 'learn'|'review',packId:data.pack});
  else if(data.type==='activity')act({type:'activity',sessionId:data.session!,itemId:data.item!,action:data.action as Extract<PrototypeAction,{type:'activity'}>['action'],choice:data.choice});
  else if(data.type==='legacy')act({type:'legacy',id:data.id!});
  else if(['home','pause','start','continue-segment'].includes(data.type!))act({type:data.type} as PrototypeAction);
});
render();
