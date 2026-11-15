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
        "README.md", "threadline-thumbnail.png", "final-video-script.md",
        "earlier-four-mode-concept.mp4", "earlier-four-mode-concept.vtt",
    )] + sorted((MEDIA / "screenshots").glob("*.png")) + [MEDIA / "screenshots/manifest.json"]
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
