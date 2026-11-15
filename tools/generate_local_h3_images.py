"""Render fictional editorial stills with the configured local image model.

Uses native ComfyUI image conditioning, six Euler steps, CFG 1, and no prompt
expander. Model filenames come from environment variables or the project .env.
No API credentials, video generation, or model downloads are used here.
"""

import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
SCENES = {
    "tea-routine-pause": (
        "A fictional photorealistic documentary-style editorial photograph of a "
        "dignified older South Asian woman in her seventies pausing thoughtfully "
        "at an oak kitchen counter in her ordinary home. She wears a soft sage "
        "cardigan over a cream shirt, with silver hair loosely tied back, and "
        "looks gently toward a single blue ceramic mug on the counter. A plain "
        "closed stainless steel electric kettle sits safely on its base farther "
        "back, alongside a small unmarked tea tin. Her hands rest naturally on "
        "the counter, no pouring or active cooking. Soft morning window light, "
        "warm cream cabinets, calm natural expression, authentic skin texture, "
        "subtle film grain, realistic proportions. Wide landscape frame, woman "
        "on the right, quiet negative space on the left. This illustrates a "
        "moment of interrupted routine, not illness or distress. No writing, "
        "logos, screens, medical equipment, wearable devices, steam or flames."
    ),
    "tea-routine-evidence": (
        "A fictional photorealistic editorial photograph looking straight down "
        "from directly above a calm home kitchen counter, a true bird's-eye view. "
        "counter in warm morning window light. One empty blue ceramic mug with "
        "its clean empty interior clearly visible is in the foreground, beside "
        "a plain unmarked closed tea tin and a small teaspoon resting on a "
        "saucer. Along the upper edge of the same oak counter is a closed stainless "
        "steel electric kettle safely seated on its base, with its spout facing "
        "left. A folded cream tea towel lies at the edge. The camera lens is "
        "vertically above the mug, looking directly at its clean ivory circular "
        "bottom, which is entirely visible with no liquid inside. Muted "
        "sage and warm cream kitchen background, precise believable object "
        "geometry, realistic materials, soft shadow, subtle film grain. Wide "
        "landscape composition with objects on the right half and uncluttered "
        "space to the left. No person, hands, text, labels, logos, screens, "
        "flames, steam, spill or medical equipment."
    ),
    "mug-plant": (
        "A quiet, photorealistic editorial still life photographed on a full-frame "
        "camera with a natural 50mm lens. A single matte ivory ceramic mug stands "
        "beside a small leafy pothos plant in a simple terracotta pot on a warm "
        "oak side table. Soft morning window light enters from the left, casting "
        "gentle long shadows across the wood grain. A cream curtain and pale "
        "sage wall are softly blurred in the background. Muted earthy colors, "
        "subtle film grain, believable material textures. Landscape composition "
        "with the mug and plant on the right half and calm negative space on the "
        "left. There are no people, hands, screens, logos, writing, or graphics."
    ),
    "older-hands-plant": (
        "A fictional photorealistic editorial photograph of an older South Asian "
        "woman's two natural hands gently touching the leaves of a small "
        "houseplant on a wooden table beside a window in her home. Only her "
        "forearms and hands enter from the left of the image; her face and body "
        "are outside the frame. She wears a plain soft cream cardigan with "
        "sleeves ending just above the wrists. Her left hand rests naturally on "
        "the table and her right fingertips lightly touch one leaf; both hands "
        "have five anatomically plausible fingers. Warm morning window light, "
        "muted sage leaves and terracotta pot, authentic lived-in household "
        "details, dignified everyday life, natural skin texture, shallow depth "
        "of field, landscape composition. No wristband, electronic device, "
        "medical equipment, text, logos, or graphics."
    ),
    "quiet-evening-desk": (
        "A fictional photorealistic editorial photograph of an adult woman in "
        "her thirties sitting at a modest oak desk in a cozy apartment after "
        "sunset. She is on the right side of the wide image, seen in natural "
        "three-quarter profile, pausing thoughtfully with a closed cream "
        "notebook and a ceramic mug nearby. Her hands rest comfortably on the "
        "desk with anatomically natural fingers. A warm shaded desk lamp "
        "illuminates her face while cool evening window light falls behind her. "
        "Muted sage, beige, and amber palette, relaxed posture, gentle serious "
        "expression, realistic skin, subtle film grain, ample quiet negative "
        "space on the left. No wearable device, visible computer screen, "
        "medical equipment, text, logos, or graphics."
    ),
}


def api(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        base + path,
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def workflow(model, encoder, vae, prompt, width, height, seed, prefix):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": model, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": encoder, "type": "minimax", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": vae}},
        "5": {"class_type": "MiniMaxH3ImageConditioning", "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt, "width": width, "height": height}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["5", 1], "seed": seed, "steps": 6, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", choices=SCENES)
    parser.add_argument("--width", type=int, default=1536)
    parser.add_argument("--height", type=int, default=864)
    parser.add_argument("--seed", type=int, default=814)
    parser.add_argument("--output", type=Path, default=ROOT / "assets/demo/visuals")
    args = parser.parse_args()
    if min(args.width, args.height) < 32 or args.width % 32 or args.height % 32:
        raise SystemExit("Dimensions must be positive multiples of 32.")
    load_dotenv(ROOT / ".env")
    names = ("MINIMAX_IMAGE_MODEL_FILE", "MINIMAX_TEXT_ENCODER_FILE", "MINIMAX_IMAGE_VAE_FILE")
    values = [os.environ.get(name) for name in names]
    if not all(values):
        raise SystemExit("Set " + ", ".join(name for name, value in zip(names, values) if not value))
    base = os.environ.get("LOCAL_COMFY_URL", "http://127.0.0.1:8188").rstrip("/")
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("LOCAL_COMFY_URL must be an HTTP loopback address.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise SystemExit("LOCAL_COMFY_URL must not include credentials or parameters.")
    args.output.mkdir(parents=True, exist_ok=True)
    output = args.output / f"{args.scene}.png"
    if output.exists():
        raise SystemExit(f"Refusing to overwrite {output}")
    evidence = ROOT / ".artifacts/local-h3-image"
    evidence.mkdir(parents=True, exist_ok=True)
    graph = workflow(*values, SCENES[args.scene], args.width, args.height, args.seed, f"threadline/{args.scene}")
    info = json.loads(api(base, "/object_info"))
    for node in graph.values():
        if node["class_type"] not in info:
            raise SystemExit(f"Missing node: {node['class_type']}")
    (evidence / f"{args.scene}.workflow.json").write_text(json.dumps(graph, indent=2), encoding="utf-8")
    result = json.loads(api(base, "/prompt", {"prompt": graph, "client_id": "threadline-images"}))
    prompt_id = result["prompt_id"]
    receipt = {"scene": args.scene, "prompt_id": prompt_id, "synthetic": True, "model_file": values[0], "encoder_file": values[1], "vae_file": values[2], "width": args.width, "height": args.height, "seed": args.seed, "prompt": SCENES[args.scene], "status": "queued"}
    receipt_path = evidence / f"{args.scene}.receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(f"Queued {args.scene}: {prompt_id}", flush=True)
    started = time.monotonic()
    last_notice = -15
    while time.monotonic() - started < 1800:
        elapsed = time.monotonic() - started
        history = json.loads(api(base, f"/history/{prompt_id}")).get(prompt_id)
        if history:
            status = history.get("status", {})
            if status.get("status_str") == "error":
                receipt.update(status="error", elapsed_seconds=round(elapsed, 2), errors=status.get("messages", []))
                receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
                raise RuntimeError(json.dumps(status.get("messages", [])))
            images = history.get("outputs", {}).get("9", {}).get("images", [])
            if images:
                item = images[0]
                query = urllib.parse.urlencode({"filename": item["filename"], "subfolder": item.get("subfolder", ""), "type": item.get("type", "output")})
                output.write_bytes(api(base, "/view?" + query))
                receipt.update(status="completed", elapsed_seconds=round(elapsed, 2), output=str(output), bytes=output.stat().st_size)
                receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
                public_receipt = {
                    key: value for key, value in receipt.items()
                    if key not in {"output", "prompt_id"}
                }
                public_receipt.update(
                    output=output.name,
                    runtime_repository="https://github.com/Comfy-Org/ComfyUI",
                    runtime_revision="eee59185ff4f43ae2d9ad122b245619d27d9daad",
                    steps=6,
                    sampler="euler",
                    scheduler="simple",
                    cfg=1,
                    visual_review="pending",
                    purpose="Fictional editorial illustration, not recorded patient data",
                )
                output.with_suffix(".json").write_text(
                    json.dumps(public_receipt, indent=2), encoding="utf-8"
                )
                print(f"Saved {output} ({elapsed:.1f}s)", flush=True)
                return
        if elapsed - last_notice >= 15:
            print(f"Rendering {args.scene}: {elapsed:.0f}s", flush=True)
            last_notice = elapsed
        time.sleep(3)
    raise TimeoutError(f"Generation still queued: {prompt_id}")


if __name__ == "__main__":
    main()
