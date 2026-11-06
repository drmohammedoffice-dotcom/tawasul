#!/usr/bin/env python3
"""
Sample video frames across the timeline and run Falconsai NSFW on each.
Does not rely on thumbnail-only. Requires ffmpeg on PATH.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# Reuse classify from worker_nsfw
sys.path.insert(0, str(Path(__file__).resolve().parent))
from worker_nsfw import classify  # noqa: E402


def probe_duration(path: str) -> float:
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        return max(0.1, float(out.decode().strip() or "0"))
    except Exception:  # noqa: BLE001
        return 0.0


def extract_frame(path: str, t: float, dest: Path) -> bool:
    try:
        subprocess.check_call(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{t:.3f}",
                "-i",
                path,
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(dest),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=60,
        )
        return dest.exists() and dest.stat().st_size > 0
    except Exception:  # noqa: BLE001
        return False


def main() -> int:
    req = json.load(sys.stdin)
    path = str(req.get("path") or "")
    model_dir = str(req.get("modelDir") or "")
    if not path or not Path(path).exists():
        sys.stdout.write(json.dumps({"ok": False, "reason": "missing_path", "inference": False}))
        return 0
    if not model_dir:
        model_dir = str(Path(__file__).resolve().parents[1] / "models" / "nsfw")

    duration = probe_duration(path)
    if duration <= 0:
        sys.stdout.write(json.dumps({"ok": False, "reason": "ffprobe_failed", "inference": False}))
        return 0

    # Spread samples across timeline (not start-only). Dense mid samples if short.
    fracs = [0.1, 0.3, 0.5, 0.7, 0.9] if duration >= 4 else [0.2, 0.5, 0.8]
    frames = []
    max_score = 0.0
    worst_label = "normal"
    with tempfile.TemporaryDirectory(prefix="tawasul_nsfw_vid_") as tmp:
        for i, f in enumerate(fracs):
            t = min(duration * f, max(0.0, duration - 0.05))
            dest = Path(tmp) / f"f{i}.jpg"
            if not extract_frame(path, t, dest):
                continue
            try:
                r = classify(str(dest), model_dir)
            except Exception as exc:  # noqa: BLE001
                frames.append({"t": t, "ok": False, "reason": str(exc)[:120]})
                continue
            score = float(r.get("nsfwScore") or 0)
            label = str(r.get("label") or "normal")
            frames.append({"t": round(t, 3), "ok": True, "label": label, "nsfwScore": score})
            if score > max_score:
                max_score = score
                worst_label = label

    if not any(f.get("ok") for f in frames):
        sys.stdout.write(
            json.dumps({"ok": False, "reason": "no_frames", "inference": False, "duration": duration})
        )
        return 0

    if max_score >= 0.72:
        label = "nsfw"
    elif max_score >= 0.45 or worst_label == "uncertain":
        label = "uncertain"
    else:
        label = "normal"

    sys.stdout.write(
        json.dumps(
            {
                "ok": True,
                "inference": True,
                "weightsLoaded": True,
                "provider": "ffmpeg+falconsai-nsfw",
                "modelId": "Falconsai/nsfw_image_detection",
                "modelVersion": "falconsai-nsfw-vit-v1",
                "label": label,
                "nsfwScore": round(max_score, 4),
                "duration": duration,
                "frames": frames,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
