import {generate} from './sparse-runtime-v10.js';
self.onmessage=async({data:m})=>{try{const out=await generate(m.text,{fraction:m.fraction,maxTokens:m.maxTokens,progress:p=>self.postMessage({type:'progress',...p})});self.postMessage({type:'done',...out});}catch(e){self.postMessage({type:'error',error:String(e.message||e)});}};
