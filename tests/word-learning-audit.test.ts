import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename,sep} from 'node:path';
import {auditWordLearning,writeWordLearningAudit} from '../scripts/audit-word-learning.ts';
import {now,word,fixture,encountered,saved} from './helpers/word-learning.ts';

function source(){
  const root=mkdtempSync(join(tmpdir(),'word-learning-audit-')),dir=join(root,'data');mkdirSync(dir);
  const d=fixture();encountered(d);saved(d);writeFileSync(join(dir,'approved-original.png'),'original-approved-image');
  mkdirSync(join(dir,'practice-recordings'));writeFileSync(join(dir,'practice-recordings','private.wav'),'private-audio-never-export');
  const db=new DatabaseSync(join(dir,'playroom.sqlite'));db.exec('CREATE TABLE documents(id INTEGER PRIMARY KEY,body TEXT NOT NULL)');db.prepare('INSERT INTO documents VALUES(1,?)').run(JSON.stringify(d));db.close();
  return {root,dir,close(){const target=realpathSync(root),temp=realpathSync(tmpdir());assert.ok(target.startsWith(temp+sep)&&basename(target).startsWith('word-learning-audit-'));rmSync(target,{recursive:true,force:true});}};
}
test('read-only auditing preserves the source database and private media and reports target reasons',()=>{
  const s=source();try{const dbBefore=readFileSync(join(s.dir,'playroom.sqlite')),audioBefore=readFileSync(join(s.dir,'practice-recordings','private.wav')),report=auditWordLearning(s.dir,now);
    assert.equal(report.sourceUnchanged,true);assert.equal(report.media.referencedImages,1);assert.equal(report.media.mediaAndPrivateFiles,2);assert.equal(report.media.missingImages,0);assert.equal(report.counts.words,1);assert.ok(report.differences.some(row=>row.wordId===word.id));assert.equal(report.continuity[0].sessionId,'learning');assert.deepEqual(readFileSync(join(s.dir,'playroom.sqlite')),dbBefore);assert.deepEqual(readFileSync(join(s.dir,'practice-recordings','private.wav')),audioBefore);assert.ok(!JSON.stringify(report).includes('private-audio-never-export'));
  }finally{s.close();}
});
test('audit reports can only create a new explicit JSON outside the source',()=>{
  const s=source();try{const out=join(s.root,'reports','first.json');writeWordLearningAudit(s.dir,out,now);const first=readFileSync(out);assert.throws(()=>writeWordLearningAudit(s.dir,out,now),/已存在/);assert.deepEqual(readFileSync(out),first);assert.throws(()=>writeWordLearningAudit(s.dir,join(s.dir,'bad.json'),now),/来源目录外/);assert.equal(existsSync(join(s.dir,'bad.json')),false);assert.throws(()=>auditWordLearning('relative-data',now),/绝对路径/);
  }finally{s.close();}
});
test('a junction back to the source cannot bypass the report-only write boundary',()=>{
  const s=source();try{const link=join(s.root,'alias');symlinkSync(s.dir,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>writeWordLearningAudit(s.dir,join(link,'nested','bad.json'),now),/来源目录外/);assert.equal(existsSync(join(s.dir,'nested','bad.json')),false);
  }finally{s.close();}
});
test('missing referenced images are reported honestly and not replaced or generated',()=>{
  const s=source();try{rmSync(join(s.dir,'approved-original.png'));const report=auditWordLearning(s.dir,now);assert.equal(report.integrity.sourceHasMissingImages,true);assert.equal(report.media.missingImages,1);assert.equal(report.sourceUnchanged,true);assert.equal(existsSync(join(s.dir,'approved-original.png')),false);
  }finally{s.close();}
});
