import test from 'node:test';import assert from 'node:assert/strict';import {chat,buildMessages} from '../dist/conversation-v041.js';
test('conversation module imports and prompt parses',()=>assert.match(buildMessages([],{facts:{}},'Hi')[0].content,/user’s text/));
test('greeting and fragment without worker',async()=>{for(const [q,re] of [['He',/starting a sentence/],['Hi',/How can I help/],['how are you',/ready to help/]])assert.match((await chat({}, {facts:{}},[],q,'compact',()=>{},()=>{})).answer,re);});
