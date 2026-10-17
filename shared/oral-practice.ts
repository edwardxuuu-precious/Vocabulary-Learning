import { spokenKinds } from './game-materials.ts';
import type { LearningActivity, PracticeRecording } from './contracts.ts';

/** These prompts ask for speech. Drawing, gestures and sound recognition do not. */
export function oralActivity(a: LearningActivity) {
  return spokenKinds.has(a.kind)||a.kind==='portal'||a.kind==='missing'||a.kind==='think-choice'||a.kind==='associate'&&a.step==='recall'||a.kind==='standard'&&['recall','practice-zh-en','practice-read'].includes(a.step);
}
export function validPracticeRecordings(value: unknown): value is PracticeRecording[] {
  return Array.isArray(value)&&value.length<=100000&&new Set(value.map(r=>r?.id)).size===value.length&&value.every(r=>
    r&&/^[a-f0-9-]{36}$/.test(r.id)&&typeof r.sessionId==='string'&&r.sessionId.length<=120&&typeof r.activityId==='string'&&r.activityId.length<=120&&
    r.word&&typeof r.word.id==='string'&&typeof r.word.term==='string'&&r.word.term.length<=100&&typeof r.word.meaning==='string'&&r.word.meaning.length<=200&&Number.isInteger(r.word.learningVersion??0)&&(r.word.learningVersion??0)>=0&&
    oralActivity(r)&&['recall','follow'].includes(r.mode)&&Number.isInteger(r.round)&&r.round>=1&&r.round<=3&&typeof r.createdAt==='string'&&Number.isFinite(Date.parse(r.createdAt))&&
    typeof r.seconds==='number'&&r.seconds>=.1&&r.seconds<=20&&Number.isInteger(r.bytes)&&r.bytes>=3244&&r.bytes<=640044&&/^[a-f0-9]{64}$/.test(r.sha256)&&['ready','missing'].includes(r.status));
}
