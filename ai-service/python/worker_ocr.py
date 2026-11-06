#!/usr/bin/env python3
"""Local EasyOCR Arabic/English worker (PaddleOCR oneDNN broken on this Windows build).

Loads images via PIL→numpy so OpenCV never sees Unicode project paths.
Emits raw + logical + display + search OCR layers (see ocr_bidi.py).
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
from pathlib import Path

from ocr_bidi import process_ocr_payload


def load_rgb(path: str):
    from PIL import Image
    import numpy as np

    with Image.open(path) as img:
        return np.array(img.convert("RGB"))


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def main() -> int:
    req = json.load(sys.stdin)
    image = req.get("path") or ""
    if not image or not Path(image).exists():
        emit({"ok": False, "status": "unavailable", "reason": "image_missing"})
        return 0

    models_root = Path(__file__).resolve().parents[1] / "models" / "ocr" / "easyocr"
    models_root.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("EASYOCR_MODULE_PATH", str(models_root))
    arabic_order = str(req.get("arabicOrder") or os.environ.get("EASYOCR_ARABIC_ORDER") or "visual")

    try:
        import easyocr

        arr = load_rgb(image)
        sink = io.StringIO()
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            reader = easyocr.Reader(["ar", "en"], gpu=False, download_enabled=True, verbose=False)
            raw = reader.readtext(arr, detail=1)
        lines = []
        for item in raw or []:
            if not item or len(item) < 3:
                continue
            lines.append({"text": str(item[1]), "confidence": float(item[2])})
        data = process_ocr_payload(lines, arabic_order=arabic_order)
        data["note"] = (
            "PaddleOCR disabled on Windows oneDNN; EasyOCR via PIL/numpy path-safe load. "
            + data.get("note", "")
        )
        emit(
            {
                "ok": True,
                "provider": "easyocr",
                "modelId": "easyocr-ar-en",
                "data": data,
            }
        )
        return 0
    except Exception as exc:  # noqa: BLE001 — surface to Nest as unavailable
        emit({"ok": False, "status": "unavailable", "reason": f"ocr_failed:{type(exc).__name__}:{exc}"})
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
