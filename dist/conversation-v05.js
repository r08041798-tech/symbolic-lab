// Conversation adapter. Original TypeScript skill engine remains authoritative for explicit skills.
import {respond} from './chat.js';
import {quickReply,inspectOutput} from './guards-v04.js';
import {profileFor,limitHistory} from './performance-v05.js';
const LIMIT=6000;
let worker=null,activeMode='',seq=0,idleTimer=null;
const cancelIdle=()=>{if(idleTimer!==null)clearTimeout(idleTimer);idleTimer=null;};
export function resetModel(){cancelIdle();if(worker)worker.terminate();worker=null;activeMode='';}
export function releaseModel(){resetModel();}
export function buildMessages(history,state,q,profile=profileFor('compact',false)){
 const facts=Object.entries(state.facts||{}).slice(0,6).map(([k,v])=>k+': '+v).join('\n').slice(0,profile.context<2000?300:900);
 const system="You are Modular AI. Answer the latest message briefly and clearly. Ask one question if unclear. Do not repeat or invent facts. Admit uncertainty. "+(state.name?'User name: '+state.name+'. ':'')+(facts?'User notes:\n'+facts:'');
 return [{role:'system',content:system},...limitHistory(history,q,profile),{role:'user',content:q}];
}
export function isSkill(q,state){
 const t=q.trim();
 return /^(?:my name is|call me|remember(?: that)?|recall)\s+/i.test(t)||/^(?:what(?: is|'s) my name|do you remember my name)\??$/i.test(t)||(/^(?:what is|what's)\s+(.+?)\??$/i.test(t)&&Object.hasOwn(state.facts||{},t.match(/^(?:what is|what's)\s+(.+?)\??$/i)[1].toLowerCase()))||/^(?:calculate|compute|convert|summari[sz]e)\b/i.test(t)||/^(?:what is\s+|how much is\s+)?[\d(][\d.()+*/%×÷^\s-]*(?:\b(?:plus|minus|multiplied by|divided by)\b[\d.\s-]+)?\??$/i.test(t)||/^(?:now |then )?(?:multiply|divide|add|subtract)(?: it| that)?\s+(?:by |to |from )?-?\d+(?:\.\d+)?\??$/i.test(t);
}

export async function chat(engine,state,history,q,mode,progress,token,signal,mobile=false){
 if(signal?.aborted)throw Error('Stopped');
 const quick=quickReply(q,state,history);
 if(quick!==null)return {answer:quick,detail:'Local conversation router',verified:'Direct response'};
 if(mode==='original'||isSkill(q,state))return respond(engine,state,q);
 const profile=profileFor(mode,mobile);
 if(q.length>Math.min(LIMIT,profile.context))throw Error('This mode supports messages up to '+profile.context+' characters. Try a shorter message or a larger mode.');
 cancelIdle();
 if(activeMode!==mode){resetModel();activeMode=mode;}
 worker ||= new Worker(new URL('./language-worker-v05.js',import.meta.url),{type:'module'});
 const id=++seq;
 return new Promise((resolve,reject)=>{
  const w=worker;let timer,settled=false,buffer='',generating=false;
  const cleanup=()=>{clearTimeout(timer);w.removeEventListener('message',onMessage);w.removeEventListener('error',onError);signal?.removeEventListener('abort',onAbort);};
  const finish=(text,detail,terminate=false)=>{if(settled)return;settled=true;cleanup();if(terminate)resetModel();else idleTimer=setTimeout(resetModel,profile.idle);resolve({answer:text.trim()||'I could not generate a useful reply. Please try a shorter question.',detail,verified:'Generated text — not independently verified'});};
  const fail=(message)=>{if(settled)return;settled=true;cleanup();resetModel();reject(Error(message));};
  const onAbort=()=>finish(buffer||'Stopped.', 'Stopped by user',true);
  const onError=e=>fail(e.message||'Local model worker failed.');
  const onMessage=({data})=>{if(data.id!==id||settled)return;
   if(data.type==='status')progress(data.text);
   if(data.type==='generating'){generating=true;clearTimeout(timer);timer=setTimeout(()=>finish(buffer||'This device is taking too long to generate a reply. Try a shorter question or Original mode.','Generation time limit reached',true),profile.timeout);progress(data.text);}
   if(data.type==='token'){buffer+=data.text;token(data.text);}
   if(data.type==='guard'){finish(data.text,'Repetition or output limit reached',true);return;}
   if(data.type==='done'){const next=inspectOutput(data.text);finish(next.text,'Local language model · '+data.model);}
   if(data.type==='error')fail(data.text);
  };
  timer=setTimeout(()=>fail('Model loading timed out. Check your connection, or use Original mode.'),180000);
  w.addEventListener('message',onMessage);w.addEventListener('error',onError);signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted){onAbort();return;}
  w.postMessage({id,mode,profile,messages:buildMessages(history,state,q,profile)});
 });
}
