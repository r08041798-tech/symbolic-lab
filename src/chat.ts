import {Engine,type Result} from './engine.js';
export type ChatState={name:string;topic:string;number:string;last:string;facts:Record<string,string>};
export const fresh=():ChatState=>({name:'',topic:'',number:'',last:'',facts:{}});
const result=(answer:string,detail='Conversation state',verified='Local response')=>({answer,detail,verified});
export function normalize(q:string){return q.trim().replace(/[×]/g,'*').replace(/[÷]/g,'/').replace(/^what is\s+(?=[\d(])/i,'').replace(/^how much is\s+/i,'').replace(/\bmultiplied by\b/gi,'*').replace(/\bdivided by\b/gi,'/').replace(/\bplus\b/gi,'+').replace(/\bminus\b/gi,'-');}
export async function respond(engine:Pick<Engine,'ask'>,state:ChatState,raw:string):Promise<Result>{const q=raw.trim(), lower=q.toLowerCase();let m:RegExpMatchArray|null;
 if((m=q.match(/^(?:my name is|call me)\s+(.{1,60})[.!]?$/i))){state.name=m[1].replace(/[.!]+$/,'');return result('Nice to meet you, '+state.name+'. I can remember that on this device.');}
 if(/^(?:what(?: is|'s) my name|do you remember my name)\??$/i.test(q))return result(state.name?'Your name is '+state.name+'.':'You have not told me your name yet.');
 if((m=q.match(/^remember(?: that)?\s+(.{1,80}?)\s+is\s+(.{1,300})$/i))){state.facts[m[1].toLowerCase()]=m[2];return result('Saved: '+m[1]+' is '+m[2]+'.','User-provided memory','Not independently verified');}
 if((m=q.match(/^(?:what is|what's|recall)\s+(.+?)\??$/i))&&Object.hasOwn(state.facts,m[1].toLowerCase()))return result(state.facts[m[1].toLowerCase()],'User-provided memory','Not independently verified');
 if(/^(hi|hello|hey|good morning|good evening)[!. ]*$/i.test(q))return result('Hello'+(state.name?', '+state.name:'')+'! I can calculate, convert units, summarize text and explain topics in my knowledge pack. What shall we try?');
 if(/^(thanks|thank you|great|cool)[!. ]*$/i.test(q))return result('You’re welcome!');
 if(/^(what can you do|help|who are you|what are you)\??$/i.test(q))return result('I am Modular AI, a small independent TypeScript prototype. I load skills and knowledge only when needed, keep memory locally, and do not use external AI APIs. I am not yet a general-purpose language model.');
 if(/^(?:say that again|repeat|repeat that)\??$/i.test(q))return result(state.last||'There is nothing to repeat yet.');
 if(/^(?:explain more|tell me more|more details|what about that|how does it work)\??$/i.test(q)){if(!state.topic)return result('Which topic would you like to explore?');return engine.ask('Explain '+state.topic);}
 if((m=q.match(/^(?:now |then )?(?:multiply|divide|add|subtract)(?: it| that)?\s+(?:by |to |from )?(-?\d+(?:\.\d+)?)\??$/i))){if(!state.number)return result('I need a previous numerical result first.');const op=lower.match(/multiply|divide|add|subtract/)![0];return calculate(state.number+({multiply:'*',divide:'/',add:'+',subtract:'-'}[op]!)+m[1]);}
 async function calculate(s:string){const r=await engine.ask(s);const n=r.answer.match(/ = (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i);if(n)state.number=n[1];return r;}
 const chain=q.match(/^(?:calculate\s+)?([\d.()+*/%^-][\d.()+*/%^\s-]*)\s+then\s+convert\s+(?:the result\s+)?([a-z]+)\s+to\s+([a-z]+)\??$/i);if(chain){const first=await calculate(chain[1]);if(!state.number||!first.answer.includes(' = '))return first;const second=await engine.ask('convert '+state.number+' '+chain[2]+' to '+chain[3]);return {...second,answer:first.answer+'\n'+second.answer,detail:'Two-step plan: arithmetic → conversion. '+second.detail};}
 const normalized=normalize(q);const out=await calculate(normalized);if(out.detail.startsWith('Retrieved: '))state.topic=out.detail.slice(11);state.last=out.answer;return out;
}
