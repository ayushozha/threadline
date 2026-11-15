"""Build the downloadable Threadline media kit from reviewed local artifacts."""
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "assets/demo/project"


def main():
    copies = {
        ROOT / "docs/demo/FINAL_VIDEO_SCRIPT.md": "final-video-script.md",
        ROOT / "assets/demo/accessibility/threadline-four-modes.mp4": "earlier-four-mode-concept.mp4",
        ROOT / "assets/demo/accessibility/narration.vtt": "earlier-four-mode-concept.vtt",
        ROOT / "assets/demo/accessibility/poster.jpg": "earlier-concept-poster.jpg",
    }
    for source, name in copies.items():
        if not source.is_file() or source.stat().st_size == 0:
            raise SystemExit(f"Required source missing: {source.relative_to(ROOT)}")
        shutil.copyfile(source, MEDIA / name)
    files = [MEDIA / name for name in (
        "README.md", "threadline-thumbnail.png", "final-video-script.md", "index.html", "media.css",
        "threadline-two-minute-demo.mp4", "final-video-poster.jpg", "final-render-receipt.json",
        "final-narration.mp3", "final-narration.srt", "final-narration.vtt", "final-narration.chapters.json", "narration.txt",
        "earlier-four-mode-concept.mp4", "earlier-four-mode-concept.vtt", "earlier-concept-poster.jpg",
    )] + sorted((MEDIA / "screenshots").glob("*.png")) + [MEDIA / "screenshots/manifest.json"]
    files.extend(sorted((MEDIA / "live-capture").glob("*")))
    for optional in ("threadline-two-minute-demo.srt", "threadline-two-minute-demo.vtt"):
        if (MEDIA / optional).is_file():
            files.append(MEDIA / optional)
    if len(list((MEDIA / "screenshots").glob("*.png"))) != 6:
        raise SystemExit("Expected the six reviewed screenshots.")
    for source in files:
        if not source.is_file() or source.stat().st_size == 0:
            raise SystemExit(f"Required media missing: {source.relative_to(ROOT)}")
    output = MEDIA / "threadline-media-kit.zip"
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for source in files:
            archive.write(source, f"threadline-media-kit/{source.relative_to(MEDIA).as_posix()}")
    with zipfile.ZipFile(output) as archive:
        if broken := archive.testzip():
            raise SystemExit(f"ZIP verification failed: {broken}")
        print(f"Created {output.relative_to(ROOT)}: {len(archive.namelist())} files, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
