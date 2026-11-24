export async function run(input){
const s=input.trim().replace(/^(calculate|compute|solve|evaluate)\s+/i,'').replace(/\?$/,'').trim();
const parts=s.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/%^]|[^\s]/g)||[];
let i=0;
if(parts.length>200)
throw Error('Expression too long.');
function atom(){const t=parts[i++];if(t==='('){
const x=expr(0);
if(parts[i++]!==')')
throw Error('Missing closing parenthesis.');
return x;
}if(t==='-'||t==='+')
return(t==='-'?-1:1)*expr(3);if(t&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t))
return Number(t);throw Error('Expected a number or parenthesis.');}
const precedence={'+':1,'-':1,'*':2,'/':2,'%':2,'^':4};
function expr(min){let x=atom();while(i<parts.length){
const op=parts[i];
const p=precedence[op];
if(p===undefined||p<min)
break;
i++;
const y=expr(p+(op==='^'?0:1));
switch(op){
case'+':
x+=y;
break;
case'-':
x-=y;
break;
case'*':
x*=y;
break;
case'/':
x/=y;
break;
case'%':
x%=y;
break;
case'^':
x=x**y;
break;
}
}return x;}
const value=expr(0);
if(i!==parts.length||!Number.isFinite(value))
throw Error('Unsupported expression or non-finite result.');
return{answer:`${s} = ${value}`,detail:'Parsed arithmetic with operator precedence. Uses JavaScript double precision; no eval.',verified:'Syntax and finite result checked; no independent proof.'};
}
