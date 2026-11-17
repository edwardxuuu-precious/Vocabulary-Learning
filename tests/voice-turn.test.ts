import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceTurnEnd} from '../src/voice-turn.ts';

test('an empty or isolated noisy frame does not count as a spoken turn',()=>{
  const turn=new VoiceTurnEnd(0);
  assert.equal(turn.observe(.1,100).heard,false);
  assert.equal(turn.observe(0,150).ended,false);
  const result=turn.observe(0,10000);
  assert.equal(result.ended,true);assert.equal(result.heard,false);
});
test('a short thinking pause stays open and a later sound restarts the silence window',()=>{
  const turn=new VoiceTurnEnd(0);
  turn.observe(.1,100);assert.equal(turn.observe(.1,150).heard,true);
  assert.equal(turn.observe(0,1500).ended,false);
  turn.observe(.1,1600);
  assert.equal(turn.observe(0,3399).ended,false);
  assert.equal(turn.observe(0,3400).ended,true);
});
test('continuous noise is bounded and meter values are volume only',()=>{
  const turn=new VoiceTurnEnd(0);
  assert.equal(turn.observe(.2,100).level,1);
  assert.equal(turn.observe(.2,20000).ended,true);
});
