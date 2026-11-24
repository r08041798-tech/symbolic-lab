import * as query from './query-v07.js';
import {parseIntent} from './indexed-v06.js';
import {rankModels,recordOutcome,classifyTask,topicOf,validateExtraction,normalize,deviceTier} from './routing-v09.js';
import * as vault from './vault-v09.js';
const STATS='modular-ai-routing-v09';let teacher;
const readStats=()=>{try{return JSON.parse(localStorage.getItem(STATS)||'{}')||{};}catch{return {};}};
const saveStats=s=>{try{localStorage.setItem(STATS,JSON.stringify(s));}catch{}};
const result=(answer,detail,verified,routing)=>({answer,detail,verified,...(routing?{routing}:{})});
const learned=(r,detail,routing)=>result(r.definition,'Learned index · '+r.id+' · '+detail,'UNVERIFIED model-derived definition · '+r.model+' · '+r.createdAt.slice(0,10)+'. Not a verified reasoning premise.',routing);
const miss=r=>r?.detail?.startsWith('No confident indexed route');
export async function routeRequest(deps,engine,state,history,q,mode,progress,token,signal,mobile,device){
 const emit=(label,detail)=>engine.onEvent?.({label,detail});
 const abort=()=>{if(signal?.aborted)throw Error('Stopped');};abort();
 const cmd=normalize(q);
 if(cmd==='show learned topics'||cmd==='list learned topics'){const rows=await deps.vault.list();return result(rows.length?rows.map(r=>r.id+' — '+r.model+' (unverified)').join('\n'):'No acquired concepts yet. Enable automatic routing and ask an unfamiliar general definition.','Learned knowledge · '+rows.length+' records','Unverified notes only.');}
 const topic=topicOf(q,deps.parseIntent);
 const local=await deps.local.chat(engine,state,history,topic&&/^learn\s*:/i.test(q)?'What is '+topic+'?':q,'indexed',progress,token,signal,mobile);abort();
 if(!miss(local)){emit('Local route','No generative model needed');return local;}
 if(topic){const hit=await deps.vault.lookup(topic);abort();if(hit){emit('Knowledge index hit',hit.id+' · no model');return learned(hit,'reused without model');}}
 if(mode==='indexed'||mode==='original')return local;
 const task=classifyTask(q,topic),stats=deps.readStats();
 const ranks=rankModels(task,device,stats);
 // Manual models still obey the device limit; automatic mode never retries another model in the same request.
 const ranked=mode==='auto'?ranks:ranks.filter(m=>m.id===mode);
 const routing={task,deviceTier:deviceTier(device),candidates:ranks.map(m=>({name:m.name,score:m.score,attempts:m.attempts,completed:m.completed})),selected:ranked[0]?.name||'None',note:'Scores are heuristic completion estimates, not factual confidence. Device tiers are conservative estimates, not measured free RAM.'};
 if(!ranked.length){emit('Budget guard','No allowed model for this device');return result('This device is outside the conservative model budget for that request. I did not load a language model. Use Query mode for supported tasks or a device with more memory.','Memory budget guard','Abstained rather than overloading the device.',routing);}
 const chosen=ranked[0];
 emit('Weighted model selected',chosen.name+' · score '+chosen.score.toFixed(3)+' · '+task);
 progress('Loading '+chosen.name+' only as needed…');
 let r;
 try{
 const prompt=topic?'Define '+JSON.stringify(topic)+' in one factual sentence. Return JSON only: {"definition":"complete sentence.","aliases":["synonym"]}. Use empty definition if uncertain.':q;
 r=await deps.infer(engine,topic?{facts:{}}:state,topic?[]:history,prompt,chosen.id,progress,topic?()=>{}:token,signal,mobile,!!topic);
 abort();
 }catch(e){
 if(signal?.aborted)throw e;
 deps.saveStats(recordOutcome(stats,chosen.id,task,false));
 return result('The selected model failed to load or complete the request. No second model was started. '+String(e.message||e),'Model failure · '+chosen.name,'No knowledge saved.',routing);
 }
 if(!r.detail?.startsWith('Local language model · ')){
 if(r.detail!=='Stopped by user')deps.saveStats(recordOutcome(stats,chosen.id,task,false));
 return {...r,routing};
 }
 if(!topic){deps.saveStats(recordOutcome(stats,chosen.id,task,true));return {...r,routing};}
 const record=validateExtraction(r.answer,topic,chosen.name,new Date().toISOString());
 deps.saveStats(recordOutcome(stats,chosen.id,task,!!record));
 if(!record){emit('Extraction rejected','Incomplete or invalid structured output');return result('The model did not return a valid complete definition record. Nothing was saved. A future request may select another eligible model based on the recorded outcome.','Extraction rejected','Schema check failed; no fact verified.',routing);}
 const saved=await deps.vault.save(record);abort();
 emit('Knowledge extraction',record.id+' · '+(saved.record?(saved.persistent?'saved to browser':'session only'):'storage full')+' · unverified');
 return learned(saved.record||record,saved.record?(saved.persistent?'saved to browser':'session only'):'not saved: storage full',routing);
}
async function infer(engine,state,history,prompt,mode,progress,token,signal,mobile,extract){
 teacher=await import('./conversation-v09.js');
 try{return await teacher.chat(engine,state,history,prompt,mode,progress,token,signal,mobile,{extract});}
 finally{teacher.releaseModel();}
}
export async function chat(engine,state,history,q,mode,progress,token,signal,mobile){
 const device={mobile,ram:typeof navigator!=='undefined'?Number(navigator.deviceMemory||0):0};
 return routeRequest({local:query,parseIntent,vault,readStats,saveStats,infer},engine,state,history,q,mode,progress,token,signal,mobile,device);
}
export async function releaseModel(){teacher?.releaseModel();await query.releaseModel();}
export async function clearLearned(){return vault.clear();}
