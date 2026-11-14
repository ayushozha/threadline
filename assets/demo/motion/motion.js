"use strict";
(() => {
  const query = new URLSearchParams(location.search);
  const name = ["title", "memory", "modes", "waveform"].includes(query.get("scene")) ? query.get("scene") : "title";
  const durations = { title: 6, memory: 8, modes: 6, waveform: 6 };
  const $ = (id) => document.getElementById(id);
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const ease = (value) => 1 - (1 - clamp(value)) ** 3;
  const enter = (id, t, delay = 0, duration = 1, shift = 26) => {
    const p = ease((t - delay) / duration);
    $(id).setAttribute("opacity", p.toFixed(5));
    $(id).setAttribute("transform", `translate(0 ${((1 - p) * shift).toFixed(3)})`);
  };
  const draw = (id, p) => {
    const length = $(id).getTotalLength();
    $(id).style.strokeDasharray = `${length}`;
    $(id).style.strokeDashoffset = `${length * (1 - clamp(p))}`;
  };
  if (query.has("render")) document.body.classList.add("render");
  if (query.has("transparent")) { document.documentElement.classList.add("transparent"); document.body.classList.add("transparent"); $("background").remove(); }
  $(name).style.display = "inline";
  document.querySelector(`a[href="?scene=${name}"]`).setAttribute("aria-current", "true");
  const bars = [];
  for (let index = 0; index < 69; index++) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const x = 151 + index * 23.7;
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    line.setAttribute("stroke", index % 7 === 0 ? "#b44630" : "#72766a");
    line.setAttribute("stroke-width", "6"); line.setAttribute("stroke-linecap", "round");
    $("wave-bars").append(line); bars.push(line);
  }
  window.renderAt = (seconds) => {
    const t = Math.max(0, Number(seconds) || 0);
    if (name === "title") {
      enter("wordmark", t, .12, 1.4, 40); enter("tagline", t, .9, 1.3, 15);
      draw("title-thread", ease((t - .45) / 3.3)); enter("title-node", t, 3.6, .7, 0);
    } else if (name === "memory") {
      draw("memory-thread", ease((t - .25) / 5));
      enter("card-one", t, .4, 1.3); enter("card-two", t, 1.8, 1.3); enter("card-three", t, 3.2, 1.3);
      enter("memory-caption", t, 4.8, 1.2, 14);
    } else if (name === "modes") {
      draw("mode-rule", ease((t - .15) / 1.4)); enter("mode-reflection", t, .45, 1.3, 20); enter("mode-routine", t, 1.2, 1.3, 20);
    } else {
      const fade = ease(t / 1.3);
      bars.forEach((bar, i) => {
        const envelope = .22 + .78 * Math.sin(Math.PI * (i + 1) / 70) ** 2;
        const motion = .55 + .2 * Math.sin(t * 1.65 + i * .29) + .16 * Math.cos(t * .8 - i * .51);
        const amplitude = (12 + 154 * envelope * motion) * fade;
        bar.setAttribute("y1", (561 - amplitude).toFixed(3)); bar.setAttribute("y2", (561 + amplitude).toFixed(3));
      });
    }
    return { scene: name, time: t, duration: durations[name] };
  };
  window.motionDuration = durations[name]; window.motionReady = true;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let start = performance.now();
  $("replay").addEventListener("click", () => { start = performance.now(); });
  const tick = (now) => { window.renderAt(Math.min(durations[name], (now - start) / 1000)); requestAnimationFrame(tick); };
  if (query.has("render") || reduced) window.renderAt(reduced ? durations[name] : 0);
  else requestAnimationFrame(tick);
})();
