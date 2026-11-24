import {normalize,findRecord} from './routing-v09.js';
const DB='modular-ai-knowledge-v09',STORE='concepts',LIMIT=256;
let pending;const session=new Map();
function open(){
 if(!pending)pending=new Promise((resolve,reject)=>{
 if(typeof indexedDB==='undefined'){reject(Error('IndexedDB unavailable'));return;}
 const r=indexedDB.open(DB,1);
 r.onupgradeneeded=()=>{const s=r.result.createObjectStore(STORE,{keyPath:'id'});s.createIndex('aliases','aliases',{multiEntry:true});};
 r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{db.close();pending=null;};resolve(db);};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Storage blocked'));
 }).catch(e=>{pending=null;throw e;});return pending;
}
function tx(db,mode,action){return new Promise((resolve,reject)=>{const t=db.transaction(STORE,mode),s=t.objectStore(STORE);let value;t.oncomplete=()=>resolve(value);t.onabort=t.onerror=()=>reject(t.error||Error('Storage failed'));action(s,x=>{value=x;});});}
export async function lookup(topic){
 const key=normalize(topic);let rows=[];try{rows=await tx(await open(),'readonly',(s,done)=>{const r=s.index('aliases').getAll(key,LIMIT);r.onsuccess=()=>done(r.result);});}catch{}
 return findRecord([...new Map([...rows,...[...session.values()].filter(r=>r.aliases.includes(key))].map(r=>[r.id,r])).values()],key);
}
export async function save(record){
 try{
 const saved=await tx(await open(),'readwrite',(s,done)=>{const g=s.get(record.id);g.onsuccess=()=>{if(g.result){done(g.result);return;}const c=s.count();c.onsuccess=()=>{if(c.result>=LIMIT){done(null);return;}s.add(record);done(record);};};});
 if(saved)session.delete(saved.id);return {record:saved,persistent:true};
 }catch{if(session.size>=LIMIT&&!session.has(record.id))return {record:null,persistent:false};if(!session.has(record.id))session.set(record.id,record);return {record:session.get(record.id),persistent:false};}
}
export async function list(){
 let rows=[];try{rows=await tx(await open(),'readonly',(s,done)=>{const r=s.getAll(undefined,LIMIT);r.onsuccess=()=>done(r.result);});}catch{}
 return [...new Map([...rows,...session.values()].map(r=>[r.id,r])).values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export async function clear(){session.clear();try{await tx(await open(),'readwrite',(s,done)=>{s.clear();done(true);});return true;}catch{return false;}}
