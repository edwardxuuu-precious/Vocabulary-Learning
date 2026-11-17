import type {DatabaseSync} from 'node:sqlite';
import {screenRestMs,screenUseLimitMs,type ScreenTimeStatus} from '../shared/screen-time.ts';

interface Usage {usedMs:number;accountedAt:number;clients:Record<string,number>;idleSince?:number;breakUntil?:number}
const leaseMs=15_000;

/** Kept outside learning backups: refresh, restore and server restart cannot clear a rest. */
export class ScreenTime {
  constructor(private db:DatabaseSync,private clock:()=>Date) {
    db.exec('CREATE TABLE IF NOT EXISTS screen_time (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
  }
  private read(now:number):Usage {
    const row=this.db.prepare('SELECT body FROM screen_time WHERE id=1').get() as {body:string}|undefined;
    return row?JSON.parse(row.body):{usedMs:0,accountedAt:now,clients:{},idleSince:now};
  }
  private settle(data:Usage,now:number) {
    now=Math.max(now,data.accountedAt);
    if(data.breakUntil!==undefined) {
      if(now<data.breakUntil){data.clients={};data.accountedAt=now;return data;}
      return {usedMs:0,accountedAt:now,clients:{},idleSince:now};
    }
    const through=Math.max(data.accountedAt,...Object.values(data.clients));
    const elapsed=Math.max(0,Math.min(now,through)-data.accountedAt);
    if(data.usedMs+elapsed>=screenUseLimitMs) {
      const started=data.accountedAt+screenUseLimitMs-data.usedMs;
      if(now>=started+screenRestMs)return {usedMs:0,accountedAt:now,clients:{},idleSince:now};
      return {usedMs:screenUseLimitMs,accountedAt:now,clients:{},breakUntil:started+screenRestMs};
    }
    data.usedMs+=elapsed;
    data.clients=Object.fromEntries(Object.entries(data.clients).filter(([,until])=>until>now));
    if(!Object.keys(data.clients).length)data.idleSince??=Math.min(now,through);
    if(data.idleSince!==undefined&&now-data.idleSince>=screenRestMs)data.usedMs=0;
    data.accountedAt=now;
    return data;
  }
  private status(data:Usage,now:number):ScreenTimeStatus {
    return {serverNow:new Date(now).toISOString(),usedMs:data.usedMs,limitMs:screenUseLimitMs,restMs:screenRestMs,
      ...(data.breakUntil!==undefined?{breakUntil:new Date(data.breakUntil).toISOString()}:{})};
  }
  view() {const now=this.clock().getTime();return this.status(this.settle(this.read(now),now),now);}
  heartbeat(clientId:string,active:boolean) {
    return this.update((data,now)=>{
      if(data.breakUntil!==undefined)return;
      if(active){data.clients[clientId]=now+leaseMs;delete data.idleSince;}
      else {delete data.clients[clientId];if(!Object.keys(data.clients).length)data.idleSince=now;}
      for(const [id] of Object.entries(data.clients).sort((a,b)=>b[1]-a[1]).slice(32))delete data.clients[id];
    });
  }
  unlock() {return this.update((data,now)=>{data.usedMs=0;data.clients={};data.accountedAt=now;data.idleSince=now;delete data.breakUntil;});}
  private update(action:(data:Usage,now:number)=>void) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now=this.clock().getTime(),data=this.settle(this.read(now),now);action(data,now);
      this.db.prepare('INSERT INTO screen_time(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(data));
      this.db.exec('COMMIT');return this.status(data,now);
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
