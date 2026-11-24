// Experimental Qwen3-MoE decoder. No dense-model pipeline or complete weight-file download.
export const BASE='https://huggingface.co/shibatch/tinyqwen3moe2m/resolve/4047166/hf/';
export const product=a=>a.reduce((x,y)=>x*y,1);
const width={F32:4,F16:2,BF16:2};
export function topK(logits,k,renorm=false){
 if(!logits.length||logits.some(x=>!Number.isFinite(x)))throw Error('Invalid router logits');
 const max=Math.max(...logits),p=logits.map(x=>Math.exp(x-max)),sum=p.reduce((a,b)=>a+b,0);
 const chosen=Array.from(p,(x,i)=>({id:i,weight:x/sum})).sort((a,b)=>b.weight-a.weight||a.id-b.id).slice(0,k);
 if(renorm){const s=chosen.reduce((a,b)=>a+b.weight,0);for(const e of chosen)e.weight/=s;}
 return chosen;
}
export function matvec(w,x,rows,bias){
 if(w.length!==rows*x.length||bias&&bias.length!==rows)throw Error('Projection shape mismatch');
 const y=new Float32Array(rows);for(let i=0;i<rows;i++){let sum=bias?bias[i]:0;for(let j=0;j<x.length;j++)sum+=w[i*x.length+j]*x[j];y[i]=sum;}return y;
}
export function rms(x,w,eps=1e-6){
 if(x.length!==w.length)throw Error('RMS shape mismatch');
 let s=0;for(const v of x)s+=v*v;const z=1/Math.sqrt(s/x.length+eps);return Float32Array.from(x,(v,i)=>v*z*w[i]);
}
export function silu(x){return x/(1+Math.exp(-x));}
export function expertForward(x,gateUp,down,intermediate){
 const a=matvec(gateUp,x,2*intermediate),b=new Float32Array(intermediate);
 for(let i=0;i<intermediate;i++)b[i]=silu(a[i])*a[i+intermediate];
 return matvec(down,b,x.length);
}
export function parseHeader(h){
 const out=new Map();let total=0,prev=0;const ranges=[];
 for(const [name,t] of Object.entries(h)){if(name==='__metadata__')continue;
 if(!width[t.dtype]||!Array.isArray(t.shape)||!t.shape.length||!t.shape.every(n=>Number.isSafeInteger(n)&&n>0)||!Array.isArray(t.data_offsets)||t.data_offsets.length!==2)throw Error('Unsupported tensor '+name);
 const [start,end]=t.data_offsets,n=product(t.shape);if(!Number.isSafeInteger(n)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end-start!==n*width[t.dtype])throw Error('Malformed offsets '+name);
 out.set(name,{...t,start,end,n});total+=n;ranges.push([start,end]);
 }ranges.sort((a,b)=>a[0]-b[0]);for(const [s,e] of ranges){if(s!==prev)throw Error('Non-contiguous or overlapping tensor index');prev=e;}
 if(!total||prev>32*1024*1024)throw Error('Checkpoint outside experiment limit');
 return {tensors:out,total,weightBytes:prev};
}
export async function requestRange(url,start,end,signal,fetcher=fetch){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start||end-start+1>4*1024*1024)throw Error('Invalid requested byte range');
 const r=await fetcher(url,{headers:{Range:'bytes='+start+'-'+end},cache:'no-store',signal});
 if(r.status!==206){await r.body?.cancel().catch(()=>{});throw Error('Host refused partial weights (HTTP '+r.status+'). Full-model loading is disabled.');}
 const cr=r.headers.get('content-range');if(cr&&!cr.startsWith('bytes '+start+'-'+end+'/')){await r.body?.cancel().catch(()=>{});throw Error('Incorrect partial response range');}
 // Read at most the requested length even if the host sends a malformed body.
 const len=end-start+1,b=new Uint8Array(len);if(!r.body)throw Error('Missing range response body');
 const reader=r.body.getReader();let at=0;try{while(true){const {done,value}=await reader.read();if(done)break;if(at+value.length>len){await reader.cancel();throw Error('Oversized partial response');}b.set(value,at);at+=value.length;}}finally{reader.releaseLock();}
 if(at!==len)throw Error('Truncated partial response');return b;
}
export function decodeWeights(bytes,dtype){
 const n=bytes.length/width[dtype],v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),o=new Float32Array(n);
 const scratch=new DataView(new ArrayBuffer(4));
 for(let i=0;i<n;i++){if(dtype==='F32')o[i]=v.getFloat32(i*4,true);else if(dtype==='BF16'){scratch.setUint32(0,v.getUint16(i*2,true)<<16,true);o[i]=scratch.getFloat32(0,true);}else{const x=v.getUint16(i*2,true),sign=x&32768?-1:1,e=(x>>10)&31,m=x&1023;o[i]=e===0?sign*m*2**-24:e===31?(m?NaN:sign*Infinity):sign*(1+m/1024)*2**(e-15);}}
 if(o.some(x=>!Number.isFinite(x)))throw Error('Non-finite checkpoint tensor');return o;
}
export class SparseWeights{
 constructor(index,offset,read,fraction){this.index=index;this.offset=offset;this.read=read;this.limit=Math.floor(index.total*fraction);this.resident=0;this.peak=0;this.unique=0;this.bytes=0;this.requests=0;this.seen=new Set();this.shared=new Map();this.experts=new Map();this.routes=[];this.expertCalls=0;}
 has(name){return this.index.tensors.has(name);}
 spec(name,shape){const t=this.index.tensors.get(name);if(!t||t.shape.length!==shape.length||t.shape.some((x,i)=>x!==shape[i]))throw Error('Unsupported checkpoint layout: '+name);return t;}
 evictFor(n,protectedKey){
 for(const [k,e] of this.experts){if(this.resident+n<=this.limit)break;if(k===protectedKey)continue;this.experts.delete(k);this.resident-=e.n;}
 if(this.resident+n>this.limit)throw Error('Selected percentage budget is too low for shared weights and active expert. Increase budget or use query mode.');
 }
 async raw(name,shape,slice){
 const t=this.spec(name,shape),count=slice===undefined?t.n:t.n/shape[0],offset=slice===undefined?0:slice*count;
 if(slice!==undefined&&(!Number.isInteger(slice)||slice<0||slice>=shape[0]))throw Error('Invalid expert slice');
 const b=width[t.dtype],start=this.offset+t.start+offset*b,end=start+count*b-1,tag=name+':'+(slice??'all');
 const data=await this.read(start,end);this.bytes+=data.length;this.requests++;
 if(!this.seen.has(tag)){this.seen.add(tag);this.unique+=count;}
 return decodeWeights(data,t.dtype);
 }
 async common(name,shape){
 if(this.shared.has(name))return this.shared.get(name);
 const n=this.spec(name,shape).n;this.evictFor(n);const v=await this.raw(name,shape);this.shared.set(name,v);this.resident+=n;this.peak=Math.max(this.peak,this.resident);return v;
 }
 async expert(prefix,id,H,I,E){
 const key=prefix+':'+id;
 if(this.experts.has(key)){const e=this.experts.get(key);this.experts.delete(key);this.experts.set(key,e);return e;}
 const n=3*H*I;this.evictFor(n);
 let gateUp,down;
 if(this.has(prefix+'experts.gate_up_proj')){
 gateUp=await this.raw(prefix+'experts.gate_up_proj',[E,2*I,H],id);down=await this.raw(prefix+'experts.down_proj',[E,H,I],id);
 }else{
 const p=prefix+'experts.'+id+'.';const gate=await this.raw(p+'gate_proj.weight',[I,H]),up=await this.raw(p+'up_proj.weight',[I,H]);gateUp=new Float32Array(2*I*H);gateUp.set(gate);gateUp.set(up,I*H);down=await this.raw(p+'down_proj.weight',[H,I]);
 }
 const e={gateUp,down,n};this.experts.set(key,e);this.resident+=n;this.peak=Math.max(this.peak,this.resident);return e;
 }
 route(layer,id,weight){this.expertCalls++;this.routes.push({layer,id,weight});if(this.routes.length>24)this.routes.shift();}
 stats(){return {total:this.index.total,limit:this.limit,resident:this.resident,peak:this.peak,unique:this.unique,bytes:this.bytes,requests:this.requests,expertCalls:this.expertCalls,routes:this.routes.slice(),weightBytes:this.index.weightBytes};}
}
export async function openWeights(url,fraction,signal,fetcher=fetch){
 if(!Number.isFinite(fraction)||fraction<.35||fraction>.9)throw Error('Weight budget must be 35–90%.');
 const read=(s,e)=>requestRange(url,s,e,signal,fetcher);
 const first=await read(0,7),len=Number(new DataView(first.buffer,first.byteOffset,8).getBigUint64(0,true));
 if(!Number.isSafeInteger(len)||len<2||len>512*1024)throw Error('Invalid safetensors header length');
 const header=JSON.parse(new TextDecoder().decode(await read(8,7+len))),index=parseHeader(header);
 const w=new SparseWeights(index,8+len,read,fraction);w.headerBytes=8+len;return w;
}
export function tokenizerFromJSON(t){
 if(t.model?.type!=='BPE'||t.pre_tokenizer?.type!=='ByteLevel'||t.pre_tokenizer.add_prefix_space||t.normalizer)throw Error('Unsupported tokenizer');
 const direct=[];for(let i=33;i<=126;i++)direct.push(i);for(let i=161;i<=172;i++)direct.push(i);for(let i=174;i<=255;i++)direct.push(i);
 const chars=new Map(direct.map(i=>[i,String.fromCharCode(i)]));let n=0;for(let i=0;i<256;i++)if(!chars.has(i))chars.set(i,String.fromCharCode(256+n++));
 const inverse=new Map([...chars].map(([b,c])=>[c,b])),vocab=t.model.vocab,byId=new Map(Object.entries(vocab).map(([k,v])=>[v,k]));
 const ranks=new Map(t.model.merges.map((m,i)=>[Array.isArray(m)?m.join(' '):m,i]));
 const re=/'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
 return {encode(text){const out=[];for(const piece of text.match(re)||[]){let a=Array.from(new TextEncoder().encode(piece),b=>chars.get(b));while(a.length>1){let best=Infinity,idx=-1;for(let j=0;j<a.length-1;j++){const rank=ranks.get(a[j]+' '+a[j+1]);if(rank!==undefined&&rank<best){best=rank;idx=j;}}if(idx<0)break;const left=a[idx],right=a[idx+1],merged=[];for(let j=0;j<a.length;j++){if(a[j]===left&&a[j+1]===right){merged.push(left+right);j++;}else merged.push(a[j]);}a=merged;}for(const x of a){if(!Object.hasOwn(vocab,x))throw Error('Tokenizer unknown byte');out.push(vocab[x]);}}return out;},decode(ids){const b=[];for(const id of ids){if(id>=1000)continue;for(const c of byId.get(id)||''){if(inverse.has(c))b.push(inverse.get(c));}}return new TextDecoder().decode(Uint8Array.from(b));}};
}
export function ropeParams(c){
 const r=c.rope_parameters||c.rope_scaling||{},d=c.head_dim,base=r.rope_theta||c.rope_theta||1000000,factor=r.factor||1,orig=r.original_max_position_embeddings||c.max_position_embeddings;
 const correction=rot=>d*Math.log(orig/(rot*2*Math.PI))/(2*Math.log(base));
 const low=Math.max(0,Math.floor(correction(r.beta_fast||32))),high=Math.min(d-1,Math.ceil(correction(r.beta_slow||1)));
 const inv=Float32Array.from({length:d/2},(_,i)=>{const f=base**(-2*i/d);if(factor===1)return f;const ramp=Math.max(0,Math.min(1,(i-low)/Math.max(.001,high-low)));return f*(1-ramp)+f/factor*ramp;});
 return {inv,scale:r.attention_factor||1+.1*Math.log(factor)};
}
export function rotate(x,position,rope){
 const h=x.length/2,o=new Float32Array(x.length);for(let i=0;i<h;i++){const a=position*rope.inv[i],c=Math.cos(a)*rope.scale,s=Math.sin(a)*rope.scale;o[i]=x[i]*c-x[i+h]*s;o[i+h]=x[i+h]*c+x[i]*s;}return o;
}
export function attention(q,keys,values,d){
 const scores=keys.map(k=>{let s=0;for(let j=0;j<d;j++)s+=q[j]*k[j];return s/Math.sqrt(d);}),max=Math.max(...scores),p=scores.map(s=>Math.exp(s-max)),sum=p.reduce((a,b)=>a+b,0),out=new Float32Array(d);
 for(let i=0;i<p.length;i++)for(let j=0;j<d;j++)out[j]+=p[i]/sum*values[i][j];return out;
}
const add=(x,y)=>Float32Array.from(x,(v,i)=>v+y[i]);
export async function decodeToken(c,w,token,position,kv,rope){
 const H=c.hidden_size,D=c.head_dim,A=c.num_attention_heads,K=c.num_key_value_heads,I=c.moe_intermediate_size,E=c.num_experts||c.num_local_experts;
 const get=(n,s)=>w.common(n,s);
 const embed=await get('model.embed_tokens.weight',[c.vocab_size,H]);let x=embed.slice(token*H,(token+1)*H);
 for(let l=0;l<c.num_hidden_layers;l++){
 const p='model.layers.'+l+'.',a=p+'self_attn.',m=p+'mlp.';
 const h=rms(x,await get(p+'input_layernorm.weight',[H]),c.rms_norm_eps);
 const project=async(name,rows,input=h)=>matvec(await get(a+name+'.weight',[rows,input.length]),input,rows,w.has(a+name+'.bias')?await get(a+name+'.bias',[rows]):undefined);
 const q=await project('q_proj',A*D),k=await project('k_proj',K*D),v=await project('v_proj',K*D),qn=await get(a+'q_norm.weight',[D]),kn=await get(a+'k_norm.weight',[D]);
 const cache=kv[l];const keys=[],values=[];
 for(let j=0;j<K;j++){keys.push(rotate(rms(k.slice(j*D,(j+1)*D),kn,c.rms_norm_eps),position,rope));values.push(v.slice(j*D,(j+1)*D));cache.keys[j].push(keys[j]);cache.values[j].push(values[j]);}
 const att=new Float32Array(A*D);
 for(let j=0;j<A;j++){const head=rotate(rms(q.slice(j*D,(j+1)*D),qn,c.rms_norm_eps),position,rope),idx=Math.floor(j/(A/K));att.set(attention(head,cache.keys[idx],cache.values[idx],D),j*D);}
 x=add(x,await project('o_proj',H,att));
 const z=rms(x,await get(p+'post_attention_layernorm.weight',[H]),c.rms_norm_eps);
 const logits=Array.from(matvec(await get(m+'gate.weight',[E,H]),z,E)),chosen=topK(logits,c.num_experts_per_tok,c.norm_topk_prob),mix=new Float32Array(H);
 for(const e of chosen){const b=await w.expert(m,e.id,H,I,E),y=expertForward(z,b.gateUp,b.down,I);for(let i=0;i<H;i++)mix[i]+=e.weight*y[i];w.route(l,e.id,e.weight);}
 // Standard Qwen3-MoE has no shared MLP; support explicitly present shared-expert tensors.
 if(w.has(m+'shared_expert.gate_proj.weight')){
 const J=c.shared_expert_intermediate_size;if(!J)throw Error('Unsupported shared expert');
 const g=matvec(await get(m+'shared_expert.gate_proj.weight',[J,H]),z,J),u=matvec(await get(m+'shared_expert.up_proj.weight',[J,H]),z,J);
 const y=matvec(await get(m+'shared_expert.down_proj.weight',[H,J]),Float32Array.from(g,(v,i)=>silu(v)*u[i]),H);
 const scale=w.has(m+'shared_expert_gate.weight')?1/(1+Math.exp(-matvec(await get(m+'shared_expert_gate.weight',[1,H]),z,1)[0])):1;
 for(let i=0;i<H;i++)mix[i]+=scale*y[i];
 }
 x=add(x,mix);
 }
 const norm=rms(x,await get('model.norm.weight',[H]),c.rms_norm_eps),head=w.has('lm_head.weight')?await get('lm_head.weight',[c.vocab_size,H]):embed;
 const logits=matvec(head,norm,c.vocab_size);if(logits.some(v=>!Number.isFinite(v)))throw Error('Non-finite token prediction');
 return logits;
}
export function assertConfig(c){
 if(c.model_type!=='qwen3_moe'||c.hidden_size!==128||c.num_hidden_layers!==6||c.head_dim!==32||c.num_attention_heads!==8||c.num_key_value_heads!==1||c.moe_intermediate_size!==256||(c.num_experts||c.num_local_experts)!==2||c.num_experts_per_tok!==1||c.vocab_size!==1024||c.hidden_act!=='silu')throw Error('Unexpected model architecture');
}
export async function generate(text,{fraction=.65,maxTokens=8,signal,progress=()=>{},fetcher=fetch}={}){
 const loadJSON=async path=>{const r=await fetcher(BASE+path,{signal});if(!r.ok)throw Error('Unable to fetch '+path);return r.json();};
 const [c,t]=await Promise.all([loadJSON('config.json'),loadJSON('tokenizer.json')]);assertConfig(c);
 const tokenizer=tokenizerFromJSON(t),ids=[c.bos_token_id,...tokenizer.encode(text)];
 if(ids.length>24)throw Error('Sparse lab accepts at most 23 prompt tokens. Try “Once upon”.');
 const w=await openWeights(BASE+'model.safetensors',fraction,signal,fetcher),rope=ropeParams(c);
 const kv=Array.from({length:c.num_hidden_layers},()=>({keys:Array.from({length:c.num_key_value_heads},()=>[]),values:Array.from({length:c.num_key_value_heads},()=>[])}));
 let logits;const generated=[];
 for(let i=0;i<ids.length;i++){if(signal?.aborted)throw Error('Stopped');logits=await decodeToken(c,w,ids[i],i,kv,rope);progress({phase:'Prefill '+(i+1)+'/'+ids.length,...w.stats()});}
 for(let i=0;i<Math.min(12,Math.max(1,maxTokens));i++){
 if(signal?.aborted)throw Error('Stopped');let next=0;for(let j=1;j<logits.length;j++)if(logits[j]>logits[next])next=j;
 if(next===c.eos_token_id)break;if(next>=1000)break;generated.push(next);
 progress({phase:'Generated '+generated.length+' tokens',...w.stats(),text:tokenizer.decode(generated)});
 if(i+1<maxTokens)logits=await decodeToken(c,w,next,ids.length+i,kv,rope);
 }
 return {text:tokenizer.decode(generated),tokens:generated.length,stats:w.stats()};
}
