import path from 'node:path';
import { Store } from '../server/store.ts';
const directory = path.resolve(process.argv[2] ?? '');
if (!directory.startsWith(path.resolve('artifacts') + path.sep) || !path.basename(directory).startsWith('challenge-qa-')) throw Error('只接受隔离挑战验收目录');
let days = -2;
const store = new Store(path.join(directory, 'data'), () => new Date(Date.now() + days * 86400000));
try {
  const id = store.read().words[5].id;
  for (days = -2; days <= -1; days++) {
    let session = store.createAssessment({ wordIds: [id] });
    for (const item of session.items) session = store.assessmentAction(session.id, item.dimension === 'look' ? { itemId: item.id, action: 'choose', selectedId: item.word.id } : { itemId: item.id, action: 'judge', judgement: days === -1 && item.dimension === 'read' ? 'incorrect' : 'correct' });
  }
  console.log(JSON.stringify({ isolated: true, wordId: id, expectedDue: ['read'] }));
} finally { store.close(); }
