export function parseQuery(input){
 const q=String(input).toLowerCase().replace(/(\d),(?=\d{3}\b)/g,"$1").replace(/−/g,"-").replace(/\bkilowatt.hours?\b/g,"kwh").replace(/\bwatt.hours?\b/g,"wh").replace(/\bkilomet(?:er|re)s?\b/g,"km").replace(/\bkm\s+per\s+hour\b/g,"km/h").replace(/\bwh\s+per\s+km\b/g,"wh/km").replace(/\bkm\s+per\s+lit(?:er|re)\b/g,"km/l").replace(/\bkmpl\b/g,"km/l");
 const facts={},duplicates=[],errors=[];
 function add(name,value,unit,source){if(!Number.isFinite(value)){errors.push("Invalid "+name);return;}if(Object.hasOwn(facts,name)&&facts[name].value!==value){duplicates.push(name);return;}facts[name]={value,unit,weight:1,source};}
 function extract(name,re,unit,scale=1){for(const m of q.matchAll(re))add(name,Number(m[1])*scale,unit,m[0].trim());}
 const num="(-?\\d+(?:\\.\\d+)?)",re=(tail)=>new RegExp(num+"\\s*"+tail,"g");
 let domain,goals;
 if(/\b(?:ev|electric car|electric vehicle|battery|kwh)\b/.test(q)&&(/\b(?:wh\/km|consumption|range|travel|drive|distance)\b/.test(q))&&!/\bsolar\b/.test(q)){
 domain="ev";extract("capacity",re("kwh(?!\\s*\\/)\\b"),"kWh");extract("consumption",re("wh\\s*\\/\\s*km\\b"),"Wh/km");extract("consumption",re("kwh\\s*\\/\\s*100\\s*km\\b"),"Wh/km",10);extract("distance",re("km(?!\\s*\\/)\\b"),"km");
 // 100 km in the consumption denominator is not a journey length.
 const d=[...q.replace(/\d+(?:\.\d+)?\s*kwh\s*\/\s*100\s*km\b/g,"").matchAll(re("km(?!\\s*\\/)\\b"))];
 delete facts.distance;for(let i=duplicates.length-1;i>=0;i--)if(duplicates[i]==="distance")duplicates.splice(i,1);for(const m of d)add("distance",Number(m[1]),"km",m[0]);
 goals=/\b(?:need|required|how much battery|battery size)\b/.test(q)&&!/\b(?:can|will|possible|enough)\b/.test(q)?["required"]:facts.distance?["range","required","margin"]:["range"];
 }else if(/\bsolar\b/.test(q)&&/\b(?:kw|hours?|sun|generation|generate|output|energy)\b/.test(q)&&/\d/.test(q)){
 domain="solar";extract("power",re("kw(?!h)\\b"),"kW");extract("sun",re("(?:peak[- ]sun|full[- ]sun|sunlight|sun)?\\s*(?:hours?|hrs?|h)\\b"),"h");extract("efficiency",re("%"),"%");goals=["ideal",...(facts.efficiency?["energy"]:[])];
 }else if(/\b(?:compound|compounding|compound interest)\b/.test(q)&&/\d/.test(q)){
 domain="compound";extract("principal",re("(?:rupees|inr|dollars|usd|currency units)\\b"),"currency units");for(const m of q.matchAll(/(?:principal|invest(?:ed|ment)?|amount|₹|\$|rs\.?)\s*[:=]?\s*(?:₹|\$|rs\.?)?\s*(-?\d+(?:\.\d+)?)/g))add("principal",Number(m[1]),"currency units",m[0]);extract("rate",re("%"),"%");extract("years",re("(?:years?|yrs?)\\b"),"years");const frequencies=[[/\bmonthly\b/,12],[/\bquarterly\b/,4],[/\b(?:annually|annual compounding|yearly|once a year)\b/,1],[/\bhalf[- ]yearly\b/,2]];for(const [p,n] of frequencies)if(p.test(q))add("periods",n,"per year",p.source);goals=["amount","interest"];
 }else if(/\b(?:fuel|petrol|diesel|mileage|fuel cost)\b/.test(q)&&/\d/.test(q)){
 domain="fuel";extract("distance",re("km(?!\\s*\\/)\\b"),"km");extract("mileage",re("km\\s*\\/\\s*l\\b"),"km/L");extract("price",re("(?:rupees|inr|rs\\.?|₹|dollars|usd)?\\s*(?:per|\\/)\\s*(?:lit(?:er|re)|l)\\b"),"currency units/L");goals=/\b(?:cost|price|spend|expense)\b/.test(q)||facts.price?["litres","cost"]:["litres"];
 }else if(/\b(?:speed|distance|travel|drive|journey|km\/h|how far|how long|how fast)\b/.test(q)&&/\d/.test(q)){
 domain="travel";extract("distance",re("km(?!\\s*\\/)\\b"),"km");extract("speed",re("km\\s*\\/\\s*h\\b"),"km/h");extract("time",re("(?:hours?|hrs?|h)\\b"),"h");extract("time",re("(?:minutes?|mins?)\\b"),"h",1/60);const missing=["distance","speed","time"].filter(x=>!facts[x]);goals=/\b(?:how long|how much time|travel time)\b/.test(q)?["time"]:/\b(?:how fast|what speed|average speed)\b/.test(q)?["speed"]:/\b(?:how far|what distance|distance covered)\b/.test(q)?["distance"]:missing.length===1?missing:[];
 if(!goals.length)return null;
 }else return null;
 for(const [key,f] of Object.entries(facts)){if(f.value<0||(["consumption","speed","mileage","time","periods"].includes(key)&&f.value<=0)||key==="efficiency"&&f.value>100)errors.push("Invalid "+key+" ("+f.value+" "+f.unit+")");}
 // Reject mixed or ambiguous quantities rather than silently choosing.
 if(domain==="ev"&&/\b(?:miles|mph|mileage|km\/kwh)\b/.test(q))errors.push("Use supported EV units: kWh, Wh/km or kWh/100 km, and km.");
 return {domain,goals,facts,duplicates:[...new Set(duplicates)],errors};
}
export function evaluate(expr,facts){
 if(typeof expr==="number"){if(!Number.isFinite(expr))throw Error("Non-finite constant");return expr;}
 if(expr&&typeof expr.ref==="string"){if(!Object.hasOwn(facts,expr.ref))throw Error("Missing "+expr.ref);return facts[expr.ref].value;}
 const a=expr?.args?.map(x=>evaluate(x,facts));if(!a||a.length!==2)throw Error("Invalid expression");
 const [x,y]=a;let z;
 switch(expr.op){case "+":z=x+y;break;case "-":z=x-y;break;case "*":z=x*y;break;case "/":if(y===0)throw Error("Division by zero");z=x/y;break;case "^":z=x**y;break;default:throw Error("Unsupported operator");}
 if(!Number.isFinite(z))throw Error("Non-finite result");return z;
}
export function planQuery(graph,query,metrics={},weights={accuracy:0.75,cost:0.25}){
 const known=new Set(Object.keys(query.facts));const candidates=[];
 const scoreRule=r=>{const m=metrics[r.id]||{};const verified=m.checked||0;const valid=m.valid||0;const quality=verified?Math.min(r.weight,(valid+2)/(verified+2)):r.weight;return {quality,cost:r.cost};};
 function plans(goal,seen,depth){
 if(known.has(goal))return [{rules:[],quality:query.facts[goal].weight,cost:0}];
 if(depth>8||seen.has(goal))return [];
 const next=new Set([...seen,goal]),out=[];
 for(const r of graph.rules.filter(r=>r.output===goal)){
 let combined=[{rules:[],quality:1,cost:0}];for(const input of r.inputs){const paths=plans(input,next,depth+1);combined=combined.flatMap(a=>paths.map(b=>({rules:[...new Map([...a.rules,...b.rules].map(x=>[x.id,x])).values()],quality:Math.min(a.quality,b.quality),cost:0}))).slice(0,32);if(!combined.length)break;}
 for(const c of combined){const unique=[...new Map([...c.rules,r].map(x=>[x.id,x])).values()];const info=unique.map(scoreRule);out.push({rules:unique,quality:Math.min(c.quality,...info.map(x=>x.quality)),cost:info.reduce((n,x)=>n+x.cost,0)});}
 }
 return out.slice(0,32);
 }
 let merged=[{rules:[],quality:1,cost:0}];const missing=[];
 for(const goal of query.goals){const alternatives=plans(goal,new Set(),0);if(!alternatives.length){missing.push(goal);continue;}merged=merged.flatMap(a=>alternatives.map(b=>{const rules=[...new Map([...a.rules,...b.rules].map(r=>[r.id,r])).values()];return {rules,quality:Math.min(a.quality,b.quality),cost:rules.reduce((n,r)=>n+r.cost,0)};})).slice(0,64);}
 for(const m of merged){const score=weights.accuracy*m.quality-weights.cost*m.cost/(m.cost+5);candidates.push({...m,score});}
 candidates.sort((a,b)=>b.score-a.score||a.cost-b.cost);
 return {...candidates[0],missing,alternatives:candidates.length,goals:query.goals};
}
export function executePlan(graph,query,plan){
 const facts={...query.facts},steps=[];
 for(const r of plan.rules){const value=evaluate(r.expr,facts);const weight=Math.min(r.weight,...r.inputs.map(x=>facts[x].weight));facts[r.output]={value,unit:graph.slots[r.output],weight,source:r.id};steps.push({id:r.id,inputs:r.inputs.map(x=>({name:x,value:facts[x].value,unit:facts[x].unit})),output:r.output,value,unit:graph.slots[r.output],formula:r.formula,weight});}
 return {facts,steps};
}
export function verifyPlan(graph,query,execution){
 // Independently re-evaluate applicable alternative formulas and dimensional/domain invariants.
 const f=execution.facts,checks=[];const near=(a,b)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
 function check(label,pass,ids=[]){checks.push({label,pass,ids});}
 for(const s of execution.steps){check("Finite "+s.output,Number.isFinite(s.value),[]);}
 if(query.domain==="ev"){if(f.range&&f.capacity&&f.consumption)check("range × consumption = stored Wh",near(f.range.value*f.consumption.value,f.capacity.value*1000),["ev.range"]);if(f.required&&f.distance&&f.consumption)check("energy × 1000 = distance × consumption",near(f.required.value*1000,f.distance.value*f.consumption.value),["ev.required"]);if(f.margin&&f.range&&f.distance)check("margin + distance = range",near(f.margin.value+f.distance.value,f.range.value),["ev.margin","ev.margin-alternative"]);}
 if(query.domain==="travel"&&f.speed&&f.time&&f.distance)check("distance = speed × time",near(f.distance.value,f.speed.value*f.time.value),["travel.distance","travel.time","travel.speed"]);
 if(query.domain==="solar"){if(f.ideal)check("ideal output = power × sun hours",near(f.ideal.value,f.power.value*f.sun.value),["solar.ideal"]);if(f.energy)check("output ≤ ideal and ratio matches performance",f.energy.value>=0&&f.energy.value<=f.ideal.value+1e-8&&near(f.energy.value*100,f.ideal.value*f.efficiency.value),["solar.energy","solar.energy-direct"]);}
 if(query.domain==="compound"&&f.amount&&f.interest)check("amount = principal + interest",near(f.amount.value,f.principal.value+f.interest.value),["compound.interest"]);
 if(query.domain==="fuel"){if(f.litres)check("litres × mileage = distance",near(f.litres.value*f.mileage.value,f.distance.value),["fuel.litres"]);if(f.cost)check("cost ÷ litres = price (or zero fuel)",near(f.cost.value,f.litres.value*f.price.value),["fuel.cost"]);}
 return checks;
}
export function formatResult(graph,query,plan,execution,checks){
 const f=execution.facts;const fmt=x=>Number(x.toPrecision(7)).toLocaleString("en-IN",{maximumFractionDigits:6});const lines=[];
 if(query.domain==="ev"&&f.margin&&f.range&&f.distance)lines.push((f.margin.value>=-1e-9?"Yes, theoretically.":"No, not under those assumptions.")+" Estimated range: "+fmt(f.range.value)+" km. Required distance: "+fmt(f.distance.value)+" km.");
 for(const goal of query.goals){if(f[goal])lines.push(goal.charAt(0).toUpperCase()+goal.slice(1)+": "+fmt(f[goal].value)+" "+f[goal].unit+".");}
 if(plan.missing.length)lines.push("I cannot derive "+plan.missing.join(", ")+" from the supplied inputs. Please provide the missing values.");
 if(query.domain==="solar"&&!f.efficiency)lines.push("This is ideal production before losses; provide a system performance percentage for an adjusted estimate.");
 lines.push("Assumption: "+graph.assumptions.join(" "));
 return lines.join("\n\n");
}
import * as indexed from './indexed-v06.js';
const KEY='modular-ai-rule-checks-v07';
const readMetrics=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{return {};}};
function updateMetrics(metrics,checks,steps){const executed=new Set(steps.map(s=>s.id));for(const c of checks){for(const id of c.ids.filter(x=>executed.has(x))){const m=metrics[id]||{checked:0,valid:0};m.checked++;if(c.pass)m.valid++;metrics[id]=m;}}try{localStorage.setItem(KEY,JSON.stringify(metrics));}catch{}}
const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
export async function chat(engine,state,history,q,mode,progress,token,signal,mobile){
 if(signal?.aborted)throw Error('Stopped');
 const query=parseQuery(q);
 if(!query)return indexed.chat(engine,state,history,q,mode,progress,token,signal,mobile);
 const emit=(label,detail,bytes)=>engine.onEvent?.({label,detail,...(bytes===undefined?{}:{bytes})});
 emit('Query parsed',query.domain+' → '+query.goals.join(', '));state.indexedTopic='';
 const out=(answer,detail,verified,plan)=>({answer,detail,verified,plan});
 if(query.errors.length||query.duplicates.length)return out('Please clarify the inputs: '+[...query.errors,...query.duplicates.map(x=>'multiple values for '+x)].join('; ')+'.','Query validation','Abstained: ambiguous or invalid input.',{status:'clarify',inputs:query.facts});
 const index=decode(await engine.load(engine.manifest.reasoning));if(signal?.aborted)throw Error('Stopped');
 const entry=index.domains.find(x=>x.id===query.domain);if(!entry)throw Error('Unknown reasoning domain.');
 const graph=decode(await engine.load(entry.resource));if(signal?.aborted)throw Error('Stopped');
 const metrics=readMetrics();const plan=planQuery(graph,query,metrics);
 emit('Weighted plan',plan.rules.map(r=>r.id).join(' → ')||'no derivation',entry.resource.bytes);
 if(!plan.rules.length&&plan.missing.length)return out('I need more information to calculate '+plan.missing.join(', ')+'. Supported inputs: '+Object.entries(graph.slots).filter(([k])=>!query.facts[k]&&!query.goals.includes(k)).map(([k,u])=>k+' ('+u+')').join(', ')+'.','Query planner · missing inputs','Abstained rather than guessing.',{status:'clarify',inputs:query.facts,missing:plan.missing});
 let execution;try{execution=executePlan(graph,query,plan);}catch(e){return out('I could not derive a finite result from those inputs. '+e.message,'Execution stopped','Abstained: calculation failed.',{status:'failed',inputs:query.facts});}
 const checks=verifyPlan(graph,query,execution);updateMetrics(metrics,checks,execution.steps);
 const valid=checks.every(c=>c.pass);
 const evidence={status:valid?(plan.missing.length?'partial':'derived'):'failed',domain:entry.label,inputs:query.facts,steps:execution.steps,checks,missing:plan.missing,alternatives:plan.alternatives,estimatedCost:plan.cost,routeScore:plan.score,weakestWeight:plan.quality,assumptions:graph.assumptions};
 emit('Verification',checks.filter(c=>c.pass).length+'/'+checks.length+' consistency checks');
 if(!valid)return out('The calculation failed a consistency check. I am withholding the result.','Verification failed','Abstained: inconsistency detected.',evidence);
 return out(formatResult(graph,query,plan,execution,checks),'Weighted query plan · '+entry.label+' · no generative model','Formula and consistency checks only; real-world accuracy depends on inputs and assumptions.',evidence);
}
export const releaseModel=indexed.releaseModel;
