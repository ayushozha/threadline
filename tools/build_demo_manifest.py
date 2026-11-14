"""Inspect separate demo assets with ffprobe and record hashes and provenance."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'assets/demo'


def main():
    assets = []
    for path in sorted(FOLDER.rglob('*')):
        if not path.is_file() or path.suffix not in {'.png', '.mp3', '.wav', '.webm', '.mp4'}:
            continue
        if any(part.endswith('-frames') or part.startswith('.') for part in path.relative_to(FOLDER).parts):
            continue
        inspected = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries',
             'format=duration:stream=codec_name,width,height,sample_rate,channels:stream_tags=alpha_mode',
             '-of', 'json', str(path)], capture_output=True, text=True, check=True,
        )
        relative = path.relative_to(FOLDER).as_posix()
        provenance = ('Current local app capture with fictional notes and real demo-calendar endpoints' if path.name.startswith('current-')
                      else 'Actual deployed earlier app capture with fictional notes and local retrieval' if 'ui-' in path.name
                      else 'MiniMax local image generation; fictional editorial scene' if path.parent.name == 'visuals'
                      else 'ElevenLabs stock female voice; synthetic editorial narration' if path.suffix == '.mp3'
                      else 'Original procedural sound cue' if path.suffix == '.wav'
                      else 'Original SVG/CSS editorial graphic or browser preview')
        assets.append({'path':relative, 'bytes':path.stat().st_size,
                       'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                       'provenance':provenance, **json.loads(inspected.stdout)})
    manifest = {'project':'Threadline', 'assembled_video':False, 'target_edit_seconds':'60–75 per pitch',
                'primary_narration':{'dementia':'narration/dementia-jessica-final.mp3',
                                     'pms':'narration/pms-jessica-final.mp3'},
                'images_generated':len(list((FOLDER/'visuals').glob('*.png'))),
                'limitations':['Fictional examples; no medical assessment or validated clinical effect.',
                               'UI captures show local keyword retrieval, not live AI.',
                               'Narration is editorial voiceover, not connected app speech.',
                               'Current captures show local app; ui-prefixed captures show earlier scaffold.',
                               'Wearable capture and real external agent actions are not implemented.'],
                'assets':assets}
    (FOLDER/'manifest.json').write_text(json.dumps(manifest,separators=(',', ':'),ensure_ascii=False),encoding='utf-8')
    print(f'Inspected {len(assets)} media assets; {manifest["images_generated"]} generated images.')


if __name__ == '__main__':
    main()
