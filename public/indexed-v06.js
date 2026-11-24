export function normalizeIndex(s){return String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[’']/g,"").replace(/[^a-z0-9]+/g," ").trim();}
export function parseIntent(input){
 let q=normalizeIndex(input);if(!q)return {kind:"unknown"};
 if(/^(what can you do|what do you know|show (?:your )?(?:skills|topics|capabilities|knowledge)|list (?:your )?(?:skills|topics|capabilities)|help|who are you|what are you)$/.test(q))return {kind:"directory"};
 if(/^(?:explain (?:it |that )?(?:more|further|in detail|simply)|tell me more|more details|more|how does it work|explain that|explain simply|simpler|make it simple|give (?:me )?(?:an |a )?example|example|another example)$/.test(q))return {kind:"followup",view:/example/.test(q)?"example":/simpl|make it/.test(q)?"brief":"detail"};
 let m=q.match(/^(?:compare|(?:what is )?(?:the )?difference between)\s+(.+?)\s+(?:and|vs|versus|with)\s+(.+)$/)||q.match(/^(.+?)\s+(?:vs|versus)\s+(.+)$/);
 if(m)return {kind:"compare",terms:[m[1],m[2]]};
 let view="brief";if(/\b(?:in detail|more detail|step by step)\b/.test(q))view="detail";
 if(/^(?:give (?:me )?(?:an? )?example of|example of)\s+/.test(q)){view="example";q=q.replace(/^(?:give (?:me )?(?:an? )?example of|example of)\s+/,"");}
 else q=q.replace(/^(?:can you |could you |please )+/,"").replace(/^(?:what (?:is|are)|whats|define|explain|tell me about|describe|how (?:does|do|did))\s+/,"");
 q=q.replace(/\s+(?:in detail|in simple terms|more detail|step by step|work|works|working)$/,"").trim();
 if(/^(?:write|draft|generate|create|build|fix|debug|translate|summarize|summarise|calculate|convert|solve|recommend|list|find|book|search)\b/.test(q))return {kind:"unknown"};
 return {kind:"knowledge",terms:[q],view};
}
export function matchTopic(term,topics){
 const q=normalizeIndex(term);
 const hits=topics.filter(t=>[t.title,...t.aliases].some(a=>normalizeIndex(a)===q));
 return hits.length===1?hits[0]:null;
}
import {quickReply} from './guards-v04.js';
import {respond} from './chat.js';
import {isSkill} from './conversation-v05.js';
const experiences=new Map();
const result=(answer,detail,verified='Local response',source)=>({answer,detail,verified,...(source?{source}:{})});
const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const event=(engine,label,detail,bytes)=>engine.onEvent?.({label,detail,...(bytes!==undefined?{bytes}:{})});
async function loadCatalog(engine){return decode(await engine.load(engine.manifest.index));}
function readView(t,v){return v==='example'?t.example:v==='detail'?t.brief+'\n\n'+t.detail+'\n\nExample: '+t.example:t.brief;}
export async function tryIndexed(engine,state,history,q,signal){
 if(signal?.aborted)throw Error('Stopped');
 const quick=quickReply(q,state,history);
 if(quick!==null){event(engine,'Capability selected','Conversation · no model');return result(quick,'Direct conversation · no generative model');}
 if(isSkill(q,state)||/^(?:say that again|repeat|repeat that)\??$/i.test(q.trim())){
  event(engine,'Capability selected','Deterministic or extractive skill · no generative model');state.indexedTopic='';
  return respond(engine,state,q);
 }
 const intent=parseIntent(q);
 if(intent.kind==='unknown'){state.indexedTopic='';return null;}
 const catalog=await loadCatalog(engine);
 event(engine,'Intent index',intent.kind+' · '+catalog.topics.length+' indexed topics');
 if(signal?.aborted)throw Error('Stopped');
 if(intent.kind==='directory'){
  const groups={};for(const t of catalog.topics)(groups[t.domain]||=[]).push(t.title);
  return result('I can handle basic chat, memory, arithmetic, unit conversion and text summaries. My current knowledge directory:\n\n'+Object.entries(groups).map(([d,ts])=>d+': '+ts.join(', ')).join('\n\n'),'Capability directory · no model','Coverage is limited to installed skills and curated topics.');
 }
 let matches;
 if(intent.kind==='followup'){const t=catalog.topics.find(t=>t.id===state.indexedTopic);if(!t)return null;matches=[t];}
 else matches=intent.terms.map(t=>matchTopic(t,catalog.topics));
 if(matches.some(t=>!t)||!matches.length){state.indexedTopic='';event(engine,'Index miss','No exact indexed concept; not guessing');return null;}
 if(matches.length===2&&matches[0].id===matches[1].id)return result('Those names refer to the same indexed topic: '+matches[0].title+'.','Indexed alias resolution · no model');
 const view=intent.view||'brief';const key=matches.map(t=>t.resource.sha256).join(':')+':'+view;
 if(experiences.has(key)){const cached=experiences.get(key);event(engine,'Experience hit','Reused identical versioned topic result');state.indexedTopic=matches.length===1?matches[0].id:'';return {...cached,detail:'Experience hit · '+cached.detail};}
 const records=[];for(const t of matches){if(signal?.aborted)throw Error('Stopped');event(engine,'Knowledge route',t.domain+' → '+t.title,t.resource.bytes);records.push(decode(await engine.load(t.resource)));}
 if(signal?.aborted)throw Error('Stopped');
 const answer=records.length===1?readView(records[0],view):records.map(t=>t.title+': '+t.brief+'\nExample: '+t.example).join('\n\n')+'\n\nThese are separate concepts; this comparison shows their definitions and applications, not a ranking.';
 state.indexedTopic=matches.length===1?matches[0].id:'';
 const out=result(answer,'Indexed retrieval · '+matches.map(t=>t.title).join(' + ')+' · no generative model','Integrity-checked curated text; not independently fact-checked during retrieval.',records.length===1?records[0].source:undefined);
 experiences.set(key,out);if(experiences.size>32)experiences.delete(experiences.keys().next().value);
 return out;
}
export function clearExperiences(){experiences.clear();}
export async function chat(engine,state,history,q,mode,progress,token,signal,mobile){
 let r;try{r=await tryIndexed(engine,state,history,q,signal);}catch(e){if(signal?.aborted)throw e;event(engine,'Indexed route failed',String(e));if(mode==='indexed'||mode==='original')throw e;}
 if(r)return r;
 if(mode==='indexed'||mode==='original')return result('I do not have enough indexed knowledge for that request yet. Try “show topics” to see what I know, or choose an optional language model for open-ended chat.','No confident indexed route · model not loaded','Abstained rather than guessing.');
 event(engine,'Optional model fallback',mode+' · user-selected generative mode');const m=await import('./conversation-v05.js');return m.chat(engine,state,history,q,mode,progress,token,signal,mobile);
}
export async function releaseModel(){const m=await import('./conversation-v05.js');m.releaseModel();}
