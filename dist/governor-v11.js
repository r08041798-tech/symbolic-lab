export function createGovernor({now=()=>performance.now(),interval=setInterval,clear=clearInterval,onStop=()=>{},signal,deadline=25000,lag=350,period=250}={}){
 let last=now(),start=last,strikes=0,closed=false,timer;
 const stop=()=>{if(closed)return;closed=true;clear(timer);signal?.removeEventListener('abort',stop);};
 timer=interval(()=>{const t=now(),delay=t-last-period;last=t;strikes=delay>lag?strikes+1:0;if(t-start>=deadline||strikes>=2||delay>1500){const reason=t-start>=deadline?'Neural time budget exceeded':'Browser responsiveness deteriorated';stop();onStop(reason);}},period);
 signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
 return stop;
}
export function permitNeural(mode,q,mobile,enabled){
 if(mode==='indexed'||mode==='original')return false;
 if(!enabled||mobile)return false;
 if(mode==='sparse')return /^continue\s*:/i.test(q.trim());
 // Only explicit creative or conversational requests; factual unknowns never fall through.
 return /^(?:write|draft|compose|create|continue)\s+(?:me\s+)?(?:a|an|the|this|my)?\s*(?:story|poem|email|letter|message|dialogue|fiction)\b/i.test(q.trim())||/^(?:let'?s chat|chat with me|tell me a joke)\b/i.test(q.trim());
}
