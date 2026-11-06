#!/usr/bin/env python3
"""Local Faster-Whisper worker. Reads JSON from stdin, writes JSON to stdout."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    req = json.load(sys.stdin)
    audio = req.get("path") or ""
    model_dir = req.get("modelDir") or ""
    if not audio or not Path(audio).exists():
        json.dump({"ok": False, "status": "unavailable", "reason": "audio_missing"}, sys.stdout)
        return 0
    from faster_whisper import WhisperModel

    download_root = model_dir or str(Path(__file__).resolve().parents[1] / "models" / "speech")
    Path(download_root).mkdir(parents=True, exist_ok=True)
    model = WhisperModel(
        "small",
        device="cpu",
        compute_type="int8",
        download_root=download_root,
    )
    segments, info = model.transcribe(audio, language=req.get("language"), beam_size=1)
    text_parts = []
    for seg in segments:
        text_parts.append(seg.text.strip())
    json.dump(
        {
            "ok": True,
            "provider": "faster-whisper",
            "modelId": "faster-whisper-small",
            "data": {
                "text": " ".join(text_parts).strip(),
                "language": getattr(info, "language", None),
                "duration": getattr(info, "duration", None),
            },
        },
        sys.stdout,
        ensure_ascii=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
