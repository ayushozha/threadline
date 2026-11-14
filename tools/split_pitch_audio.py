"""Export editable narration chapters from the two approved-voice pitch masters."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'assets/demo/narration'

for topic in ('dementia', 'pms'):
    source = FOLDER / f'{topic}-jessica-final.mp3'
    chapters = json.loads((FOLDER / f'{topic}-chapters.json').read_text(encoding='utf-8'))
    destination = FOLDER / topic
    destination.mkdir(exist_ok=True)
    for index, chapter in enumerate(chapters, 1):
        output = destination / f'{index:02}-{chapter["section"].lower().replace(" ", "-")}.mp3'
        if output.exists():
            continue
        start = max(0, chapter['speech_start'] - .08)
        duration = chapter['speech_end'] - start + .12
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                        '-ss', str(start), '-t', str(duration), '-i', str(source),
                        '-af', 'adelay=120:all=1,apad=pad_dur=0.15',
                        '-c:a', 'libmp3lame', '-b:a', '192k', str(output)], check=True)
        print(output.relative_to(ROOT))
