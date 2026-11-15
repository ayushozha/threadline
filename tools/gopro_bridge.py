"""GoPro → Threadline bridge (Open GoPro over USB or Wi-Fi).

The GoPro LIT HERO cannot act as a USB webcam, but it supports the Open GoPro API
(firmware v01.10.00+). Over USB the camera appears as a network device at
172.2X.1YZ.51 (X, Y, Z = last three digits of its serial number). This script:

  1. finds the camera on the USB network (or uses --camera IP),
  2. enables wired control and starts its video stream (UDP MPEG-TS to this Mac),
  3. turns the stream into ~1 JPEG per second with ffmpeg,
  4. posts each frame to Threadline (/api/vision/frame) with the owner's publish key.

Gemini Live memory help then sees what the GoPro sees. Frames are not stored on disk.

Usage:
  uv run python tools/gopro_bridge.py                       # hosted site, key from .env DEMO_WATCH_KEY
  uv run python tools/gopro_bridge.py --server http://127.0.0.1:8000 --camera 172.26.151.51
"""

import argparse
import os
import re
import signal
import subprocess
import sys
import threading
import time

import httpx
from dotenv import dotenv_values

STREAM_PORT = 8554


def find_camera_ip() -> str | None:
    """The Mac gets an address 172.2X.1YZ.5x on the GoPro's USB network; the camera is .51."""
    try:
        out = subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return None
    for match in re.finditer(r"inet (172\.2\d\.1\d\d)\.(\d+)", out):
        return f"{match.group(1)}.51"
    return None


def gopro(client: httpx.Client, base: str, path: str) -> int:
    try:
        return client.get(f"{base}{path}", timeout=5).status_code
    except httpx.HTTPError as exc:
        print(f"  camera did not answer {path}: {exc.__class__.__name__}")
        return 0


def read_jpegs(stream):
    """Split ffmpeg's MJPEG pipe into JPEG frames (FFD8 … FFD9)."""
    buf = b""
    while chunk := stream.read(65536):
        buf += chunk
        while True:
            start = buf.find(b"\xff\xd8")
            end = buf.find(b"\xff\xd9", start + 2)
            if start < 0 or end < 0:
                break
            yield buf[start:end + 2]
            buf = buf[end + 2:]


def main() -> int:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = dotenv_values(os.path.join(here, ".env"))
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--server", default="https://threadline.ayushojha.com")
    parser.add_argument("--camera", help="Camera IP (default: find it on the USB network)")
    parser.add_argument("--fps", type=float, default=1.0, help="Frames per second sent to Threadline (default 1)")
    parser.add_argument("--name", default="GoPro LIT HERO")
    args = parser.parse_args()

    key = os.getenv("DEMO_WATCH_KEY") or env.get("DEMO_WATCH_KEY")
    if not key:
        print("No DEMO_WATCH_KEY in the environment or .env — the server only accepts frames from the owner.")
        return 1
    camera = args.camera or find_camera_ip()
    if not camera:
        print("No GoPro found on the USB network. On the camera: Preferences → Connections → USB Connection → "
              "GoPro Connect, then re-plug the cable. (Firmware v01.10.00+ is required for Open GoPro.)")
        return 1
    base = f"http://{camera}:8080"
    print(f"GoPro at {camera}")

    cam = httpx.Client()
    gopro(cam, base, "/gopro/camera/control/wired_usb?p=1")       # take USB control
    gopro(cam, base, "/gopro/camera/stream/stop")                   # clear a stale stream
    status = gopro(cam, base, f"/gopro/camera/stream/start?port={STREAM_PORT}")
    if status != 200:
        print(f"Couldn't start the GoPro stream (HTTP {status}). Is the camera awake and in GoPro Connect mode?")
        return 1
    print("GoPro stream started")

    stop = threading.Event()

    def keep_alive():
        while not stop.wait(3):
            gopro(cam, base, "/gopro/camera/keep_alive")
    threading.Thread(target=keep_alive, daemon=True).start()

    ffmpeg = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-fflags", "nobuffer", "-flags", "low_delay",
         "-i", f"udp://@0.0.0.0:{STREAM_PORT}?overrun_nonfatal=1&fifo_size=50000000",
         "-vf", f"fps={args.fps},scale=640:-2", "-q:v", "6", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
        stdout=subprocess.PIPE)

    def shutdown(*_):
        stop.set()
        ffmpeg.terminate()
        gopro(cam, base, "/gopro/camera/stream/stop")
        print("\nStopped the GoPro stream.")
        sys.exit(0)
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    sent = 0
    with httpx.Client(timeout=10) as server:
        for jpeg in read_jpegs(ffmpeg.stdout):
            try:
                r = server.post(f"{args.server}/api/vision/frame", content=jpeg,
                                headers={"Content-Type": "image/jpeg", "X-Publish-Key": key, "X-Camera": args.name})
                sent += 1
                if r.status_code != 200 or sent % 10 == 1:
                    print(f"frame {sent}: {len(jpeg) // 1024} KB → {r.status_code}")
            except httpx.HTTPError as exc:
                print(f"frame {sent}: server unreachable ({exc.__class__.__name__})")
            time.sleep(0)
    shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
