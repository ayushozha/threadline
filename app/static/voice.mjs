// Natural voice for Threadline replies: ElevenLabs through our server (the key stays there).
// No browser speech synthesis anywhere: if the voice service fails, the reply stays as text.
let current = null;
export function stopSpeaking() { try { current?.pause(); } catch { /* */ } current = null; }
export async function speak(text) {
  if (!text?.trim()) return false;
  const post = () => fetch("/api/assistant/speak", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ text: text.slice(0, 500) }) });
  let r = await post();
  if (r.status === 401 || r.status === 403) { await fetch("/api/session", { method: "POST", credentials: "same-origin" }).catch(() => {}); r = await post(); }
  if (!r.ok) return false;
  stopSpeaking();
  const url = URL.createObjectURL(await r.blob()), a = new Audio(url); current = a;
  await new Promise((res) => { a.onended = res; a.onerror = res; a.play().catch(res); });
  URL.revokeObjectURL(url); if (current === a) current = null;
  return true;
}
