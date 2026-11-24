import{Engine}from'./engine.js';
import{fresh,respond}from'./chat.js';
const $=(id)=>document.getElementById(id);
const engine=new Engine();
let state=fresh(),busy=false,ready=false;
try{
state={...fresh(),...JSON.parse(localStorage.getItem('modular-chat-state')||'{}')};
}
catch{}
;
let controller=null;
const stop=$('stop');
stop.onclick=()=>controller?.abort();
const history=[];
const mode=$('mode');
const mobile=matchMedia('(pointer: coarse)').matches||/Android|iPhone|iPad/i.test(navigator.userAgent);
const lowMemory=Number((navigator).deviceMemory||0);
mode.value='indexed';if(mobile){for(const o of Array.from(mode.options))if(o.value!=='indexed')o.disabled=true;$('neural-optin').setAttribute('disabled','');}
const pauseTyping=$('pause-typing');pauseTyping.checked=mobile;
let releaseModel=null;
mode.addEventListener('change',()=>releaseModel?.());
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(busy)controller?.abort();else releaseModel?.();}});
const messages=$('messages'),prompt=$('prompt'),send=$('send');
function bubble(role,text,result){const el=document.createElement('article');el.className='bubble '+role;const label=document.createElement('small');label.textContent=role==='user'?'You':'Modular AI';const body=document.createElement('div');body.textContent=text;el.append(label,body);if(result){
const meta=document.createElement('details');
const sum=document.createElement('summary');
sum.textContent='Response details';
const d=document.createElement('p');
d.textContent=result.detail+' · '+result.verified;
meta.append(sum,d);if(result.evidence){const x=result.evidence;const p=document.createElement('pre');p.className='query-plan';p.textContent=['INTENT '+x.intent,'ENTITY '+x.entity,'MATCH '+x.match,'SOURCE '+x.source,'MATCH SCORE '+x.weight.toFixed(2)+' (not factual confidence)','LLM WEIGHTS LOADED 0%'].join('\n');meta.append(p);}if(result.sparse){const x=result.sparse;const p=document.createElement('pre');p.className='query-plan';p.textContent=['CHECKPOINT '+x.total.toLocaleString()+' parameters','BUDGET '+(100*x.limit/x.total).toFixed(1)+'%','PEAK RETAINED WEIGHTS '+(100*x.peak/x.total).toFixed(1)+'%','UNIQUE WEIGHTS FETCHED '+(100*x.unique/x.total).toFixed(1)+'%','TRANSFER '+x.bytes.toLocaleString()+' weight bytes','RANGE REQUESTS '+x.requests,'EXPERT EXECUTIONS '+x.expertCalls,...x.routes.map(r=>'Layer '+r.layer+' expert '+r.id+' gate '+r.weight.toFixed(3)),'Retained tensor budget is not total browser RAM. Experts may change per token; cumulative fetch may reach 100%.'].join('\n');meta.append(p);}if(result.routing){const x=result.routing;const p=document.createElement('pre');p.className='query-plan';p.textContent=['TASK '+x.task,'DEVICE TIER '+x.deviceTier,'SELECTED '+x.selected,...x.candidates.map(c=>c.name+' | '+c.score.toFixed(3)+' | '+c.completed+'/'+c.attempts+' completed'),x.note].join('\n');meta.append(p);}if(result.plan){const plan=result.plan;const title=document.createElement('p');title.textContent='Plan status: '+plan.status+(plan.alternatives?' · '+plan.alternatives+' candidate plans':'');meta.append(title);const pre=document.createElement('pre');pre.className='query-plan';const lines=[];for(const [name,f] of Object.entries(plan.inputs||{}))lines.push('INPUT '+name+': '+f.value+' '+f.unit+' (user supplied)');for(const s of plan.steps||[])lines.push('DERIVE '+s.output+' = '+s.value.toPrecision(7)+' '+s.unit+' | '+s.formula+' | rule '+s.id);for(const c of plan.checks||[])lines.push((c.pass?'PASS ':'FAIL ')+c.label);if(Number.isFinite(plan.routeScore))lines.push('Route score: '+plan.routeScore.toFixed(3)+' (ranking, not probability)');if(Number.isFinite(plan.weakestWeight))lines.push('Weakest structural weight: '+plan.weakestWeight.toFixed(3)+' (not calibrated confidence)');for(const a of plan.assumptions||[])lines.push('ASSUMPTION '+a);pre.textContent=lines.join('\n');meta.append(pre);}
if(result.source&&/^https?:\/\//.test(result.source)){
const a=document.createElement('a');
a.href=result.source;
a.target='_blank';
a.rel='noopener noreferrer';
a.textContent='Source';
meta.append(a);
}
el.append(meta);
}messages.append(el);messages.scrollTop=messages.scrollHeight;while(messages.children.length>60)messages.firstElementChild?.remove();return el;}
function stats(){$('metrics').textContent='Downloaded '+engine.downloaded.toLocaleString()+' B · '+engine.cacheHits+' cache hits · '+[...engine.memory.values()].reduce((s,b)=>s+b.byteLength,0).toLocaleString()+' B resident';}
engine.onEvent=e=>{const item=document.createElement('li');item.textContent=e.label+' — '+e.detail+(e.bytes?' · '+e.bytes+' B':'');$('trace').prepend(item);while($('trace').children.length>30)
$('trace').lastChild?.remove();stats();};
async function ask(){const q=prompt.value.trim();if(!ready||busy||!q)
return;if(q.length>20000){
$('status').textContent='Maximum 20,000 characters';
return;
}busy=true;controller=new AbortController();stop.hidden=false;send.disabled=true;mode.disabled=true;prompt.value='';bubble('user',q);const wait=bubble('assistant','Thinking…');$('status').textContent='Processing locally';try{
const modulePath='./safe-chat-v11.js';const adapter=await import(modulePath);releaseModel=adapter.releaseModel;let streamed='',lastPaint=0,lastStatus=0;const body=wait.querySelector('div');wait.classList.add('streaming');wait.setAttribute('aria-live','off');const r=await adapter.chat(engine,state,history,q,mode.value,text=>{const now=performance.now();if(now-lastStatus>300){$('status').textContent=text;lastStatus=now;}},text=>{streamed+=text;const now=performance.now();if(body&&now-lastPaint>=250){body.textContent=streamed;lastPaint=now;}},controller.signal,mobile);if(r.detail!=='Stopped by user')history.push({role:'user',content:q},{role:'assistant',content:r.answer});if(history.length>24)history.splice(0,history.length-24);
wait.remove();
bubble('assistant',r.answer,r);
state.last=r.answer;
try{
localStorage.setItem('modular-chat-state',JSON.stringify(state));
}
catch{}
;
}
catch(e){
wait.remove();
bubble('assistant','Request could not be completed. Details: '+(e instanceof Error?e.message:String(e)));
}
finally{
busy=false;
controller=null;
stop.hidden=true;
send.disabled=false;
mode.disabled=false;
$('status').textContent='Ready · on-device';
stats();
if(!mobile&&!document.hidden&&document.activeElement===document.body)prompt.focus();
}}
prompt.addEventListener('input',()=>{if(busy&&pauseTyping.checked)controller?.abort();});
$('composer').addEventListener('submit',e=>{e.preventDefault();ask();});
prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){
e.preventDefault();
ask();
}});
document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{prompt.value=b.dataset.q||'';ask();});
$('new').onclick=()=>{if(busy)
return;releaseModel?.();state=fresh();history.length=0;localStorage.removeItem('modular-chat-state');messages.replaceChildren();welcome();};
$('save').onclick=()=>{try{
engine.configure($('cdn').value.trim());
$('status').textContent=engine.cdn?'CDN configured':'Site CDN selected';
}
catch(e){
$('status').textContent=String(e);
}};
$('clear').onclick=async()=>{if(busy)
return;releaseModel?.();await engine.clear();stats();};
$('clear-learned').onclick=async()=>{if(busy||!confirm('Delete learned concepts from this browser?'))return;const m=await import('./safe-chat-v11.js');$('status').textContent=await m.clearLearned()?'Learned knowledge cleared':'Session cleared; persistent storage unavailable';};
function welcome(){bubble('assistant','Hi! Ask “Where is MRPL?” for a source-backed answer without an LLM. Enable Public knowledge lookup for unfamiliar public entities. Neural inference is disabled on mobile in this release.');}
welcome();
(async()=>{try{
await engine.init();
ready=true;
send.disabled=false;
$('status').textContent='Ready · on-device';
$('core').textContent=engine.manifest.coreBytes.toLocaleString()+' B startup JS';
$('cdn').value=engine.cdn;
stats();
if('serviceWorker'in navigator)
navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
catch(e){
$('status').textContent='Startup error: '+String(e);
}})();
