import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseReply, mountEssentials } from '../app/static/essentials.mjs';

test('only a complete affirmative phrase authorizes payment', () => {
  for (const text of ['Yes.', 'okay', 'go ahead', 'हो', 'हुन्छ।', 'किन्नुहोस्']) assert.equal(purchaseReply(text), 'confirm', text);
  for (const text of ['not okay', 'yes, but do not buy it', 'I am not sure', 'होइन', 'do not buy it']) assert.equal(purchaseReply(text), 'cancel', text);
  for (const text of ['maybe', 'yes and add two more', 'I said okay yesterday']) assert.equal(purchaseReply(text), 'clarify', text);
});


test('pending payment keeps the cart and never logs paid; retry passes the same request ID', async () => {
  const previous = {fetch:globalThis.fetch, location:globalThis.location};
  globalThis.location = {search:''};
  globalThis.fetch = async () => ({json:async()=>({items:[{id:'milk',name:'Milk',cents:349,cat:'Food'}],stripe:true,test_mode:true})});
  const root = {replaceChildren() {}}, logs = [], requests = [];
  const el = (tag,props={},...children) => ({tag,...props,children,addEventListener(){}});
  let status = 'processing';
  try {
    const shop = mountEssentials(root,{el,contactName:()=>'',onLog:t=>logs.push(t),request:async(path,options)=> {
      if(path.endsWith('/wallet'))return {saved:true};
      requests.push(JSON.parse(options.body));return {status,amount_usd:3.49,card:'test card',test_mode:true};
    }});
    await new Promise(resolve=>setTimeout(resolve,0));
    shop.add('milk'); const requestId='c448fc15-a5a7-4ac4-8b24-142ee75e0246';
    await shop.buy(shop.snapshot(),'Caregiver',requestId);
    assert.equal(shop.snapshot().length,1);assert.ok(logs.every(t=>!t.includes('paid')&&!t.includes('succeeded')));
    status='succeeded'; await shop.buy(shop.snapshot(),'Caregiver',requestId);
    assert.equal(shop.snapshot().length,0);assert.ok(logs.some(t=>t.startsWith('Test payment succeeded')));
    assert.equal(requests[0].request_id,requests[1].request_id);
  } finally { for(const [k,v] of Object.entries(previous)) v===undefined?delete globalThis[k]:globalThis[k]=v; }
});
