// Deterministic SVG frames via local Chrome/CDP; VP9 alpha WebM via installed ffmpeg.
// Run: node tools/render_motion.mjs [title|memory|modes|waveform|all|ui] [--opaque] [--frames]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const motion = path.join(root, 'assets', 'demo', 'motion');
const known = { title: 6, memory: 8, modes: 6, waveform: 6 };
const selected = process.argv[2] || 'all';
if (!['all', 'ui'].includes(selected) && !Object.hasOwn(known, selected)) throw new Error('Scene must be title, memory, modes, waveform, all, or ui.');
const scenes = selected === 'all' ? Object.keys(known) : selected === 'ui' ? [] : [selected];
const transparent = !process.argv.includes('--opaque');
const keepFrames = process.argv.includes('--frames');
const fps = Number(process.env.MOTION_FPS || 24);
if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('MOTION_FPS must be an integer from 1 to 60.');
const chromePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!chromePath) throw new Error('Set CHROME_PATH to your installed Chrome or Edge executable.');
const profile = path.join(motion, `.render-profile-${process.pid}`);
mkdirSync(profile, { recursive: true });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const child = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
let socket;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; !existsSync(portFile) && attempt < 100; attempt++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome did not expose its local debugging port.');
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => item.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data); const task = pending.get(result.id);
    if (task) { pending.delete(result.id); clearTimeout(task.timeout); result.error ? task.reject(new Error(result.error.message)) : task.resolve(result.result); }
    if (result.method === 'Page.javascriptDialogOpening') call('Page.handleJavaScriptDialog', { accept: true }).catch(console.error);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await call('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const scene of scenes) {
    const url = `${pathToFileURL(path.join(motion, 'index.html')).href}?scene=${scene}&render=1${transparent ? '&transparent=1' : ''}`;
    await call('Page.navigate', { url });
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      ready = (await call('Runtime.evaluate', { expression: 'window.motionReady === true', returnByValue: true })).result.value;
      if (!ready) await sleep(50);
    }
    if (!ready) throw new Error(`Scene failed to load: ${scene}`);
    const suffix = transparent ? 'alpha' : 'cream';
    const framesDir = path.join(motion, `${scene}-${suffix}-frames`); mkdirSync(framesDir, { recursive: true });
    const count = known[scene] * fps;
    for (let frame = 0; frame < count; frame++) {
      await call('Runtime.evaluate', { expression: `window.renderAt(${frame / fps})`, returnByValue: true });
      const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      const bytes = Buffer.from(shot.data, 'base64');
      writeFileSync(path.join(framesDir, `${String(frame).padStart(5, '0')}.png`), bytes);
      if (frame === Math.round(count * .8)) writeFileSync(path.join(motion, `${scene}-${suffix}-poster.png`), bytes);
      if (frame % fps === 0) console.log(`${scene}: ${frame / fps}/${known[scene]} seconds`);
    }
    const output = path.join(motion, `${scene}-${suffix}.webm`);
    const encode = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-framerate', String(fps), '-i', path.join(framesDir, '%05d.png'), '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', transparent ? 'yuva420p' : 'yuv420p', '-b:v', '0', '-crf', '28', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-auto-alt-ref', '0', output], { stdio: 'inherit', windowsHide: true });
    await new Promise((resolve, reject) => { encode.on('error', reject); encode.on('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))); });
    if (!keepFrames) rmSync(framesDir, { recursive: true });
    console.log(`Exported ${output}`);
  }
  if (selected === 'ui') {
    const captures = [];
    await call('Emulation.setDeviceMetricsOverride', { width: 1536, height: 864, deviceScaleFactor: 1.25, mobile: false });
    for (const mode of ['reflection', 'routine']) {
      await call('Page.navigate', { url: 'https://threadline.ayushojha.com/' });
      let ready = false;
      for (let attempt = 0; attempt < 160 && !ready; attempt++) {
        ready = (await call('Runtime.evaluate', { expression: 'Boolean(document.querySelector("#timeline li"))', returnByValue: true })).result.value;
        if (!ready) await sleep(100);
      }
      if (!ready) throw new Error('Live interface did not load.');
      const initial = await call('Runtime.evaluate', { expression: 'JSON.stringify({title:document.title, buttons:[...document.querySelectorAll("button")].map(b=>({id:b.id,mode:b.dataset.mode,text:b.textContent.trim()})), status:document.getElementById("status").textContent})', returnByValue: true });
      if (!initial.result.value.includes('Local demo')) throw new Error('Expected local demo interface was not found.');
      const question = mode === 'routine' ? 'What was my next planned step?' : 'What helped me feel less rushed last time?';
      const notes = [
        'Fictional demo entry: Before my last period, I felt rushed. Leaving one evening free helped me feel less overwhelmed.',
        'Fictional demo entry: I want to remember what I said helped, rather than assume every cycle is the same.',
        'Fictional demo entry: This time, I want to make space for one quieter evening and see whether it helps.'
      ];
      const frameDir = path.join(motion, `ui-${mode}-frames`); mkdirSync(frameDir, { recursive: true });
      const frameRate = 15, seconds = mode === 'routine' ? 16 : 22, total = frameRate * seconds;
      let lastText = '';
      const typeField = async (id, text, progress) => {
        const value = text.slice(0, Math.floor(text.length * Math.min(1, progress)));
        const signature = `${id}:${value}`;
        if (signature === lastText) return;
        lastText = signature;
        await call('Runtime.evaluate', { expression: `(()=>{const q=document.getElementById(${JSON.stringify(id)});q.focus({preventScroll:true});q.value=${JSON.stringify(value)};q.dispatchEvent(new Event('input',{bubbles:true}));})()` });
      };
      const submit = async (form) => call('Runtime.evaluate', { expression: `document.getElementById(${JSON.stringify(form)}).requestSubmit();document.activeElement.blur();` });
      for (let frame = 0; frame < total; frame++) {
        const t = frame / frameRate;
        if (frame === 15) await call('Runtime.evaluate', { expression: `document.querySelector('[data-mode="${mode}"]').click()` });
        if (mode === 'routine') {
          if (t >= 2 && t < 3) await call('Runtime.evaluate', { expression: `window.scrollTo(0, ${Math.round(320 * easeNumber(t - 2))})` });
          if (t >= 3 && t <= 5) await typeField('question', question, (t - 3) / 2);
          if (frame === 75) await submit('question-form');
          if (frame === 105) await call('Runtime.evaluate', { expression: 'window.scrollTo(0,420)' });
          if (frame === 150) await call('Runtime.evaluate', { expression: "document.querySelector('.sources a[href=\"#note-routine-3\"]').click()" });
          if (frame === 165) await call('Runtime.evaluate', { expression: 'window.scrollTo(0,420)' });
        } else {
          if (frame === 24) await call('Runtime.evaluate', { expression: "document.getElementById('clear').click()" });
          if (frame === 30) await call('Runtime.evaluate', { expression: 'window.scrollTo(0,300)' });
          if (t >= 2.5 && t <= 5) await typeField('note', notes[0], (t - 2.5) / 2.5);
          if (frame === 75) await submit('note-form');
          if (t >= 6 && t <= 8.5) await typeField('note', notes[1], (t - 6) / 2.5);
          if (frame === 128) { await typeField('note', notes[1], 1); await submit('note-form'); }
          if (t >= 9 && t <= 11) await typeField('question', question, (t - 9) / 2);
          if (frame === 165) await submit('question-form');
          if (frame === 180) await call('Runtime.evaluate', { expression: 'window.scrollTo(0,560)' });
          if (frame === 210) await call('Runtime.evaluate', { expression: "document.querySelector('.sources a').click()" });
          if (frame === 225) await call('Runtime.evaluate', { expression: 'window.scrollTo(0,560)' });
          if (t >= 16 && t <= 19) await typeField('note', notes[2], (t - 16) / 3);
          if (frame === 285) await submit('note-form');
          if (frame === 300) await call('Runtime.evaluate', { expression: 'window.scrollTo(0,560)' });
        }
        const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
        const bytes = Buffer.from(shot.data, 'base64');
        writeFileSync(path.join(frameDir, `${String(frame).padStart(5, '0')}.png`), bytes);
        if (frame === total - 1) writeFileSync(path.join(motion, `ui-${mode}-poster.png`), bytes);
        if (frame % frameRate === 0) console.log(`ui-${mode}: ${t}/${seconds} seconds`);
      }
      const final = (await call('Runtime.evaluate', { expression: 'JSON.stringify({status:document.getElementById("status").textContent,question:document.getElementById("question").value,answer:document.getElementById("answer").textContent,notes:[...document.querySelectorAll("#timeline li p")].map(n=>n.textContent),sources:[...document.querySelectorAll(".sources a")].map(a=>a.textContent)})', returnByValue: true })).result.value;
      const output = path.join(motion, `ui-${mode}.mp4`);
      const encode = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-framerate', String(frameRate), '-i', path.join(frameDir, '%05d.png'), '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { stdio: 'inherit', windowsHide: true });
      await new Promise((resolve, reject) => { encode.on('error', reject); encode.on('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))); });
      if (!keepFrames) rmSync(frameDir, { recursive: true });
      captures.push({mode, url:'https://threadline.ayushojha.com/', output, seconds, fps:frameRate, resolution:'1920x1080', capturedAt:new Date().toISOString(), browserZoom:'1536x864 CSS pixels at device scale 1.25', interface:JSON.parse(final), note:'Actual deployed interface, fictional sample notes, local keyword retrieval. No provider calls, token, narration, or simulated AI answers.'});
      console.log(`Exported ${output}`);
    }
    writeFileSync(path.join(motion, 'ui-capture-receipt.json'), JSON.stringify(captures, null, 2));
  }
} finally {
  socket?.close(); child.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { console.warn(`Chrome profile still closing: ${profile}`); }
}

function easeNumber(value) { return 1 - (1 - Math.max(0, Math.min(1, value))) ** 3; }
