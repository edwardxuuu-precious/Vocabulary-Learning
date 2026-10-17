import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { gameRegistry,seededRandom } from '../shared/game-registry.ts';
import { buildActivities } from '../shared/game-plan.ts';
import { extendedDemo } from '../scripts/game-material-fixtures.ts';
import type { LearningSession,LearningTask } from '../shared/contracts.ts';

test('all 30 new React game screens render both empty and resumed checkpoints, including material-free spelling',async()=>{
  const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
  try{const {ExtendedLearningGame}=await vite.ssrLoadModule('/src/extended-games.tsx');
    for(const def of gameRegistry.filter(g=>g.batch)){
      const {words}=extendedDemo(def.kind),tasks=words.map(w=>({wordId:w.id,mode:'new',steps:['learn','listen','sound','recall','spell']} as LearningTask)),activities=buildActivities(tasks,words,seededRandom(def.kind),{forcedKind:def.kind,allowedKinds:[def.kind],familyEnabled:true,contextEnabled:true}),activity=activities.find(a=>a.kind===def.kind)!;
      assert.ok(activity,def.kind);const session:LearningSession={id:'render-test',wordIds:words.map(w=>w.id),completedWordIds:[],startedAt:'2026-10-17T05:00:00Z',rewardGranted:false,tasks,activities,activityStates:{},completedSteps:{}};
      for(const checkpoint of [{},{heard:true}]){session.activityStates![activity.id]=checkpoint;const html=renderToStaticMarkup(createElement(ExtendedLearningGame,{activity,session,busy:false,playing:false,onAction(){},onHome(){},onPause(){},stopAudio(){}}));assert.ok(html.includes(def.title),def.kind);assert.ok(html.includes('学习导航'));if(def.kind==='dictation'){assert.ok(!html.includes(activity.word.imageUrl));assert.ok(!html.includes(`>${activity.word.term}<`));}}
    }
  }finally{await vite.close();}
});
