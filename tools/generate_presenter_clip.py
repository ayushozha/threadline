"""Animate the fictional presenter; configuration and credentials remain local."""
import base64
import json
import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/demo/project/son-cut"
load_dotenv(ROOT / ".env")


def main():
    key, model = os.environ["MINIMAX_API_KEY"], os.environ["MINIMAX_VIDEO_MODEL"]
    prompt = ("[Push in] Subtle documentary movement. The same fictional adult son sits "
              "at his kitchen table, notices his phone, gently picks it up, glances at it, "
              "then looks thoughtfully toward the window. Natural blink and breath, "
              "restrained concern softening to a slight warm smile. Preserve identity, "
              "clothing, hands, light and room. No talking or lip sync, no text or logos.")
    receipt = OUT / "presenter-receipt.json"
    with httpx.Client(timeout=90, headers={"Authorization": f"Bearer {key}"}) as client:
        state = json.loads(receipt.read_text()) if receipt.exists() else {}
        if not state.get("task_id"):
            image = base64.b64encode((OUT / "presenter.png").read_bytes()).decode()
            r = client.post("https://api.minimax.io/v1/video_generation", json={
                "model": model, "first_frame_image": "data:image/png;base64," + image,
                "prompt": prompt, "duration": 6, "resolution": "768P", "prompt_optimizer": False})
            r.raise_for_status()
            body = r.json()
            if not body.get("task_id"):
                raise SystemExit(f"Video creation rejected: {body.get('base_resp', {}).get('status_msg', 'unknown error')}")
            state = {"task_id": body["task_id"], "prompt": prompt,
                     "provider": "MiniMax", "source": "Fictional illustrative presenter", "status": "submitted"}
            receipt.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        for _ in range(40):
            r = client.get("https://api.minimax.io/v1/query/video_generation", params={"task_id": state["task_id"]})
            r.raise_for_status()
            body = r.json()
            state["status"] = body.get("status", "unknown")
            receipt.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
            print(f"Presenter clip: {state['status']}", flush=True)
            if state["status"] == "Success":
                f = client.get("https://api.minimax.io/v1/files/retrieve", params={"file_id": body["file_id"]})
                f.raise_for_status()
                download = f.json()["file"]["download_url"]
                with httpx.Client(timeout=90, follow_redirects=True) as download_client:
                    result = download_client.get(download)
                    result.raise_for_status()
                (OUT / "presenter.mp4").write_bytes(result.content)
                print(f"Saved presenter.mp4 ({len(result.content)} bytes)", flush=True)
                return
            if state["status"] in {"Fail", "Failed"}:
                raise SystemExit("Presenter generation failed.")
            time.sleep(10)
    raise SystemExit("Presenter still queued; rerun to resume the existing task.")


if __name__ == "__main__":
    main()
