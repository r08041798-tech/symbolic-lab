export function tokens(s){return(s.toLowerCase().match(/[a-z0-9]+/g)||[]).filter(x=>!['a','an','the','is','of','to','in','it','and','what','please','me','for','how','does','can','you'].includes(x));}
export class Router{
examples;
constructor(examples){
this.examples=examples;
}
rank(text){
const counts=new Map();
const totals=new Map();
const vocabulary=new Set();
for(const e of this.examples){
if(!counts.has(e.skill))
counts.set(e.skill,new Map());
const c=counts.get(e.skill);
for(const t of tokens(e.text)){
vocabulary.add(t);
c.set(t,(c.get(t)||0)+1);
totals.set(e.skill,(totals.get(e.skill)||0)+1);
}
}
const words=tokens(text).filter(t=>vocabulary.has(t));
if(!words.length)
return[];
const log=[...counts].map(([id,c])=>({id,score:words.reduce((s,t)=>s+Math.log(((c.get(t)||0)+1)/((totals.get(id)||0)+vocabulary.size)),0)}));
const max=Math.max(...log.map(x=>x.score));
const sum=log.reduce((s,x)=>s+Math.exp(x.score-max),0);
return log.map(x=>({id:x.id,score:Math.exp(x.score-max)/sum})).sort((a,b)=>b.score-a.score);
}
}
export function choose(text,router){
if(/^\s*(?:(?:calculate|compute|solve|evaluate)\s+)?[\d.()+*/%^\s-]+[?]?\s*$/i.test(text)&&/\d/.test(text))
return{id:'math',reason:'Arithmetic syntax',score:null};
if(/^(?:summari[sz]e|summary\s*[:]|condense)\b/i.test(text))
return{id:'summary',reason:'Explicit summarization request',score:null};
if(/\b(?:convert|conversion)\b/i.test(text)||/\d\s*(?:km|cm|kg|lb|lbs|miles?|feet|ft|meters?|metres?|celsius|fahrenheit|°[cf]|kph|mph)\s+(?:to|in)\s+/i.test(text))
return{id:'units',reason:'Unit conversion syntax',score:null};
if(/^(?:explain|define|what (?:is|are)|tell me about)\b/i.test(text))
return{id:'knowledge',reason:'Explicit knowledge request',score:null};
const ranks=router.rank(text);
const best=ranks[0];
if(!best||best.score<0.48||best.score-(ranks[1]?.score||0)<0.12)
return{id:'unknown',reason:'Insufficient routing evidence',score:best?.score??null};
return{id:best.id,reason:'Learned token classifier',score:best.score};
}
