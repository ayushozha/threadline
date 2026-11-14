"""Generate separate ElevenLabs narration assets; never assembles a video."""
import argparse
import hashlib
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--text', type=Path, default=ROOT / 'assets/demo/narration/narration.txt')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/demo/narration/narration.mp3')
    args = parser.parse_args()
    args.text, args.output = args.text.resolve(), args.output.resolve()
    key = os.getenv('ELEVENLABS_API_KEY')
    voice, model = os.getenv('ELEVENLABS_VOICE_ID'), os.getenv('ELEVENLABS_MODEL')
    if not all((key, voice, model)):
        raise SystemExit('Set ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, and ELEVENLABS_MODEL in .env')
    if args.output.exists():
        raise SystemExit('Output exists; select another path to preserve the current version.')
    text = args.text.read_text(encoding='utf-8').strip()
    with httpx.Client(timeout=120) as client:
        response = client.post(
            f'https://api.elevenlabs.io/v1/text-to-speech/{voice}',
            headers={'xi-api-key': key}, params={'output_format':'mp3_44100_128'},
            json={'text':text, 'model_id':model, 'voice_settings':{
                'stability':float(os.getenv('NARRATION_STABILITY','0.5')),
                'similarity_boost':0.78,
                'style':float(os.getenv('NARRATION_STYLE','0.1')),
                'speed':float(os.getenv('NARRATION_SPEED','0.96')),
                'use_speaker_boost':True,
            }},
        )
        if response.status_code != 200:
            raise SystemExit(f'ElevenLabs HTTP {response.status_code}; no audio written.')
        if not response.headers.get('content-type','').startswith('audio/'):
            raise SystemExit('Provider returned non-audio content; no file written.')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_bytes(response.content)
    receipt = {'provider':'ElevenLabs','voice_id':voice,'model':model,'text_file':str(args.text.relative_to(ROOT)),
               'text_sha256':hashlib.sha256(text.encode()).hexdigest(),'audio_bytes':len(response.content),
               'request_id':response.headers.get('request-id'),'assembled_video':False}
    args.output.with_suffix('.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(args.output),'bytes':len(response.content)}))


if __name__=='__main__':
    main()
