export interface SentenceDemonstrationState {
  phase:'idle'|'playing'|'gap'|'saving'|'ready'|'audio-error'|'save-error';
  round:number;
  completed:number;
}
interface Runtime {
  play():Promise<boolean>;
  confirm():Promise<boolean>;
  stop():void;
  update(state:SentenceDemonstrationState):void;
  wait?:(ms:number,signal:AbortSignal)=>Promise<void>;
}
const wait=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{
  const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
  const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();
});

/** Two real, complete plays precede one demonstration fact. Cancellation never counts as a play. */
export class SentenceDemonstrationController {
  state:SentenceDemonstrationState={phase:'idle',round:0,completed:0};
  private owner?:AbortController;
  constructor(private readonly runtime:Runtime){}
  private update(patch:Partial<SentenceDemonstrationState>){this.state={...this.state,...patch};this.runtime.update(this.state);}
  cancel(){this.owner?.abort();this.owner=undefined;this.runtime.stop();}
  async start(){
    if(this.owner||this.state.phase==='ready')return;
    const owner=new AbortController();this.owner=owner;
    const current=()=>this.owner===owner&&!owner.signal.aborted;
    try{
      // A failed save can be retried without falsely replaying or recounting audio.
      if(this.state.phase!=='save-error'){
        this.update({phase:'playing',round:1,completed:0});
        for(let round=1;round<=2;round++){
          this.update({phase:'playing',round});
          const heard=await this.runtime.play();
          if(!current())return;
          if(!heard){this.update({phase:'audio-error'});return;}
          this.update({completed:round});
          if(round===1){this.update({phase:'gap'});await (this.runtime.wait??wait)(650,owner.signal);if(!current())return;}
        }
      }
      if(!current())return;
      this.update({phase:'saving'});
      const saved=await this.runtime.confirm();
      if(current())this.update({phase:saved?'ready':'save-error'});
    }catch{
      if(current())this.update({phase:this.state.completed===2?'save-error':'audio-error'});
    }finally{if(this.owner===owner)this.owner=undefined;}
  }
}
