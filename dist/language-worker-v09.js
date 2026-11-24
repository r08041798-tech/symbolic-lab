// Local inference only. Model selection is explicit; no remote inference API.
import {budgetFor} from './performance-v05.js';
import {inspectOutput} from './guards-v04.js';
const MODELS={lite:{id:'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',dtype:'q8',name:'SmolLM2 135M'},compact:{id:'HuggingFaceTB/SmolLM2-360M-Instruct',dtype:'q4',name:'SmolLM2 360M'},balanced:{id:'onnx-community/Qwen2.5-0.5B-Instruct',dtype:'q4',name:'Qwen2.5 0.5B'}};
let active='',pipe=null,lib;
self.onmessage=async ({data:m})=>{
 const send=(type,extra={})=>self.postMessage({id:m.id,type,...extra});
 try{
 const model=MODELS[m.mode];if(!model)throw Error('Unknown model');
 if(active!==m.mode||!pipe){
 if(pipe){await pipe.dispose();pipe=null;}
 send('status',{text:'Loading language runtime…'});
 lib ||= await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
 lib.env.allowLocalModels=false;lib.env.useBrowserCache=true;
 if(lib.env.backends.onnx.wasm)lib.env.backends.onnx.wasm.numThreads=1;
 let lastProgress=0;const progress_callback=p=>{const now=Date.now();if(p.status==='progress'&&now-lastProgress<300&&p.progress<100)return;lastProgress=now;if(p.status==='progress')send('status',{text:'Downloading '+(p.file||'model')+' · '+Math.round(p.progress||0)+'%'});else if(p.status==='initiate')send('status',{text:'Loading '+(p.file||'model')+'…'});};
 let device='wasm';try{if(m.profile.device==='auto'&&self.navigator.gpu&&await self.navigator.gpu.requestAdapter())device='webgpu';}catch{}
 try{pipe=await lib.pipeline('text-generation',model.id,{device,dtype:model.dtype,progress_callback});}
 catch(e){if(device!=='webgpu')throw e;send('status',{text:'GPU unavailable; trying CPU…'});pipe=await lib.pipeline('text-generation',model.id,{device:'wasm',dtype:model.dtype,progress_callback});}
 active=m.mode;
 }
 send('generating',{text:'Generating locally…'});
 let pending='',complete='',lastFlush=0,stopped=false;const flush=()=>{if(pending){send('token',{text:pending});pending='';lastFlush=Date.now();}};
 const streamer=new lib.TextStreamer(pipe.tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:text=>{if(stopped)return;const next=inspectOutput(complete+text);if(next.stop){stopped=true;send('guard',{text:next.text});return;}complete=next.text;pending+=text;if(Date.now()-lastFlush>=250)flush();}});
 const q=m.messages.at(-1)?.content||'';
 const output=await pipe(m.messages,{max_new_tokens:m.extract?(m.profile.context<=1800?112:144):budgetFor(q,m.profile),do_sample:false,repetition_penalty:1.18,no_repeat_ngram_size:4,streamer});
 flush();if(stopped)return;const generated=output[0]?.generated_text;
 const answer=(Array.isArray(generated)?generated.filter(x=>x.role==='assistant').at(-1)?.content:generated)||'';
 if(!answer.trim())throw Error('Model returned no text');
 send('done',{text:answer.trim(),model:model.name});
 }catch(e){send('error',{text:e instanceof Error?e.message:String(e)});}
};