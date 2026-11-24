export function profileFor(mode,mobile=false){
 if(mode==='lite')return {context:1000,turns:2,tokens:40,detailTokens:64,idle:15000,timeout:25000,device:'wasm'};
 if(mobile)return {context:1800,turns:4,tokens:64,detailTokens:96,idle:25000,timeout:35000,device:'auto'};
 return {context:4800,turns:8,tokens:112,detailTokens:192,idle:60000,timeout:45000,device:'auto'};
}
export function limitHistory(history,q,profile){
 let available=Math.max(0,profile.context-q.length),selected=[];
 for(const h of history.slice(-profile.turns).reverse()){if(!['user','assistant'].includes(h.role))continue;if(h.content.length>available)break;selected.unshift({role:h.role,content:h.content});available-=h.content.length;}
 while(selected[0]?.role==='assistant')selected.shift();return selected;
}
export function budgetFor(q,profile){
 const detail=/(?:in detail|detailed|step.by.step|write (?:a|an)|draft|code|essay|story)/i.test(q);
 return detail?profile.detailTokens:Math.min(profile.tokens,q.trim().split(/\s+/).length<=3?32:profile.tokens);
}
