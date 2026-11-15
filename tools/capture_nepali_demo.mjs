// Capture the actual UI from an isolated local app with empty server storage.
// Start that app using a fresh THREADLINE_DB_PATH; never point this at a private live session.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'assets/demo/project/son-cut/live');
const scratch = path.join(root, '.artifacts/project-media');
const base = 'https://threadline.ayushojha.com/';
const parsed = new URL(base);
if (parsed.hostname !== 'threadline.ayushojha.com') throw Error('Unexpected deployed site');
mkdirSync(output, { recursive: true }); mkdirSync(scratch, { recursive: true });
const profile = path.join(scratch, `chrome-${process.pid}`); mkdirSync(profile, { recursive: true });
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let n = 0; n < 100 && !existsSync(portFile); n++) await sleep(100);
  if (!existsSync(portFile)) throw Error('Chrome did not start.');
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let seq = 0; const pending = new Map(), errors = [], captures = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(`Timed out: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async expression => {
    for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await sleep(100); }
    throw Error(`UI did not settle: ${expression}`);
  };
  const go = async view => { await evaluate(`location.hash=${JSON.stringify(view)};window.scrollTo(0,0)`); await sleep(350); };
  const capture = async (name, description, selector) => {
    if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start',behavior:'instant'})`);
    await sleep(200);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
    writeFileSync(path.join(output, name), Buffer.from(screenshot.data, 'base64'));
    captures.push({ file: name, description, view: await evaluate('location.hash'), dimensions: '1920x1080', source: 'Actual local Threadline UI; built-in example history and empty isolated server storage.' });
    console.log(`Saved ${name}`);
  };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable');
  // Prevent the owner's private data endpoints from entering this public project capture.
  await call('Network.setBlockedURLs',{urls:['*/api/health/summary*','*/api/demo/transcript*','*/api/demo/feed*','*/api/demo/readings*','*/api/demo/latest*']});
  await call('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:base});await sleep(3500);console.log(await evaluate(`({count:document.querySelector('#memory-count')?.textContent,status:document.querySelector('#status')?.textContent,body:document.body.innerText.slice(0,500)})`));
  const frames=path.join(scratch,'live-frames-'+process.pid);mkdirSync(frames,{recursive:true});let frame=0;
  async function record(name,seconds){
    for(let i=0;i<seconds*4;i++){
      const started=Date.now();const shot=await call('Page.captureScreenshot',{format:'jpeg',quality:92,fromSurface:true});
      const bytes=Buffer.from(shot.data,'base64');writeFileSync(path.join(frames,String(frame++).padStart(5,'0')+'.jpg'),bytes);
      if(i===0)writeFileSync(path.join(output,name+'.jpg'),bytes);
      await sleep(Math.max(0,250-(Date.now()-started)));
    }
    console.log('Captured '+name+' '+seconds+'s');
  }
  const events=[];const at=()=>frame/4;
  async function click(selector){const r=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x,y:r.y});await call('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x,y:r.y,button:'left',clickCount:1});}
  await go('library');await wait(`document.querySelectorAll('.lib-card').length>0`);
  await evaluate(`(()=>{[...document.querySelectorAll('.lib-filter')].find(b=>b.textContent.includes('Memory')).click();[...document.querySelectorAll('.lib-card')].find(c=>c.textContent.includes('Where are my glasses')).click();document.querySelector('.lib-detail').scrollIntoView({block:'start',behavior:'instant'})})()`);await sleep(800);
  events.push({at:at(),event:'Opened public synthetic glasses clip; existing response marked saved'});await record('01-library-before',3);
  await evaluate(`document.querySelector('.lib-chat').scrollIntoView({block:'center',behavior:'instant'})`);await record('08-nepali-before',2);await click('.lib-chat input');
  const question='मेरो चस्मा कहाँ छ? नेपालीमा उत्तर दिनुहोस्।';events.push({at:at(),event:'Entered Nepali question',text:question});await call('Input.insertText',{text:question});await record('09-nepali-question',3);
  events.push({at:at(),event:'Submitted Nepali question'});await click('.lib-chat-form button[type=submit]');
  for(let n=0;n<60;n++){await record('10-nepali-processing',1);if(await evaluate(`document.querySelectorAll('.lib-msg.model').length>0 || document.querySelector('.lib-chat').textContent.includes("Couldn't reach Gemini")`))break;}
  const chat=await evaluate(`document.querySelector('.lib-chat-log').textContent`);events.push({at:at(),event:'Nepali answer received',text:chat});await record('11-nepali-answer',9);
  const reason='Nepali follow-up on the public synthetic glasses clip.';
  writeFileSync(path.join(output,'nepali-events.json'),JSON.stringify({source:base,events,chat,seconds:at(),fps:4,privacy:'Owner Health and transcript feeds blocked; public synthetic scene only. No response replacement.'},null,2));
  const enc=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','4','-i',path.join(frames,'%05d.jpg'),'-vf','fps=24','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',path.join(output,'nepali-live.mp4')],{stdio:'inherit',windowsHide:true});
  await new Promise((resolve,reject)=>{enc.on('exit',c=>c===0?resolve():reject(Error('ffmpeg '+c)));enc.on('error',reject)});
  writeFileSync(path.join(output,'nepali-manifest.json'),JSON.stringify({source:base,captured_at:new Date().toISOString(),seconds:frame/4,resolution:'1600x900',fps:24,description:'Actual deployed Threadline app captured in a fresh browser. Private owner transcript/Health endpoints were blocked; the app showed its built-in example fallback. The public synthetic scene is submitted to the actual deployed chat endpoint; Nepali input and the fresh Nepali response are recorded continuously.',browser_errors:errors},null,2));
  console.log('Saved '+path.join(output,'nepali-live.mp4'));
} finally {
  socket?.close(); child.kill(); await sleep(400);
  const resolved = path.resolve(profile);
  if (resolved.startsWith(path.resolve(scratch) + path.sep)) { try { rmSync(resolved, { recursive: true, force: true }); } catch { /* Chrome may still be closing. */ } }
}
