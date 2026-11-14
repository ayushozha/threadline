"""Generate a separate, versioned narration take through ElevenLabs Text to Dialogue."""
import argparse
import hashlib
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", type=Path, default=ROOT / "assets/demo/narration/narration.txt")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.text, args.output = args.text.resolve(), args.output.resolve()
    key = os.getenv("ELEVENLABS_API_KEY")
    model, voice = os.getenv("ELEVENLABS_MODEL"), os.getenv("ELEVENLABS_VOICE_ID")
    if not all((key, model, voice)):
        raise SystemExit("Set ELEVENLABS_API_KEY, ELEVENLABS_MODEL, and ELEVENLABS_VOICE_ID.")
    if args.output.exists() or args.output.with_suffix(".json").exists():
        raise SystemExit("Choose an unused output path; existing takes are preserved.")
    text = args.text.read_text(encoding="utf-8").strip()
    if len(text) > 2000:
        raise SystemExit("Keep Text to Dialogue input under 2,000 characters for reliable generation.")
    payload = {"model_id": model, "language_code": "en", "inputs": [{"text": text, "voice_id": voice}],
               "settings": {"stability": float(os.getenv("NARRATION_STABILITY", "0.35")),
                            "similarity_boost": float(os.getenv("NARRATION_SIMILARITY", "0.7"))}}
    with httpx.Client(timeout=180) as client:
        response = client.post(
            "https://api.elevenlabs.io/v1/text-to-dialogue",
            headers={"xi-api-key": key},
            params={"output_format": "mp3_44100_128"},
            json=payload,
        )
    if response.status_code != 200:
        raise SystemExit(f"ElevenLabs HTTP {response.status_code}; no audio written.")
    if not response.headers.get("content-type", "").startswith("audio/"):
        raise SystemExit("Provider returned non-audio content; no file written.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(response.content)
    receipt = {
        "provider": "ElevenLabs", "endpoint": "/v1/text-to-dialogue", "voice_id": voice,
        "model": model, "text_file": str(args.text.relative_to(ROOT)),
        "text_sha256": hashlib.sha256(text.encode()).hexdigest(), "characters": len(text),
        "audio_bytes": len(response.content), "request_id": response.headers.get("request-id"),
        "audio_tags_added": "[" in text, "settings": payload["settings"], "assembled_video": False,
        "quality_review": "Technical validation pending; subjective listening not performed.",
    }
    args.output.with_suffix(".json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "bytes": len(response.content)}))


if __name__ == "__main__":
    main()
