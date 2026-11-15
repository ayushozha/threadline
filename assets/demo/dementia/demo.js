const $ = id => document.getElementById(id);
const scenario = await fetch('scenario.json').then(r => r.json());
let recorded = null;
try { recorded = await fetch('provider-response.json').then(r => r.ok ? r.json() : null); } catch { /* first render before capture */ }
$('recorded').textContent = recorded ? JSON.stringify(recorded, null, 2) : 'A response has not been captured yet.';
for (const line of scenario.transcript) {
  const li = document.createElement('li'); li.className = 'evidence';
  const stamp = document.createElement('span'); stamp.textContent = `${line.id} · ${line.at.slice(11, 16)} · FICTIONAL`;
  const text = document.createElement('div'); text.textContent = line.text; li.append(stamp, text); $('timeline').append(li);
}
function showResult(data) {
  $('answer-panel').hidden = false; $('answer-source').textContent = 'NEW GEMINI RESPONSE · FICTIONAL INPUTS';
  $('next-step').textContent = data.next_step; $('answer').textContent = data.answer;
  $('observations').replaceChildren(...data.observations.map(o => { const li = document.createElement('li'); li.textContent = `${o.frame_id}: ${o.description}`; return li; }));
  $('source-ids').textContent = `Sources: ${[...data.transcript_ids, ...data.frame_ids].join(', ')}`;
  $('uncertainty').textContent = data.uncertainties.join(' ');
}
async function makeFrame() {
  const img = new Image(); img.src = scenario.frame.path; await img.decode();
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = Math.round(img.height * 960 / img.width);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return { id: scenario.frame.id, at: scenario.frame.at, mime_type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', .78).split(',')[1] };
}
$('analyze').addEventListener('click', async () => {
  if (!$('consent').checked) { $('status').textContent = 'Choose whether to send these fictional inputs first.'; return; }
  $('analyze').disabled = true; $('status').textContent = 'Sending this conversation and scene to Gemini…';
  try {
    const session = await fetch('/api/session', { method: 'POST' });
    if (!session.ok && session.status !== 503) throw Error('Could not start a demo session.');
    const response = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: scenario.question, transcript: scenario.transcript, frames: [await makeFrame()] }) });
    if (!response.ok) throw Error(`Provider request failed (${response.status}). Please try again.`);
    showResult(await response.json()); $('status').textContent = 'Response received. Inspect its evidence and uncertainties below.';
  } catch (error) { $('status').textContent = error.message; }
  finally { $('analyze').disabled = false; }
});
// Render a filmed explanation. Its inference text is the captured API result, not invented output.
const film = new URLSearchParams(location.search).has('render');
const steps = [0, 9.84, 18.82, 27.10, 33.40, 43.78, 50.38];
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.renderAt = t => {
  const n = steps.findLastIndex(start => t >= start), copy = $('stage-copy'), visual = $('stage-visual');
  $('stage').classList.toggle('wide', n === 0 || n === 6);
  $('stage-number').textContent = `${String(n + 1).padStart(2, '0')} / 07`;
  const screens = [
    ['THE PROBLEM', '<h1>What was<br>I doing?</h1><p>A small interruption can make an ordinary routine hard to resume.</p><p class="small">Memory support, built around the person’s own words.</p>', ''],
    ['THE PERSON', '<h2>One ordinary<br>morning.</h2><p>Meet Meera.<br>Tea first. Then the plant.</p><p class="small">A fictional scenario for a dementia-support prototype.</p>', '<img src="images/tea-routine-pause.png" alt="Generated kitchen scene">'],
    ['CONNECT THE EVIDENCE', '<h2>The plan, recalled.<br>The scene, checked.</h2><p>“Tea in the blue mug, then water the plant.”</p><p class="small">plan-01 · Saved fictional conversation<br>kitchen-06 · AI-generated current view</p>', '<img src="images/tea-routine-evidence.png" alt="Generated evidence scene">'],
    ['TWO SOURCES. ONE CONTEXT.', '<h2>Words remember why.<br>Vision shows what.</h2><p>Neither source tells the whole story on its own.</p><p class="small">Objects in view do not prove that a task was completed.</p>', '<div class="quote"><small>09:00 · PLAN-01 · FICTIONAL</small>“Tea in the blue mug, then water the plant.”</div><div class="quote accent"><small>09:03 · INTERRUPTION-04</small>“The phone is ringing. I’ll come back to my tea.”</div>'],
    ['A GROUNDED NEXT STEP', `<h2 class="response-heading">${escape(recorded?.next_step || 'Connect the plan to the present.')}</h2><p class="small">Actual Gemini response, generated from the displayed fictional conversation and image.</p>`, `<div class="quote accent response-quote"><small>ACTUAL CAPTURED API RESPONSE</small>${escape(recorded?.answer?.split('. ')[0] || 'Response pending capture.')}.</div><ul class="evidence-list">${(recorded?.transcript_ids || []).filter(id => ['plan-01','interruption-04','preference-03'].includes(id)).map(id => `<li>Source: ${escape(id)}</li>`).join('')}<li>Frame: kitchen-06</li></ul>`],
    ['HELP, WITH PERMISSION', '<h2>Support,<br>without overclaiming.</h2><p>Everyday memory support.<br>Not a diagnosis.<br>Not proof of completion.</p><p class="small">No caregiver message is sent in this film.</p>', '<div class="quote"><small>SAVED PREFERENCE · FICTIONAL</small>“Give me one step at a time. Ask before sharing with Priya.”</div><div class="quote"><small>UNCERTAINTY STAYS VISIBLE</small>The kettle’s state is unknown.<br>The glasses are not in view.</div>'],
    ['THREADLINE', '<h1>A little context.<br>A clear next step.</h1><p>Conversation + vision + personal memory.</p><p class="small">Try the actual inference at threadline.ayushojha.com/demo/<br>Fictional inputs. Real API response. Prototype.</p>', '']
  ];
  const row = screens[n]; copy.innerHTML = `<span class="tag">${row[0]}</span>${row[1]}`; visual.innerHTML = row[2];
  const img = visual.querySelector('img'); if (img) img.style.transform = `scale(${1 + (t - steps[n]) * .002})`;
};
if (film) { document.body.classList.add('render'); $('stage').hidden = false; window.renderAt(0); }
window.demoReady = true;
