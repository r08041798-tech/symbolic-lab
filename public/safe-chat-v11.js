import * as previous from './sparse-chat-v10.js';
import {compile,resolve,clearEvidence} from './factual-v11.js';
import {createGovernor,permitNeural} from './governor-v11.js';
export const releaseModel=previous.releaseModel;
export async function clearLearned(){clearEvidence();return previous.clearLearned();}
const miss=r=>r?.detail?.startsWith('No confident indexed route');
export async function route(deps,engine,state,history,q,mode,progress,token,signal,mobile,settings){
 const emit=(label,detail)=>engine.onEvent?.({label,detail});
 const abort=()=>{if(signal?.aborted)throw Error('Stopped');};abort();
 const intent=compile(q);
 // Location, expansion and person-name queries must bypass all learned LLM notes.
 if(intent&&['location','expansion'].includes(intent.intent)||intent?.intent==='definition'&&/^(?:who|who's)\b/i.test(q.trim())){
 emit('Factual query',intent.intent+' · '+intent.entity);progress('Resolving public entity…');
 return deps.resolve(intent,{online:settings.online,signal});
 }
 const local=await deps.previous.chat(engine,state,history,q,'indexed',progress,token,signal,mobile);abort();
 // Do not promote unverified teacher definitions into factual answers.
 if(!miss(local)&&!/^Learned index\b/.test(local.detail||''))return local;
 if(intent&&intent.intent!=='unsupported'){
 emit('Factual query',intent.intent+' · '+intent.entity);progress('Looking up source evidence…');
 return deps.resolve(intent,{online:settings.online,signal});
 }
 if(!miss(local))return local;
 if(!permitNeural(mode,q,mobile,settings.neural)){
 emit('Resource guard',mobile?'Mobile neural execution disabled':'No eligible creative neural route');
 return {answer:mobile?'I do not have enough verified knowledge or a suitable local skill for that request. Neural inference is disabled on phones in this release to protect responsiveness.':'I do not have sufficient evidence or a supported skill for that request. I will not use a language model to guess a factual answer.',detail:'Safe abstention · no neural model',verified:'No model loaded.'};
 }
 const child=new AbortController();const forward=()=>child.abort();signal?.addEventListener('abort',forward,{once:true});if(signal?.aborted)forward();
 let reason='';
 const stop=deps.governor({signal:child.signal,onStop:r=>{reason=r;child.abort();emit('Resource governor',r);}});
 try{const out=await deps.previous.chat(engine,state,history,q,mode,progress,token,child.signal,false);
 if(reason)return {answer:reason+'. The neural task was stopped.',detail:'Resource governor',verified:'No result accepted.'};
 return out;
 }catch(e){if(reason)return {answer:reason+'. The neural task was stopped.',detail:'Resource governor',verified:'No result accepted.'};throw e;}
 finally{stop();signal?.removeEventListener('abort',forward);await deps.previous.releaseModel();}
}
export async function chat(engine,state,history,q,mode,progress,token,signal,mobile){
 const settings={online:!!document.getElementById('online-knowledge')?.checked,neural:!!document.getElementById('neural-optin')?.checked};
 return route({previous,resolve,governor:createGovernor},engine,state,history,q,mode,progress,token,signal,mobile,settings);
}
