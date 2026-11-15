"""Assemble the two-minute film from actual app captures and labeled illustrations."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/demo/project"
WORK = ROOT / ".artifacts/final-film"
WORK.mkdir(parents=True, exist_ok=True)
FONT = "C\\:/Windows/Fonts/segoeui.ttf"


def run(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def segment(index, source, seconds, heading, label, offset=0):
    target = WORK / f"part-{index:02}.mp4"
    still = source.suffix.lower() in {".png", ".jpg", ".jpeg"}
    inputs = ["-loop", "1", "-i", str(source)] if still else ["-stream_loop", "-1", "-ss", str(offset), "-i", str(source)]
    filters = ("scale=1280:610:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:76:color=0xf3f1e9,setsar=1,"
        f"drawtext=fontfile='{FONT}':text='{heading}':x=34:y=24:fontsize=25:fontcolor=0x26392e,"
        f"drawtext=fontfile='{FONT}':text='{label}':x=34:y=691:fontsize=13:fontcolor=0x586650")
    run([*inputs,"-t",str(seconds),"-vf",filters,"-an","-r","24","-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p",str(target)])
    print(f"Rendered {index}: {heading}",flush=True)
    return target


def main():
    capture = OUT / "live-capture/live-ui.mp4"
    if not capture.exists(): raise SystemExit("Capture the deployed website before assembling the film.")
    voice = OUT / "final-narration.mp3"
    if not voice.exists(): raise SystemExit("Generate narration first.")
    shots=OUT/"screenshots"; live=OUT/"live-capture"
    def shot(name,fallback):
        path=live/name
        return path if path.exists() else shots/fallback
    inputs = [
        (OUT / "threadline-thumbnail.png", 8, "Everyday support for memory loss and disability", "Illustrative family portrait - not a recorded call", 0),
        (ROOT / "assets/demo/dementia/images/tea-routine-pause-motion.mp4", 10.9, "One person. One interrupted afternoon.", "Synthetic illustration - fictional Evelyn scenario", 0),
        (shot("01-dashboard.jpg", "01-dashboard.png"), 8, "Threadline - context when it matters", "Actual deployed interface - example history clearly labeled", 0),
        (shot("02-transcripts.jpg", "03-transcripts.png"), 9.6, "The conversation becomes a memory", "Actual deployed interface - saved example words", 0),
        (capture, 8, "Her own words preserve the plan", "Recorded deployed website - fictional saved conversation", 7),
        (capture, 9, "Connect the words to what is visible", "Recorded deployed website - captured model response", 23),
        (OUT / "live-capture/fresh-ui.mp4", 6, "A fresh model response on the deployed website", "Actual Gemini request - fictional scene, new response", 0),
        (shot("01-dashboard.jpg", "01-dashboard.png"), 8, "Choose the support you need", "Actual deployed interface - four assistance modes", 0),
        (shot("07-hearing.jpg", "04-hearing.png"), 8.5, "Speech stays visible", "Actual interface - labeled example captions", 0),
        (shot("03-memory.jpg", "02-memory.png"), 12.1, "Follow the source, not a guess", "Actual deployed Memory graph - example conversations", 0),
        (shot("05-report.jpg", "06-report.png"), 12.8, "Review before sharing", "Actual report preview - no message or call sent", 0),
        (shot("06-library-fresh.jpg", "05-library.png"), 13.7, "An early prototype, with visible evidence", "Actual interface - example footage and captured reasoning", 0),
        (OUT / "threadline-thumbnail.png", 5.4, "Threadline - A little closer. Every day.", "Prototype - physical hardware requires separate testing", 0),
    ]
    parts = [segment(i, *data) for i, data in enumerate(inputs)]
    manifest = WORK / "concat.txt"
    manifest.write_text("\n".join(f"file '{p.as_posix()}'" for p in parts), encoding="utf-8")
    silent = WORK / "silent.mp4"
    run(["-f", "concat", "-safe", "0", "-i", str(manifest), "-c", "copy", str(silent)])
    # Preserve natural speech; pause between chapters rather than slowing the voice.
    cuts = [0, 14.4, 29, 43, 55.5, 63.6, 72.4, 83.1, 86.48]
    pauses = [3, 3, 9, 4, 4, 4, 3, 2]
    audio_parts = []
    def silence(index, seconds):
        path = WORK / f"silence-{index}.wav"
        run(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", str(seconds), str(path)])
        return path
    audio_parts.append(silence("start", 1.5))
    for i, (start, end) in enumerate(zip(cuts, cuts[1:])):
        part = WORK / f"voice-{i}.wav"
        run(["-ss", str(start), "-i", str(voice), "-t", str(end-start), "-ar", "44100", "-ac", "1", str(part)])
        audio_parts += [part, silence(i, pauses[i])]
    audio_manifest = WORK / "audio.txt"
    audio_manifest.write_text("\n".join(f"file '{p.as_posix()}'" for p in audio_parts), encoding="utf-8")
    padded_voice = WORK / "voice.wav"
    run(["-f", "concat", "-safe", "0", "-i", str(audio_manifest), "-c", "copy", str(padded_voice)])
    def shifted(value):
        h, m, sec = value.replace(",", ".").split(":")
        t = int(h)*3600 + int(m)*60 + float(sec)
        return t + 1.5 + sum(pauses[i] for i, boundary in enumerate(cuts[1:-1]) if t >= boundary)
    def stamp(t):
        ms=round(t*1000); h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);sec,ms=divmod(ms,1000)
        return f"{h:02}:{m:02}:{sec:02},{ms:03}"
    subtitle = (OUT / "final-narration.srt").read_text(encoding="utf-8")
    subtitle = re.sub(r"(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})", lambda m:f"{stamp(shifted(m[1]))} --> {stamp(shifted(m[2]))}", subtitle)
    captions = OUT / "threadline-two-minute-demo.srt"; captions.write_text(subtitle,encoding="utf-8")
    (OUT / "threadline-two-minute-demo.vtt").write_text("WEBVTT\n\n"+re.sub(r"(?m)^\d+\n", "", subtitle).replace(",", "."),encoding="utf-8")
    output = OUT / "threadline-two-minute-demo.mp4"
    # Captions are burned into the exported video as well as supplied separately.
    subpath = captions.as_posix().replace(":", "\\:")
    run(["-i", str(silent), "-i", str(padded_voice), "-map", "0:v:0", "-map", "1:a:0", "-vf", f"subtitles='{subpath}':force_style='FontName=Segoe UI,FontSize=19,Outline=1,MarginV=38'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-t", "120", "-movflags", "+faststart", str(output)])
    (OUT / "final-render-receipt.json").write_text(json.dumps({
        "duration_seconds": 120, "resolution": "1280x720", "fps": 24,
        "narration": "ElevenLabs Jessica; final-narration.mp3",
        "app_capture": "live-capture/live-ui.mp4",
        "sources": [{"path": str(p.relative_to(ROOT)).replace("\\", "/"), "seconds": n, "heading": h, "label": l} for p, n, h, l, _ in inputs],
        "synthetic_inputs": True, "external_messages_sent": False,
        "note": "Contains actual website recording plus labeled synthetic illustrations. Not a physical hardware validation."
    }, indent=2) + "\n", encoding="utf-8")
    print(output, flush=True)


if __name__ == "__main__":
    main()
