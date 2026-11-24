// Factual query compiler and evidence-first lookup. No neural inference.
export const normalize=s=>String(s).normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
export function compile(q){
 const s=q.trim().replace(/[?!.]+$/,'').trim();
 if(/^(?:continue|learn)\s*:/i.test(s))return null;
 const rules=[
 ['location',/^(?:where is the headquarters of|where (?:is|are|was|were)|location of|address of|where (?:can i find|do i find))\s+(.+)$/i],
 ['definition',/^(?:what (?:is|are)|what's|define|explain|tell me about|describe|who (?:is|was|are)|who's)\s+(.+)$/i],
 ['expansion',/^(?:full form of|what does)\s+(.+?)(?:\s+stand for)?$/i],
 ];
 for(const [intent,re] of rules){const m=s.match(re);if(m){const entity=m[1].trim().replace(/\s+(?:located|situated)$/i,'');if(entity.length>0&&entity.length<=100)return {intent,entity};}}
 return /^(?:where|who|what|when|why|which|how|is|are|does|did|can|could|will|has|have)\b/i.test(s)?{intent:'unsupported',entity:''}:null;
}
export function safePublicEntity(entity){
 const n=normalize(entity);
 return n.length>=2&&n.length<=90&&n.split(' ').length<=9&&!/\b(?:my|your|me|i|our|we|us|near me|password|account|phone|email|secret|address|diagnosis|dose|treatment|medicine|medical|bank|investment|stock price|today|current|latest|weather|suicide|bomb|weapon|hack|exploit)\b/.test(n)&&!/@|\d{5,}/.test(entity)&&!/https?:/i.test(entity);
}
const known=[{aliases:['mrpl','mangalore refinery and petrochemicals limited','mangalore refinery and petrochemicals','mangalore refinery'],label:'Mangalore Refinery and Petrochemicals Limited (MRPL)',location:'Kuthethoor P.O., via Katipalla, Mangaluru (Mangalore), Dakshina Kannada, Karnataka – 575030, India.',definition:'Mangalore Refinery and Petrochemicals Limited (MRPL) is an oil refining and petrochemicals company in Karnataka, India.',source:'https://environmentclearance.nic.in/auth/ECGeneral_Report.aspx?pid=30591',sourceLabel:'Government of India environmental clearance project record'}];
export function localEvidence(query){
 const matches=known.filter(x=>x.aliases.includes(normalize(query.entity)));
 if(matches.length!==1)return null;
 const m=matches[0];
 const answer=query.intent==='location'?(m.label+' is located at '+m.location):query.intent==='expansion'?m.label:m.definition;
 return {answer,detail:'Official-source entity lookup · '+m.label,verified:'Matched a bundled, source-backed entity record. No LLM loaded. Not a live address verification.',source:m.source,evidence:{intent:query.intent,entity:m.label,match:'exact known alias',source:m.sourceLabel,weight:1,modelWeights:0}};
}
const cache=new Map();
const uncertain=(q,reason)=>({answer:'I could not establish a reliable '+(q.intent==='location'?'location':'answer')+' for “'+q.entity+'”. '+reason,detail:'Evidence guard · no model loaded',verified:'Abstained rather than inventing information.'});
function tokens(s){return normalize(s).split(' ').filter(Boolean);}
export function scorePage(entity,page){
 const n=normalize(entity),t=normalize(page.title),lead=String(page.extract||'').slice(0,550),p=normalize(lead),e=tokens(entity);
 if(!n||!t||!lead||page.pageprops?.disambiguation!==undefined||page.missing!==undefined||/\bmay refer to\b/i.test(lead))return 0;
 if(t===n)return 1;
 const acronym=tokens(page.title).filter(x=>!['and','of','the','for','in'].includes(x)).map(x=>x[0]).join('');
 if(e.length===1&&n.length<=6&&(acronym===n||new RegExp('\\b'+n+'\\b','i').test(lead))&&n.length>=3)return .90;
 if(e.length>1&&e.every(x=>tokens(t).includes(x)))return .86;
 return 0;
}
export function choosePage(entity,pages){
 const scored=pages.map(p=>({p,score:scorePage(entity,p)})).filter(x=>x.score>=.85).sort((a,b)=>b.score-a.score);
 if(!scored.length)return {status:'miss'};
 if(scored.length>1&&scored[0].score-scored[1].score<.12)return {status:'ambiguous',names:scored.slice(0,3).map(x=>x.p.title)};
 return {status:'match',...scored[0]};
}
export function locationExcerpt(text){
 // Only explicitly location-bearing sentences; never infer a location from nationality.
 const sentences=String(text).match(/[^.!?]+(?:[.!?]+|$)/g)||[];
 return sentences.map(s=>s.trim()).find(s=>/\b(?:located|situated|headquartered|based)\s+(?:in|at|near|on)\b/i.test(s)&&s.length<=480)||null;
}
export async function wikiLookup(q,{signal,fetcher=fetch,timeout=5000}={}){
 const k=q.intent+':'+normalize(q.entity),old=cache.get(k);
 if(old&&Date.now()-old.at<3600000)return {...old.result,detail:'Evidence cache · '+old.result.detail};
 const ctrl=new AbortController(),abort=()=>ctrl.abort();signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)abort();
 const timer=setTimeout(abort,timeout);
 try{
 const params=new URLSearchParams({action:'query',generator:'search',gsrsearch:q.entity,gsrnamespace:'0',gsrlimit:'4',prop:'extracts|pageprops|info',exintro:'1',explaintext:'1',exchars:'1100',inprop:'url',format:'json',formatversion:'2',origin:'*'});
 const r=await fetcher('https://en.wikipedia.org/w/api.php?'+params,{signal:ctrl.signal,credentials:'omit',referrerPolicy:'no-referrer'});
 if(!r.ok)throw Error('HTTP '+r.status);
 const data=await r.json();if(ctrl.signal.aborted)throw Error('Lookup cancelled');
 const selected=choosePage(q.entity,data.query?.pages||[]);
 if(selected.status==='ambiguous')return uncertain(q,'Which did you mean: '+selected.names.join('; ')+'?');
 if(selected.status!=='match')return uncertain(q,'Please spell out the name or add context.');
 const p=selected.p,extract=String(p.extract||'').trim(),source='https://en.wikipedia.org/?curid='+Number(p.pageid);
 if(!Number.isSafeInteger(Number(p.pageid))||Number(p.pageid)<=0)return uncertain(q,'The source did not provide a valid article identifier.');
 const sentence=q.intent==='location'?locationExcerpt(extract):extract.slice(0,750).trim();
 if(!sentence)return {...uncertain(q,'The matching article does not state an explicit location in its introduction.'),source};
 const result={answer:(q.intent==='location'?'The matching article states: ':'From Wikipedia: ')+sentence,detail:'Public entity query · '+p.title,verified:'Retrieved source text, not independently fact-checked. Match score measures entity similarity, not factual correctness. No LLM loaded.',source,evidence:{intent:q.intent,entity:p.title,match:'title or alias match',source:'English Wikipedia',weight:selected.score,modelWeights:0}};
 if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(k,{at:Date.now(),result});return result;
 }catch(e){if(signal?.aborted)throw Error('Stopped');return uncertain(q,'The public lookup was unavailable or timed out. No model was started.');}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function resolve(q,options={}){
 const local=localEvidence(q);if(local)return local;
 if(q.intent==='unsupported')return null;
 if(!options.online||!safePublicEntity(q.entity))return uncertain(q,options.online?'The query is not eligible for a public entity search.':'Enable Public knowledge lookup to search unfamiliar public entities.');
 return wikiLookup(q,options);
}
export function clearEvidence(){cache.clear();}
