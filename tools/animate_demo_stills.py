"""Render separate five-second editorial push-ins from the reviewed stills."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for source in sorted((ROOT / 'assets/demo/visuals').glob('*.png')):
    output = source.with_name(source.stem + '-motion.mp4')
    if output.exists():
        continue
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
        '-vf', "scale=1920:1080,zoompan=z='1+0.025*on/119':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=120:s=1920x1080:fps=24",
        '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', str(output),
    ], check=True)
    print(output.relative_to(ROOT))
