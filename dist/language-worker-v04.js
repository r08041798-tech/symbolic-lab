// Local inference only. Model selection is explicit; no remote inference API.
import {tokenBudget} from './guards-v04.js';
const MODELS={compact:{id:'HuggingFaceTB/SmolLM2-360M-Instruct',dtype:'q4',name:'SmolLM2 360M'},balanced:{id:'onnx-community/Qwen2.5-0.5B-Instruct',dtype:'q4',name:'Qwen2.5 0.5B'}};
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
 const progress_callback=p=>{if(p.status==='progress')send('status',{text:'Downloading '+(p.file||'model')+' · '+Math.round(p.progress||0)+'%'});else if(p.status==='initiate')send('status',{text:'Loading '+(p.file||'model')+'…'});};
 let device='wasm';try{if(self.navigator.gpu&&await self.navigator.gpu.requestAdapter())device='webgpu';}catch{}
 try{pipe=await lib.pipeline('text-generation',model.id,{device,dtype:model.dtype,progress_callback});}
 catch(e){if(device!=='webgpu')throw e;send('status',{text:'GPU unavailable; trying CPU…'});pipe=await lib.pipeline('text-generation',model.id,{device:'wasm',dtype:model.dtype,progress_callback});}
 active=m.mode;
 }
 send('generating',{text:'Generating locally…'});
 const streamer=new lib.TextStreamer(pipe.tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:text=>send('token',{text})});
 const q=m.messages.at(-1)?.content||'';
 const output=await pipe(m.messages,{max_new_tokens:tokenBudget(q),do_sample:false,repetition_penalty:1.18,no_repeat_ngram_size:4,streamer});
 const generated=output[0]?.generated_text;
 const answer=(Array.isArray(generated)?generated.filter(x=>x.role==='assistant').at(-1)?.content:generated)||'';
 if(!answer.trim())throw Error('Model returned no text');
 send('done',{text:answer.trim(),model:model.name});
 }catch(e){send('error',{text:e instanceof Error?e.message:String(e)});}
};