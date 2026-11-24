const units={m:['length',1],km:['length',1000],cm:['length',.01],mm:['length',.001],mi:['length',1609.344],ft:['length',.3048],in:['length',.0254],kg:['mass',1],g:['mass',.001],lb:['mass',.45359237],oz:['mass',.028349523125],l:['volume',1],ml:['volume',.001],mph:['speed',.44704],kph:['speed',1/3.6],c:['temp',1],f:['temp',1],k:['temp',1]};
const aliases={meters:'m',meter:'m',metres:'m',metre:'m',kilometers:'km',kilometer:'km',miles:'mi',mile:'mi',feet:'ft',foot:'ft',inches:'in',inch:'in',pounds:'lb',pound:'lb',lbs:'lb',grams:'g',gram:'g',kilograms:'kg',kilogram:'kg',litres:'l',litre:'l',liters:'l',liter:'l',celsius:'c',fahrenheit:'f',kelvin:'k'};
export async function run(input){const m=input.toLowerCase().match(/^\s*(?:convert\s+)?(-?\d+(?:\.\d+)?)\s*°?([a-z]+)\s+(?:to|in)\s+°?([a-z]+)\s*[?]?\s*$/);if(!m)
throw Error('Use a format such as “convert 10 km to miles”.');const n=Number(m[1]),a=aliases[m[2]]||m[2],b=aliases[m[3]]||m[3];const u=units[a],v=units[b];if(!u||!v||u[0]!==v[0])
throw Error('Unsupported or incompatible units.');let result;if(u[0]==='temp'){
const c=a==='f'?(n-32)*5/9:a==='k'?n-273.15:n;
if(c<-273.15-1e-9)
throw Error('Temperature below absolute zero.');
result=b==='f'?c*9/5+32:b==='k'?c+273.15:c;
}
else
result=n*u[1]/v[1];if(!Number.isFinite(result))
throw Error('Non-finite result.');return{answer:`${n} ${a} = ${Number(result.toPrecision(10))} ${b}`,detail:'Converted using stored unit factors or temperature equations.',verified:'Compatible dimensions and finite result checked.'};}
