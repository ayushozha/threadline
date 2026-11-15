// Capture the actual UI from an isolated local app with empty server storage.
// Start that app using a fresh THREADLINE_DB_PATH; never point this at a private live session.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'assets/demo/project/screenshots');
const scratch = path.join(root, '.artifacts/project-media');
const base = process.env.CAPTURE_URL || 'http://127.0.0.1:8012/';
const parsed = new URL(base);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw Error('Use an isolated local app for project screenshots.');
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
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: base });
  await wait(`document.querySelector('#memory-count')?.textContent.includes('77')`);
  // Abort if this server accidentally contains real owner data.
  const privateInputs = await evaluate(`Promise.all([fetch('/api/demo/transcript').then(r=>r.json()),fetch('/api/health/summary?days=30').then(r=>r.ok?r.json():{})]).then(([t,h])=>({lines:t.lines?.length||0,health:(h.daily||h.days||[]).length}))`);
  if (privateInputs.lines || privateInputs.health) throw Error('Server contains recordings or Health data. Use a fresh storage path.');
  await capture('01-dashboard.png', 'Four assistance modes with example history and chart provenance.');
  await go('graph');
  await wait(`document.querySelector('#memory-graph canvas')?.width > 0`); await sleep(1600);
  await capture('02-memory.png', 'Interactive Memory graph built from saved example conversations.', '#graph-heading');
  await go('transcripts');
  await capture('03-transcripts.png', 'Conversation archive with source labels and the selected transcript.', '#archive-caption');
  await go('dashboard');
  await evaluate(`document.querySelector('[data-access-mode="hearing"]').click()`);
  await go('care');
  await evaluate(`document.querySelector('#caption-demo').click()`);
  await wait(`document.querySelector('#caption-history').children.length >= 1`);
  await capture('04-hearing.png', 'Large captions from the explicitly labeled example conversation playback.', '#hearing-screen');
  await go('library');
  await wait(`document.querySelectorAll('.lib-card').length > 0`);
  await evaluate(`(()=>{const b=[...document.querySelectorAll('.lib-filter')].find(b=>b.textContent.includes('Memory'));if(!b)throw Error('Memory filter missing');b.click()})()`);
  await evaluate(`(()=>{const cards=[...document.querySelectorAll('.lib-card')];const publicScene=cards.find(c=>!c.querySelector('.lib-src')?.textContent.includes('Real recording'));if(!publicScene)throw Error('No synthetic public scene available');publicScene.click()})()`);
  await sleep(800);
  await capture('05-library.png', 'Existing scenario footage and recorded model reasoning; no provider response invented for the screenshot.', '.lib-detail');
  await go('dashboard');
  await evaluate(`document.querySelector('[data-access-mode="memory"]').click()`);
  await evaluate(`document.querySelectorAll('.dash-report button').forEach(b=>{if(b.textContent==='Preview')b.click()})`);
  await capture('06-report.png', 'Report preview prepared from the visible available inputs; no message sent.', '.dash-reports');
  if (errors.length) throw Error(`Browser errors: ${errors.join(', ')}`);
  writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ captured_at: new Date().toISOString(), source: base, captures, browser_errors: errors, privacy: 'Fresh browser profile and empty local database; no real patient recordings or Health data used.' }, null, 2) + '\n');
} finally {
  socket?.close(); child.kill(); await sleep(400);
  const resolved = path.resolve(profile);
  if (resolved.startsWith(path.resolve(scratch) + path.sep)) { try { rmSync(resolved, { recursive: true, force: true }); } catch { /* Chrome may still be closing. */ } }
}
