const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { WhatsAppAdapter } = require('../adapter');

test('lightweight chat listing bypasses broken full-model serialization', async () => {
  const adapter = new WhatsAppAdapter('/tmp');
  const badName = {id:{_serialized:'888@g.us'},name:'Fallback group title'};
  Object.defineProperty(badName, 'formattedTitle', {get(){throw Error('Business title getter failed')}});
  const models = [{id:{_serialized:'123@g.us'},formattedTitle:'Business team'}, {id:{_serialized:'919876543210@lid'},name:'Customer'}, badName, {id:{_serialized:'status@broadcast'}}, {}];
  let fullCalls=0;
  adapter.client = {
    pupPage:{evaluate: async fn => vm.runInNewContext('(' + fn.toString() + ')()', {window:{Store:{Chat:{getModelsArray:()=>models}}}})},
    getChats:async()=>{fullCalls++; throw Error('getChatModel failed');}
  };
  const chats = await adapter.chats();
  assert.equal(chats.length,3); assert.equal(chats[0].name,'Business team'); assert.equal(chats[1].isGroup,false); assert.equal(chats[2].name,'Fallback group title');
  assert.equal((await adapter.groups()).length,2); assert.equal(await adapter.checkGroup('123@g.us'),true); assert.equal(await adapter.checkChat('919876543210@lid'),true); assert.equal(fullCalls,0);
});
test('public getChats fallback remains usable if the internal store changes', async () => {
  const adapter = new WhatsAppAdapter('/tmp');
  adapter.client={pupPage:{evaluate:async()=>{throw Error('Store unavailable')}},getChats:async()=>[{id:{_serialized:'123@g.us'},name:'Group',isGroup:true}]};
  assert.equal((await adapter.groups())[0].name,'Group');
});
test('both lookup failures retain diagnostic context', async () => {
  const adapter = new WhatsAppAdapter('/tmp');
  adapter.client={pupPage:{evaluate:async()=>{throw Error('Store unavailable')}},getChats:async()=>{throw Error('model failed')}};
  await assert.rejects(adapter.chats(), /Store unavailable; library lookup: model failed/);
});
test('modern WhatsApp collection works with no window.Store at all', async () => {
  const adapter = new WhatsAppAdapter('/tmp');
  const models = [
    {id:{_serialized:'123@g.us'},formattedTitle:'Modern group'},
    {id:{$1:'987@g.us'},name:'Renamed WID group'},
    {id:{user:'919876543210',server:'c.us',toString(){return '919876543210@c.us'}},name:'Customer'},
    {id:{$1:'555@lid'},name:'LID customer'}
  ];
  let fullCalls=0;
  adapter.client={
    pupPage:{evaluate:async fn => vm.runInNewContext('(' + fn.toString() + ')()',{window:{require:name=>{assert.equal(name,'WAWebCollections');return {Chat:{getModelsArray:()=>models}}}}})},
    getChats:async()=>{fullCalls++;throw Error('r')}
  };
  const chats=await adapter.chats();
  assert.equal(chats.length,4); assert.equal(chats[0].id,'123@g.us'); assert.equal(chats[1].id,'987@g.us'); assert.equal(chats[2].id,'919876543210@c.us'); assert.equal(chats[3].id,'555@lid');
  assert.equal((await adapter.groups()).length,2); assert.equal(fullCalls,0);
});
test('unrecognized IDs do not silently produce an empty recipient list', async () => {
  const adapter=new WhatsAppAdapter('/tmp');
  adapter.client={pupPage:{evaluate:async fn=>vm.runInNewContext('('+fn.toString()+')()',{window:{require:()=>({Chat:{getModelsArray:()=>[{id:{changedField:'123@g.us'}}]}})}})},getChats:async()=>{throw Error('r')}};
  await assert.rejects(adapter.chats(),/none have a recognized recipient ID/);
});
