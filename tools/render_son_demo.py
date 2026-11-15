"""Build a matched son-perspective film from recorded UI events and chapter audio."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/demo/project/son-cut"
WORK = ROOT / ".artifacts/son-render"
WORK.mkdir(parents=True, exist_ok=True)
FONT = "C\\:/Windows/Fonts/segoeui.ttf"


def run(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)]))


def render_segment(index, path, seconds, label, *, start=0, source_seconds=None, crop=None):
    dest = WORK / f"part-{index:02}.mp4"
    still = path.suffix.lower() in {".jpg", ".jpeg", ".png"}
    args = ["-loop", "1", "-i", str(path)] if still else ["-ss", str(start), "-t", str(source_seconds or seconds), "-i", str(path)]
    label = label.replace("'", "’")
    fit = (f"crop={crop}," if crop else "") + "scale=1280:570:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:36:color=0xf3f1e9,setsar=1"
    if not still:
        fit += f",tpad=stop_mode=clone:stop_duration={seconds}"
        if index in (0,7):
            fit += f",zoompan=z='1+0.018*on/{seconds*24}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=24"
    if index == 0:
        fit += f",drawtext=fontfile='{FONT}':text='Mum called. Again.':x=700:y=155:fontsize=42:fontcolor=0x22402d:box=1:boxcolor=0xf3f1e9@0.92:boxborderw=14"
    if index == 7:
        fit += f",drawtext=fontfile='{FONT}':text='One conversation closer.':x=630:y=155:fontsize=36:fontcolor=0x22402d:box=1:boxcolor=0xf3f1e9@0.92:boxborderw=14"
    if index == 5:
        label = "English translation - Your glasses are on the wooden table beside the blue cup."
    fit += f",fade=t=in:st=0:d=0.2,fade=t=out:st={max(0,seconds-.2)}:d=0.2,drawtext=fontfile='{FONT}':text='{label}':x=28:y=12:fontsize=13:fontcolor=0x435844"
    run([*args, "-t", str(seconds), "-vf", fit, "-r", "24", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", str(dest)])
    return dest


def stamp(t, sep=","):
    ms = round(t*1000); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02}{sep}{ms:03}"


def main():
    plan = json.loads((OUT / "edit-plan.json").read_text(encoding="utf-8"))
    video_parts, audio_parts, captions, timeline = [], [], [], []
    cursor = 0.0
    for index, shot in enumerate(plan["shots"]):
        audio = OUT / "narration" / f"{shot['chapter']}.mp3"
        voice_seconds = duration(audio)
        seconds = max(voice_seconds+.6, shot["seconds"])
        source = ROOT / shot["source"]
        video_parts.append(render_segment(index, source, seconds, shot["label"], start=shot.get("start",0), source_seconds=shot.get("source_seconds"), crop=shot.get("crop")))
        wav = WORK / f"voice-{index:02}.wav"
        # The answer cannot be narrated before it actually arrives on screen.
        if shot['chapter'] == '07-language':
            run(["-i",str(audio),"-filter_complex","[0:a]atrim=0:5.6,asetpts=PTS-STARTPTS[a];anullsrc=r=44100:cl=mono,atrim=duration=9[s];[0:a]atrim=start=5.6,asetpts=PTS-STARTPTS[b];[a][s][b]concat=n=3:v=0:a=1,adelay=250|250,apad[out]","-map","[out]","-t",str(seconds),"-ar","44100","-ac","1",str(wav)])
        else:
            run(["-i", str(audio), "-af", "adelay=250|250,apad", "-t", str(seconds), "-ar", "44100", "-ac", "1", str(wav)])
        audio_parts.append(wav)
        aligned = audio.with_suffix(".srt")
        if aligned.exists():
            content = aligned.read_text(encoding="utf-8")
            for block in content.strip().split("\n\n"):
                lines = block.splitlines()
                if len(lines)<3: continue
                m = re.match(r"(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})", lines[1])
                if not m: continue
                n = [int(v) for v in m.groups()]
                a,b=(n[0]*3600+n[1]*60+n[2]+n[3]/1000),(n[4]*3600+n[5]*60+n[6]+n[7]/1000)
                if shot['chapter']=='07-language':
                    if a >= 5.6: a += 9
                    if b >= 5.6: b += 9
                captions.append(f"{len(captions)+1}\n{stamp(cursor+.25+a)} --> {stamp(cursor+.25+b)}\n"+'\n'.join(lines[2:]))
        timeline.append({**shot,"at":round(cursor,3),"actual_seconds":round(seconds,3),"voice_seconds":voice_seconds})
        cursor += seconds
        print(f"Chapter {index+1}: {seconds:.1f}s",flush=True)
    for name, files in [("video",video_parts),("audio",audio_parts)]:
        manifest=WORK/f"{name}.txt";manifest.write_text('\n'.join(f"file '{p.as_posix()}'" for p in files),encoding="utf-8")
        run(["-f","concat","-safe","0","-i",str(manifest),"-c","copy",str(WORK/("joined.mp4" if name=="video" else "joined.wav"))])
    srt=OUT/"newfilm.srt";srt.write_text('\n\n'.join(captions)+'\n',encoding="utf-8")
    (OUT/"newfilm.vtt").write_text('WEBVTT\n\n'+re.sub(r'(?m)^\d+\n','',srt.read_text(encoding="utf-8")).replace(',','.'),encoding="utf-8")
    subpath=srt.as_posix().replace(':','\\:')
    run(["-i",str(WORK/"joined.mp4"),"-i",str(WORK/"joined.wav"),"-map","0:v","-map","1:a","-vf",f"subtitles='{subpath}':force_style='FontName=Segoe UI,FontSize=17,Outline=1,MarginV=12,WrapStyle=0'","-c:v","libx264","-preset","veryfast","-crf","19","-af","loudnorm=I=-18:TP=-1.5:LRA=11","-c:a","aac","-b:a","160k","-movflags","+faststart",str(OUT/"newfilm.mp4")])
    (OUT/"render-receipt.json").write_text(json.dumps({"duration_seconds":cursor,"timeline":timeline,"narrator":"Chris; dramatized son perspective","source_type":"Actual recorded website interactions plus labeled illustrative portrait","voice":"Natural English male chapter narration; no voice speeding","captions":"Word-aligned captions in lower margin"},indent=2)+'\n',encoding="utf-8")
    print(f"Completed {cursor:.2f}s film",flush=True)


if __name__ == "__main__": main()
