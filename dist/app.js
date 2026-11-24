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
const messages=$('messages'),prompt=$('prompt'),send=$('send');
function bubble(role,text,result){const el=document.createElement('article');el.className='bubble '+role;const label=document.createElement('small');label.textContent=role==='user'?'You':'Modular AI';const body=document.createElement('div');body.textContent=text;el.append(label,body);if(result){
const meta=document.createElement('details');
const sum=document.createElement('summary');
sum.textContent='Response details';
const d=document.createElement('p');
d.textContent=result.detail+' · '+result.verified;
meta.append(sum,d);
if(result.source&&/^https?:\/\//.test(result.source)){
const a=document.createElement('a');
a.href=result.source;
a.target='_blank';
a.rel='noopener noreferrer';
a.textContent='Source';
meta.append(a);
}
el.append(meta);
}messages.append(el);el.scrollIntoView({block:'end',behavior:'smooth'});return el;}
function stats(){$('metrics').textContent='Downloaded '+engine.downloaded.toLocaleString()+' B · '+engine.cacheHits+' cache hits · '+[...engine.memory.values()].reduce((s,b)=>s+b.byteLength,0).toLocaleString()+' B resident';}
engine.onEvent=e=>{const item=document.createElement('li');item.textContent=e.label+' — '+e.detail+(e.bytes?' · '+e.bytes+' B':'');$('trace').prepend(item);while($('trace').children.length>30)
$('trace').lastChild?.remove();stats();};
async function ask(){const q=prompt.value.trim();if(!ready||busy||!q)
return;if(q.length>20000){
$('status').textContent='Maximum 20,000 characters';
return;
}busy=true;send.disabled=true;prompt.value='';bubble('user',q);const wait=bubble('assistant','Thinking…');$('status').textContent='Processing locally';try{
const r=await respond(engine,state,q);
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
bubble('assistant','I could not complete that request: '+(e instanceof Error?e.message:String(e)));
}
finally{
busy=false;
send.disabled=false;
$('status').textContent='Ready · on-device';
stats();
prompt.focus();
}}
$('composer').addEventListener('submit',e=>{e.preventDefault();ask();});
prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){
e.preventDefault();
ask();
}});
document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{prompt.value=b.dataset.q||'';ask();});
$('new').onclick=()=>{if(busy)
return;state=fresh();localStorage.removeItem('modular-chat-state');messages.replaceChildren();welcome();};
$('save').onclick=()=>{try{
engine.configure($('cdn').value.trim());
$('status').textContent=engine.cdn?'CDN configured':'Site CDN selected';
}
catch(e){
$('status').textContent=String(e);
}};
$('clear').onclick=async()=>{if(busy)
return;await engine.clear();stats();};
function welcome(){bubble('assistant','Hi! I’m Modular AI. Ask me to calculate, convert units, summarize text or explain a topic. I can remember facts you teach me and follow simple numerical steps. I’m a small experimental AI, not a general-purpose LLM.');}
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
