import type { GameWord, LearningActivity } from './contracts.ts';

export const batchTwoKinds = new Set(['queue','collect','switch','peek','draw','mimic','associate','quiz','route','letter-path']);
export const pairedGame = (kind: string) => kind === 'queue' || kind === 'collect' || ['letter-sort','story','program','combine','quantity'].includes(kind);
export const soundChoiceGame = (a: LearningActivity) => a.kind === 'think-choice' || a.kind === 'peek' || a.kind === 'switch' && a.direction === 'picture-hear';
export const adjacentCell = (a: number, b: number, width = 5) => Math.abs(Math.floor(a / width) - Math.floor(b / width)) + Math.abs(a % width - b % width) === 1;
export const neighbours = (cell: number) => Array.from({length:25}, (_,index) => index).filter(index => adjacentCell(cell,index));
export function letterBoard(term: string, random: () => number) {
  const board = Array.from({length:25}, () => String.fromCharCode(97 + Math.floor(random()*26)));
  let path: number[] = [];
  const search = (cell: number): boolean => {
    path.push(cell); if (path.length === term.length) return true;
    const around = neighbours(cell);
    for(let i=around.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[around[i],around[j]]=[around[j],around[i]];}
    for (const next of around) if (!path.includes(next) && search(next)) return true;
    path.pop(); return false;
  };
  search(Math.floor(random()*25));
  for (const [index,cell] of path.entries()) board[cell] = term[index].toLowerCase();
  return board.join('');
}
export function findLetterPath(grid: string, term: string): number[] | undefined {
  const search = (path: number[]): number[] | undefined => {
    if(path.length === term.length) return path;
    const cells = path.length ? neighbours(path.at(-1)!) : Array.from({length:25},(_,i)=>i);
    for(const cell of cells) if(!path.includes(cell) && grid[cell] === term[path.length].toLowerCase()) { const result=search([...path,cell]); if(result)return result; }
  };
  return search([]);
}
export function sameWord(a: GameWord, b: GameWord) { return ['id','term','meaning','imageUrl','learningVersion'].every(key=>(a as any)[key]===(b as any)[key]); }
