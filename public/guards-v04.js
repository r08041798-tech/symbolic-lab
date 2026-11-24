export function quickReply(input,state,history){
 const q=input.trim().toLowerCase().replace(/[.!?]+$/,'').trim();
 const name=state.name?', '+state.name:'';
 if(/^(hi|hello|hey|he|hii+|helo|helloo+|good morning|good evening|good afternoon)$/.test(q))return q==='he'?'Hi! Did you mean hello, or were you starting a sentence?':'Hi'+name+'! How can I help?';
 if(/^(i|you|she|they|we|it|the|a|an|and|but|because|my|what|why|how|where|when|who|can|could|would|should)$/.test(q))return 'Could you finish your thought so I can help?';
 if(/^(thanks|thank you|thx|ty)$/.test(q))return 'You’re welcome'+name+'!';
 if(/^(bye|goodbye|see you)$/.test(q))return 'See you later'+name+'!';
 if(/^(how are you|how are u|how r u|how are you doing)$/.test(q))return 'I’m ready to help! How are you doing?';
 if(/^(ok|okay|sure|yes|no|hmm|right|alright)$/.test(q)&&!history.length)return 'Got it. What would you like to talk about?';
 return null;
}
export function tokenBudget(q){if(/(?:in detail|detailed|step.by.step|write (?:a|an)|draft|code|essay|story)/i.test(q))return 192;if(q.trim().split(/\s+/).length<=3)return 48;return 112;}
export function inspectOutput(text){
 const marker=text.search(/<\|(?:im_end|im_start|endoftext|eot_id|end)\|>|(?:^|\n)\s*(?:User|Human|Assistant)\s*:/i);
 if(marker>=0)return {stop:true,text:text.slice(0,marker).trim()};
 if(text.length>=1600)return {stop:true,text:text.slice(0,1600).trim()};
 const words=[...text.matchAll(/\S+/g)];const n=words.length;
 for(let k=1;k<=Math.min(24,Math.floor(n/3));k++){
   const a=words.slice(n-3*k,n-2*k).map(w=>w[0].toLowerCase()).join(' ');
   const b=words.slice(n-2*k,n-k).map(w=>w[0].toLowerCase()).join(' ');
   const c=words.slice(n-k).map(w=>w[0].toLowerCase()).join(' ');
   if(a===b&&b===c)return {stop:true,text:text.slice(0,words[n-2*k].index).trim()};
 }
 return {stop:false,text};
}
