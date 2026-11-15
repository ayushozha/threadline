// Render the four-mode concept film from labeled illustrations and example dialogue.
// Run: node tools/render_accessibility_demo.mjs (starts from a local static server via DEMO_RENDER_URL).
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'assets/demo/accessibility');
const scratch = path.join(root, '.artifacts', `accessibility-render-${process.pid}`);
const profile = path.join(scratch, 'chrome');
mkdirSync(profile, { recursive: true });
const chrome = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!chrome) throw Error('Set CHROME_PATH to a local Chromium executable.');
const url = process.env.DEMO_RENDER_URL || 'http://127.0.0.1:8019/?render=1';
const fps = 12, duration = 58.8;
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, encode;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i=0; i<100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw Error('Chrome did not start.');
  const port = readFileSync(portFile,'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await once(socket,'open');
  let seq=0; const pending = new Map(); const errors=[];
  socket.addEventListener('message', event => {
    const msg=JSON.parse(event.data), task=pending.get(msg.id);
    if(task){pending.delete(msg.id);clearTimeout(task.timer);msg.error?task.reject(Error(msg.error.message)):task.resolve(msg.result);}
    if(msg.method==='Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},30000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});
  let ready=false;
  for(let i=0;i<100&&!ready;i++){ready=(await call('Runtime.evaluate',{expression:'window.demoReady === true',returnByValue:true})).result.value;if(!ready)await sleep(100);}
  if(!ready) throw Error('Demo page failed to become ready.');
  encode=spawn('ffmpeg',['-hide_banner','-loglevel','warning','-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(fps),'-i','pipe:0','-i',path.join(out,'narration.mp3'),'-vf','fps=24','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-t',String(duration),'-movflags','+faststart',path.join(out,'threadline-four-modes.mp4')],{stdio:['pipe','ignore','inherit'],windowsHide:true});
  const encoded=new Promise((resolve,reject)=>{encode.on('error',reject);encode.on('exit',code=>code===0?resolve():reject(Error(`ffmpeg exited ${code}`)));});
  encode.stdin.on('error',()=>{});
  const marks=[0,11,17,27,35,41,50,56];
  for(let frame=0;frame<Math.ceil(duration*fps);frame++){
    const t=frame/fps;
    await call('Runtime.evaluate',{expression:`window.renderAt(${t});Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))`,awaitPromise:true});
    const shot=await call('Page.captureScreenshot',{format:'jpeg',quality:93,captureBeyondViewport:false,fromSurface:true});
    const bytes=Buffer.from(shot.data,'base64');
    if(!encode.stdin.write(bytes))await once(encode.stdin,'drain');
    if(marks.some(s=>frame===Math.round(s*fps))){writeFileSync(path.join(scratch,`review-${String(Math.round(t)).padStart(2,'0')}.jpg`),bytes);if(t===17)writeFileSync(path.join(out,'poster.jpg'),bytes);}
    if(frame%(fps*5)===0)console.log(`Rendered ${t.toFixed(0)} / ${duration} seconds`);
  }
  encode.stdin.end(); await encoded;
  if(errors.length)throw Error(`Browser errors: ${errors.join(', ')}`);
  writeFileSync(path.join(out,'render-receipt.json'),JSON.stringify({generated_at:new Date().toISOString(),resolution:'1280x720',capture_fps:fps,output_fps:24,duration_seconds:duration,narration:'Jessica; ElevenLabs; expressive narration',visuals:'Synthetic fictional stills, deterministic browser typography and motion',inference:'Concept film uses illustrative response text, not a recorded inference',browser_errors:errors,review_frames:path.relative(root,scratch).replaceAll('\\','/')},null,2)+'\n');
  console.log(`Saved film and review frames: ${scratch}`);
} finally { socket?.close(); child.kill(); if(encode&&!encode.killed)encode.kill(); await sleep(500); try{rmSync(profile,{recursive:true,force:true});}catch{} }
