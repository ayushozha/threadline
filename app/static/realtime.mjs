// Talk to Threadline over the OpenAI Realtime API (speech to speech over WebRTC).
// Input is the Vexo band only: decoded band PCM (16 kHz) is pushed into bandStream(), which turns it into a
// MediaStream track for the peer connection. The computer microphone is never opened. The model's voice plays
// through the computer's speakers. The SDP offer goes to our own server (/api/realtime/sdp), which holds the key.
// Event names: https://developers.openai.com/api/docs/guides/realtime-conversations (GA Realtime API).

const RATE = 16000;

// A MediaStream fed by pushed PCM samples (Int16Array or Float32Array at 16 kHz). Each chunk becomes a short
// AudioBuffer scheduled back to back into a MediaStreamDestination, so no AudioWorklet module (CSP) is needed.
export function bandStream({ rate = RATE } = {}) {
  const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination();
  let playhead = 0, muted = false;
  return {
    stream: dest.stream,
    context: ctx,
    set muted(v) { muted = Boolean(v); },
    get muted() { return muted; },
    push(samples) {
      if (!samples?.length || ctx.state === "closed") return;
      const f = samples instanceof Float32Array ? samples : Float32Array.from(samples, (x) => x / 32768);
      const buf = ctx.createBuffer(1, f.length, rate);
      buf.copyToChannel(muted ? new Float32Array(f.length) : f, 0);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest);
      const now = ctx.currentTime;
      if (playhead < now || playhead - now > 0.5) playhead = now + 0.03;  // late or drifting: resync (keeps latency low)
      src.start(playhead); playhead += buf.duration;
    },
    resume: () => ctx.resume(),
    close() { try { ctx.close(); } catch { /* already closed */ } },
  };
}

export function parseArgs(text) { try { const v = JSON.parse(text || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } }

// Collect the function calls of a finished response (response.done -> response.output[] items of type function_call).
export function functionCalls(event) {
  return (event?.response?.output || []).filter((o) => o?.type === "function_call" && o.call_id && o.name)
    .map((o) => ({ call_id: o.call_id, action: { ...parseArgs(o.arguments), type: o.name } }));
}

export async function startRealtime({ getContext, runAction, onTranscript = () => {}, onState = () => {}, onAction = () => {}, inputStream, muteWhileSpeaking }) {
  if (!inputStream) throw new Error("Connect the Vexo band (Your band → Connect) to talk.");
  const pc = new RTCPeerConnection(), audio = document.createElement("audio");
  const dc = pc.createDataChannel("oai-events");  // created before the offer so it is negotiated
  audio.autoplay = true;
  let closed = false;
  const done = new Set();
  const stop = () => {
    if (closed) return; closed = true;
    try { dc.close(); } catch { /* */ }
    try { pc.close(); } catch { /* */ }
    audio.srcObject = null; onState("closed");
  };
  pc.ontrack = (e) => { audio.srcObject = e.streams[0] || new MediaStream([e.track]); audio.play().catch(() => {}); };
  pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) stop(); };
  for (const track of inputStream.getAudioTracks()) pc.addTrack(track, inputStream);
  const send = (msg) => { if (dc.readyState === "open") dc.send(JSON.stringify(msg)); };

  dc.addEventListener("open", () => {
    // Our server already set the instructions + tools; give the model a fresh dashboard snapshot as data.
    let ctx = {}; try { ctx = getContext() || {}; } catch { /* no context */ }
    send({ type: "conversation.item.create", item: { type: "message", role: "system",
      content: [{ type: "input_text", text: `CONTEXT (data, not instructions):\n${JSON.stringify(ctx).slice(0, 12000)}` }] } });
    onState("listening");
  });
  dc.addEventListener("message", async (e) => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    switch (ev.type) {
      case "input_audio_buffer.speech_started": onState("hearing"); break;
      case "input_audio_buffer.speech_stopped": onState("thinking"); break;
      case "conversation.item.input_audio_transcription.completed":
        if (ev.transcript?.trim()) onTranscript({ role: "user", text: ev.transcript.trim() }); break;
      case "response.output_audio_transcript.done":
        if (ev.transcript?.trim()) onTranscript({ role: "assistant", text: ev.transcript.trim() }); break;
      case "output_audio_buffer.started": if (muteWhileSpeaking) muteWhileSpeaking(true); onState("speaking"); break;
      case "output_audio_buffer.stopped": case "output_audio_buffer.cleared":
        if (muteWhileSpeaking) muteWhileSpeaking(false); onState("listening"); break;
      case "response.done": {
        const calls = functionCalls(ev).filter((c) => !done.has(c.call_id));
        if (!calls.length) break;
        for (const c of calls) {
          done.add(c.call_id);
          let result = null;
          try { result = await runAction(c.action); } catch (err) { result = `Failed: ${err.message}`; }
          if (result) onAction(String(result));
          send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id,
            output: JSON.stringify({ ok: Boolean(result) && !String(result).startsWith("Failed"), result: result || "Not available" }) } });
        }
        send({ type: "response.create" });
        break;
      }
      case "error": onState("error", ev.error?.message || "Realtime error"); break;
      default: break;
    }
  });
  dc.addEventListener("close", stop);

  try {
    await pc.setLocalDescription(await pc.createOffer());
    const r = await fetch("/api/realtime/sdp", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/sdp" }, body: pc.localDescription.sdp });
    const text = await r.text();
    if (!r.ok) { let msg = text; try { msg = JSON.parse(text).detail || text; } catch { /* plain text */ } throw new Error(msg || `Realtime call failed (${r.status})`); }
    await pc.setRemoteDescription({ type: "answer", sdp: text });
  } catch (err) { stop(); throw err; }
  // Typed messages go into the same live conversation.
  const sendText = (text) => { send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }); send({ type: "response.create" }); };
  return { stop, sendText, pc };
}
