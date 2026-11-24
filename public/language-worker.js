// On-device language inference; no prompts are sent to an inference service.
const MODELS={compact:{id:'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',dtype:'q8',name:'SmolLM2 135M'},balanced:{id:'HuggingFaceTB/SmolLM2-360M-Instruct',dtype:'q4',name:'SmolLM2 360M'}};
let active='',pipe=null,lib;
self.onmessage=async ({data:m})=>{
 const send=(type,extra={})=>self.postMessage({id:m.id,type,...extra});
 try {
  const model=MODELS[m.mode];if(!model)throw Error('Unknown model');
  if(active!==m.mode||!pipe){
   if(pipe){await pipe.dispose();pipe=null;}
   send('status',{text:'Loading language runtime…'});
   lib ||= await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
   lib.env.allowLocalModels=false;lib.env.useBrowserCache=true;
   if(lib.env.backends.onnx.wasm)lib.env.backends.onnx.wasm.numThreads=1;
   const progress_callback=p=>{if(p.status==='progress')send('status',{text:'Downloading '+(p.file||'model')+' · '+Math.round(p.progress||0)+'%'});else if(p.status==='initiate')send('status',{text:'Loading '+(p.file||'model')+'…'});};
   let device='wasm';if(self.navigator.gpu){try{if(await self.navigator.gpu.requestAdapter())device='webgpu';}catch{}}
   try{pipe=await lib.pipeline('text-generation',model.id,{device,dtype:model.dtype,progress_callback});}
   catch(e){if(device!=='webgpu')throw e;send('status',{text:'GPU unavailable; trying CPU…'});device='wasm';pipe=await lib.pipeline('text-generation',model.id,{device,dtype:model.dtype,progress_callback});}
   active=m.mode;
  }
  send('status',{text:'Generating locally…'});
  const streamer=new lib.TextStreamer(pipe.tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:token=>send('token',{text:token})});
  const output=await pipe(m.messages,{max_new_tokens:192,do_sample:true,temperature:0.65,top_p:0.9,repetition_penalty:1.1,streamer});
  const generated=output[0]?.generated_text;
  const text=(Array.isArray(generated)?generated.filter(x=>x.role==='assistant').at(-1)?.content:generated)||'';
  if(!text.trim())throw Error('Model returned no text');
  send('done',{text:text.trim(),model:model.name});
 } catch(e){send('error',{text:e instanceof Error?e.message:String(e)});}
};