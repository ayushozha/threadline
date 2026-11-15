import test from 'node:test';
import assert from 'node:assert/strict';
import { mountEmergency, saveContacts } from '../app/static/emergency.mjs';

const element = (tag, props = {}, ...children) => ({tag, ...props, children: children.filter(Boolean),
  append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes.filter(Boolean); },
  addEventListener(event, callback) { (this.events ||= {})[event] = callback; },
});
const text = n => [n.textContent || '', ...(n.children || []).map(text)].join(' ');
const find = (n, predicate) => predicate(n) ? n : (n.children || []).map(x => find(x, predicate)).find(Boolean);

test('incident countdown requests a dialer but never claims a completed call', () => {
  const previous = Object.fromEntries(['localStorage','document','location','setInterval','clearInterval'].map(k => [k, globalThis[k]]));
  const storage = new Map(), body = element('body'); let tick, stopped = false;
  globalThis.localStorage = {getItem:k=>storage.get(k) || null,setItem:(k,v)=>storage.set(k,v)};
  globalThis.document = {body}; globalThis.location = {href:''};
  globalThis.setInterval = fn => {tick = fn;return 1;}; globalThis.clearInterval = () => {stopped = true;};
  try {
    const log = []; saveContacts({name:'Demo contact',phone:'+15550100',services:'911'});
    const emergency = mountEmergency({el:element,onLog:t=>log.push(t)});
    emergency.trigger({reason:'Simulated fall signal',note:'No physical band event observed.'});
    assert.match(text(body), /Simulated fall signal/);
    assert.match(text(body), /Opens your dialer/);
    assert.doesNotMatch(text(body), /Emergency detected by|Calling Demo contact/);
    for(let n=0;n<10;n++)tick();
    assert.equal(location.href,'tel:+15550100');
    assert.ok(log.some(t=>/completion is not verified/.test(t)));
    assert.equal(stopped,true);
    emergency.close(); location.href=''; stopped=false;
    emergency.trigger();
    find(body,n=>n.textContent==="I'm OK — cancel").events.click();
    assert.equal(location.href,'');assert.equal(stopped,true);
  } finally { for(const [k,v] of Object.entries(previous)) v === undefined ? delete globalThis[k] : globalThis[k]=v; }
});
