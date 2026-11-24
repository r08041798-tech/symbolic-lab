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
}busy=true;controller=new AbortController();stop.hidden=false;send.disabled=true;mode.disabled=true;prompt.value='';bubble('user',q);const wait=bubble('assistant','Thinking…');$('status').textContent='Processing locally';try{
const modulePath='./conversation-v04.js';const {chat}=await import(modulePath);let streamed='';const r=await chat(engine,state,history,q,mode.value,text=>{$('status').textContent=text;},text=>{streamed+=text;const body=wait.querySelector('div');if(body)body.textContent=streamed;},controller.signal);if(r.detail!=='Stopped by user')history.push({role:'user',content:q},{role:'assistant',content:r.answer});if(history.length>24)history.splice(0,history.length-24);
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
bubble('assistant','The local model or skill could not complete that request. Try the Original mode or a smaller model. Details: '+(e instanceof Error?e.message:String(e)));
}
finally{
busy=false;
controller=null;
stop.hidden=true;
send.disabled=false;
mode.disabled=false;
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
return;state=fresh();history.length=0;localStorage.removeItem('modular-chat-state');messages.replaceChildren();welcome();};
$('save').onclick=()=>{try{
engine.configure($('cdn').value.trim());
$('status').textContent=engine.cdn?'CDN configured':'Site CDN selected';
}
catch(e){
$('status').textContent=String(e);
}};
$('clear').onclick=async()=>{if(busy)
return;await engine.clear();stats();};
function welcome(){bubble('assistant','Hi! What would you like to talk about? Simple greetings and built-in skills work instantly. Other messages may need a local model download. You can stop a reply anytime.');}
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
