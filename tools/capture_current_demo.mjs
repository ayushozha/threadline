// Capture the actual current UI and local demo actions. No mocked tool responses.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'assets/demo/motion');
const base = process.env.CAPTURE_URL || 'http://127.0.0.1:8001/';
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = path.join(folder, `.current-capture-${process.pid}`);
mkdirSync(profile, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const child = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
let socket;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let n = 0; !existsSync(portFile) && n < 100; n++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome failed to start.');
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0; const pending = new Map();
  socket.addEventListener('message', e => {
    const result = JSON.parse(e.data), task = pending.get(result.id);
    if (task) { pending.delete(result.id); clearTimeout(task.timer); result.error ? task.reject(new Error(result.error.message)) : task.resolve(result.result); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const scroll = async selector => evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}); if(!n)throw Error('Missing scroll target'); window.scrollTo({top:n.getBoundingClientRect().top+scrollY-24,behavior:'instant'});})()`);
  const button = async text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)}));if(!b||b.disabled)throw Error('Missing button');b.click();})()`);
  const waitFor = async expression => { for (let n=0;n<100;n++) { if(await evaluate(expression))return; await sleep(50); } throw new Error('State did not arrive: '+expression); };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1536, height: 864, deviceScaleFactor: 1.25, mobile: false });
  const receipts = [];
  for (const kind of ['dementia','pms']) {
    await call('Page.navigate', { url: base }); await waitFor('Boolean(document.querySelector("#timeline li"))');
    const captures = [], steps = [];
    const action = async (label, work) => { await work(); steps.push({ label, state: await evaluate('({status:document.getElementById("status").textContent,answer:document.getElementById("answer").textContent,calendar:document.getElementById("calendar").textContent,reviewSource:document.getElementById("review-source").textContent})') }); };
    const seconds = kind === 'dementia' ? 15 : 25, fps = 15, frames = seconds * fps;
    const frameDir = path.join(folder, `current-${kind}-frames`); mkdirSync(frameDir, { recursive: true });
    for (let frame = 0; frame < frames; frame++) {
      const t = frame / fps;
      if (kind === 'dementia') {
        if(frame===0) await evaluate('document.querySelector("[data-mode=routine]").click()');
        if(frame===15) await scroll('.workspace');
        if(t>=2 && t<=4) {
          const question='What was my next planned step?';
          await evaluate(`(()=>{const q=document.getElementById('question');q.focus({preventScroll:true});q.value=${JSON.stringify(question.slice(0,Math.floor(question.length*(t-2)/2)))};q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        }
        if(frame===60) await action('Asked exact routine question',async()=>{await evaluate('document.getElementById("question-form").requestSubmit();document.activeElement.blur()');await scroll('.workspace');});
        if(frame===105) await action('Opened the actual plan source',async()=>{await evaluate('document.querySelector(".sources a").click()');await scroll('.workspace');});
      } else {
        if(frame===0) await scroll('.workspace');
        if(t>=.5 && t<=2.5) {
          const question='What helped me feel less rushed last time?';
          await evaluate(`(()=>{const q=document.getElementById('question');q.focus({preventScroll:true});q.value=${JSON.stringify(question.slice(0,Math.floor(question.length*(t-.5)/2)))};q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        }
        if(frame===38) await action('Retrieved previous words',async()=>{await evaluate('document.getElementById("question-form").requestSubmit();document.activeElement.blur()');await scroll('.workspace');});
        if(frame===45) await evaluate('document.querySelector(".sources a").click()');
        if(frame===60) await action('Loaded explicitly scripted conversation',async()=>{await evaluate('document.getElementById("scripted").click()');await scroll('#review');});
        if(frame===75) await action('Selected speaker zero as the wearer',async()=>{await evaluate('const who=document.getElementById("who");who.value="0";who.dispatchEvent(new Event("change",{bubbles:true}))');});
        if(frame===90) await action('Saved only chosen speaker statements',async()=>{await evaluate('document.getElementById("review-save").click()');await scroll('#support');});
        if(frame===135) await action('Accepted schedule review',async()=>{await button('Review my schedule');await scroll('#calendar');});
        if(frame===150) await action('Queried demo calendar',async()=>{await button('Find a time');await waitFor('Boolean(document.querySelector("#calendar .proposal"))');await scroll('#calendar .ask-line');});
        if(frame===180) await action('Injected clearly labeled competing booking',async()=>{await button('Demo control:');await scroll('#calendar .ask-line');});
        if(frame===195) await action('Approved; backend rechecked and recovered from conflict',async()=>{await button('Create quiet time');await waitFor('document.querySelector("#calendar .agent-log").textContent.includes("Looking again") && Boolean(document.querySelector("#calendar .proposal"))');await scroll('#calendar .agent-log');});
        if(frame===240) await action('Approved replacement slot; created demo calendar event',async()=>{await button('Create quiet time');await waitFor('Boolean(document.querySelector("#calendar .done"))');await scroll('#calendar .agent-log');});
        if(frame===330) await action('Undid created demo event',async()=>{await button('Undo');await scroll('#calendar .agent-log');});
      }
      const screenshot = await call('Page.captureScreenshot', { format:'png', captureBeyondViewport:false, fromSurface:true });
      const bytes=Buffer.from(screenshot.data,'base64');writeFileSync(path.join(frameDir,`${String(frame).padStart(5,'0')}.png`),bytes);
      if(frame===Math.round(frames*.8)) writeFileSync(path.join(folder,`current-${kind}-poster.png`),bytes);
      if(frame%fps===0)console.log(`${kind}: ${t}/${seconds} seconds`);
    }
    const output=path.join(folder,`current-${kind}.mp4`);
    const encode=spawn('ffmpeg',['-hide_banner','-loglevel','warning','-y','-framerate',String(fps),'-i',path.join(frameDir,'%05d.png'),'-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:'inherit',windowsHide:true});
    await new Promise((resolve,reject)=>{encode.on('error',reject);encode.on('exit',code=>code===0?resolve():reject(new Error(`ffmpeg ${code}`)));});
    rmSync(frameDir,{recursive:true});
    receipts.push({kind,source:base,capturedAt:new Date().toISOString(),duration:seconds,fps,resolution:'1920x1080',steps,note:'Actual current local app; synthetic notes, scripted transcript, local matching and real local demo-calendar API calls. No external provider, real calendar, wearable or live microphone shown.'});
    writeFileSync(path.join(folder,'current-capture-receipt.json'),JSON.stringify(receipts,null,2));console.log(`Saved ${output}`);
  }
}finally{socket?.close();child.kill();await sleep(400);try{rmSync(profile,{recursive:true,force:true});}catch{console.warn('Temporary profile still closing:',profile);}}
