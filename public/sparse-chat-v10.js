import * as auto from './auto-v09.js';
let worker=null;
export function releaseModel(){worker?.terminate();worker=null;return auto.releaseModel();}
export const clearLearned=auto.clearLearned;
export async function chat(engine,state,history,q,mode,progress,token,signal,mobile){
 if(mode!=='sparse')return auto.chat(engine,state,history,q,mode,progress,token,signal,mobile);
 if(signal?.aborted)throw Error('Stopped');
 const local=await auto.chat(engine,state,history,q,'indexed',progress,token,signal,mobile);
 if(!local.detail?.startsWith('No confident indexed route'))return local;
 if(signal?.aborted)throw Error('Stopped');
 const input=q.replace(/^continue\s*:\s*/i,'').trim();
 const fraction=Number(document.getElementById('sparse-budget')?.value||.65),maxTokens=mobile?4:8;
 const w=new Worker(new URL('./sparse-worker-v10.js',import.meta.url),{type:'module'});worker=w;
 return new Promise(resolve=>{
 let settled=false,last=null,timer;
 const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);w.terminate();if(worker===w)worker=null;};
 const end=(answer,detail,stats)=>{if(settled)return;settled=true;cleanup();resolve({answer,detail,verified:'Experimental pretrained story-model continuation; not a verified answer. No dense model fallback.',...(stats?{sparse:stats}:{})});};
 const abort=()=>end('Stopped.','Stopped by user',last);
 signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted){abort();return;}
 timer=setTimeout(()=>end('The sparse runtime exceeded its time limit. No dense fallback was loaded.','Sparse execution timed out',last),120000);
 w.onerror=e=>end('Sparse runtime error: '+e.message,'Sparse execution failed',last);
 w.onmessage=({data:d})=>{
 if(d.type==='progress'){last=d;progress(d.phase+' · '+(100*d.peak/d.total).toFixed(1)+'% peak retained weights');engine.onEvent?.({label:'Sparse weights',detail:d.phase+' · '+d.expertCalls+' expert executions · '+d.requests+' range requests'});}
 if(d.type==='error')end(d.error,'Sparse execution blocked',last);
 if(d.type==='done')end(d.text||'The model produced no ordinary text tokens.','Sparse neural execution · '+d.tokens+' generated tokens',d.stats);
 };
 progress('Opening partial checkpoint index…');w.postMessage({text:input,fraction,maxTokens});
 });
}
