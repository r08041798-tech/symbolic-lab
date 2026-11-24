import test from 'node:test';import assert from 'node:assert/strict';import {compile,resolve,choosePage,locationExcerpt} from '../dist/factual-v11.js';import {permitNeural} from '../dist/governor-v11.js';
test('MRPL regression',async()=>{const r=await resolve(compile('Where is mrpl?'));assert.match(r.answer,/Mangaluru/);assert.equal(r.evidence.modelWeights,0);});
test('unknown factual query abstains',async()=>{const r=await resolve(compile('Where is unknown place?'));assert.match(r.detail,/Evidence guard/);});
test('mobile neural disabled and factual blocked',()=>{assert.equal(permitNeural('auto','Write a story',true,true),false);assert.equal(permitNeural('auto','Where is MRPL?',false,true),false);assert.equal(permitNeural('auto','Write a story',false,true),true);});
