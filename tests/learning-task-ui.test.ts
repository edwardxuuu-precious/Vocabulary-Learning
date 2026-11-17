import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {Store} from '../server/store.ts';

test('sound choices start disabled for presentation, never expose answer text, and have no draft confirmation',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'direct-sound-ui-')),store=new Store(dir),vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
  try{
    const {SoundChoice}=await vite.ssrLoadModule('/src/sound-choice.tsx'),options=store.read().words.slice(0,2),word=options[0];
    const render=(extra={})=>renderToStaticMarkup(createElement(SoundChoice,{word,options,busy:false,heardIds:[],audioUnavailable:false,outcome:null,practiceOnly:false,selectedId:'',onListen:async()=>true,onAnswer(){},onNext(){},onSkip(){},onStop(){},...extra}));
    const html=render();assert.equal((html.match(/aria-label="选声音\d" disabled=""/g)??[]).length,2);
    assert.ok(!html.includes('就选声音'));assert.ok(!html.includes('先听一个声音'));assert.ok(!html.includes('task-confirm'));assert.ok(html.includes('这题先跳过'));assert.ok(html.includes(word.imageUrl));
    const visible=html.replace(/<[^>]*>/g,'');for(const option of options)assert.ok(!visible.includes(option.term));
    const practice=render({outcome:'correct',practiceOnly:true,selectedId:word.id});assert.ok(!practice.includes('选对啦'));assert.ok(practice.includes('这步记好啦'));assert.ok(practice.includes('继续'));
    const unified=render({unified:true,outcome:'correct',practiceOnly:true,selectedId:word.id});assert.ok(unified.includes('is-chosen'));assert.ok(!unified.includes('is-correct'));assert.ok(!unified.includes('选对啦'));for(const option of options)assert.ok(!unified.replace(/<[^>]*>/g,'').includes(option.term));
  }finally{await vite.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('read task makes the word and recording control visible while keeping demonstration and answer picture gated',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'direct-reading-ui-')),store=new Store(dir),vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
  try{
    const {GoalGame}=await vite.ssrLoadModule('/src/goal-games.tsx'),word=store.read().words[0];
    const activity={id:word.id+':read',wordId:word.id,word,step:'read',kind:'portal',choices:[]};
    const session={id:'read-ui-test',wordIds:[word.id],completedWordIds:[],startedAt:new Date().toISOString(),rewardGranted:false,tasks:[{wordId:word.id,mode:'new',steps:['read']}],activities:[activity],activityStates:{}};
    const html=renderToStaticMarkup(createElement(GoalGame,{activity,session,busy:false,playing:false,onAction(){},onHome(){},onPause(){},stopAudio(){}}));
    assert.ok(html.includes('看英文，读一读'));assert.ok(html.includes('准备好，就读出来'));assert.ok(html.includes('task-action-row'));assert.ok(!html.includes('speaking-control-disc'));assert.ok(html.includes('learning-help-slot'));
    assert.ok(!html.includes('神秘传送门'));assert.ok(!html.includes('自己读的录音会保存在本机'));assert.ok(!html.includes(word.imageUrl));assert.ok(!html.includes('听示范，对比一下'));
  }finally{await vite.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
