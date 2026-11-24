// Priors and resource tiers are estimates, not benchmarked accuracy or RAM.
export const MODELS=[
{id:'lite',name:'SmolLM2 135M',tier:1,cost:0.25,prior:{definition:0.45,conversation:0.50,drafting:0.35}},
{id:'compact',name:'SmolLM2 360M',tier:2,cost:0.55,prior:{definition:0.65,conversation:0.65,drafting:0.55}},
{id:'balanced',name:'Qwen2.5 0.5B',tier:3,cost:0.85,prior:{definition:0.78,conversation:0.75,drafting:0.75}}];
export function deviceTier({mobile=false,ram=0}={}){
 if(ram>0&&ram<=2)return 0;
 if(mobile)return ram>=8?2:1;
 return ram>=8?3:ram>=4||!ram?2:1;
}
export function classifyTask(q,topic){if(topic)return 'definition';return /\b(?:write|draft|create|story|poem|email|compose)\b/i.test(q)?'drafting':'conversation';}
export function rankModels(task,device,stats={},cap=3){
 const tier=Math.min(deviceTier(device),cap);
 return MODELS.filter(m=>m.tier<=tier).map(m=>{
 const s=stats[m.id+':'+task]||{},n=Math.max(0,Number(s.attempts)||0),ok=Math.min(n,Math.max(0,Number(s.completed)||0));
 const reliability=(4*m.prior[task]+ok)/(4+n);
 const cost=m.cost;
 const score=0.8*reliability-0.2*cost;
 return {...m,reliability,score,attempts:n,completed:ok};
 }).sort((a,b)=>b.score-a.score||a.cost-b.cost);
}
export function recordOutcome(stats,id,task,passed){
 const k=id+':'+task,s=stats[k]||{attempts:0,completed:0};
 const attempts=Math.min(1000,s.attempts+1),completed=Math.min(attempts,s.completed+(passed?1:0));
 return {...stats,[k]:{attempts,completed}};
}
export function normalize(s){return String(s).normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
export function eligible(s){
 const t=normalize(s);
 return t.length>=2&&t.length<=72&&t.split(' ').length<=7&&/[a-z]/.test(t)&&!/\d/.test(t)&&!/\b(?:i|me|my|you|your|we|our|today|latest|current|price|password|secret|address|account|personal|diagnosis|diagnose|treatment|dose|medicine|medication|investment|stock|tax|legal|law|weapon|bomb|suicide|kill|hack|exploit)\b/.test(t);
}
export function topicOf(q,parseIntent){
 const m=q.trim().match(/^learn\s*:\s*(.+)$/i);
 if(m)return eligible(m[1])?normalize(m[1]):null;
 if(!/^(?:what (?:is|are)|what's|define|explain|tell me about|describe)\s+/i.test(q.trim()))return null;
 const i=parseIntent(q);
 return i.kind==='knowledge'&&i.terms?.length===1&&eligible(i.terms[0])?normalize(i.terms[0]):null;
}
export function validateExtraction(raw,topic,model,createdAt){
 if(typeof raw!=='string'||raw.length>1600||!eligible(topic))return null;
 let s=raw.trim();const f=s.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i);if(f)s=f[1];
 let x;try{x=JSON.parse(s);}catch{return null;}
 if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['definition','aliases'].includes(k)))return null;
 if(typeof x.definition!=='string'||!Array.isArray(x.aliases)||x.aliases.length>5||x.aliases.some(a=>typeof a!=='string'||!eligible(a)))return null;
 const definition=x.definition.trim().replace(/\s+/g,' ');
 if(definition.length<25||definition.length>500||!/[.!?]$/.test(definition)||/\b(?:i don't know|i do not know|not sure|as an ai|cannot answer|unknown concept)\b/i.test(definition)||/[<>{}]/.test(definition)||/https?:\/\/|www\./i.test(definition))return null;
 return {id:normalize(topic),aliases:[...new Set([normalize(topic),...x.aliases.map(normalize)])],definition,model,createdAt,status:'unverified'};
}
export function findRecord(records,topic){
 const k=normalize(topic),exact=records.filter(r=>r.id===k);
 if(exact.length===1)return exact[0];
 const hits=records.filter(r=>r.aliases.includes(k));return hits.length===1?hits[0]:null;
}
