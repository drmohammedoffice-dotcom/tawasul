#!/usr/bin/env python3
"""
Lightweight local image caption via OCR + metadata.
Full Qwen3-VL remains optional; this provides usable image understanding offline.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
from pathlib import Path


def load_rgb(path: str):
    from PIL import Image
    import numpy as np

    with Image.open(path) as img:
        rgb = img.convert("RGB")
        return rgb, np.array(rgb)


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

    try:
        import easyocr

        pil_img, arr = load_rgb(image)
        sink = io.StringIO()
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            reader = easyocr.Reader(["ar", "en"], gpu=False, download_enabled=True, verbose=False)
            raw = reader.readtext(arr, detail=1)
        lines = [str(item[1]) for item in (raw or []) if item and len(item) >= 2]
        text = " ".join(lines).strip()
        caption = text[:240] if text else f"image {pil_img.width}x{pil_img.height} mode={pil_img.mode}"
        emit(
            {
                "ok": True,
                "provider": "local-vision-ocr",
                "modelId": "easyocr-ar-en",
                "data": {
                    "width": pil_img.width,
                    "height": pil_img.height,
                    "mode": pil_img.mode,
                    "ocrText": text,
                    "caption": caption,
                    "note": "Qwen3-VL weights not installed; EasyOCR+metadata used as local vision fallback.",
                },
            }
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        # Metadata-only fallback so vision jobs degrade instead of hard-fail.
        try:
            from PIL import Image

            img = Image.open(image)
            emit(
                {
                    "ok": True,
                    "provider": "local-vision-metadata",
                    "modelId": "easyocr-ar-en",
                    "data": {
                        "width": img.width,
                        "height": img.height,
                        "mode": img.mode,
                        "ocrText": "",
                        "caption": f"image {img.width}x{img.height} mode={img.mode}",
                        "note": f"OCR unavailable ({type(exc).__name__}); metadata only.",
                    },
                }
            )
            return 0
        except Exception as inner:  # noqa: BLE001
            emit({"ok": False, "status": "unavailable", "reason": f"vision_failed:{type(inner).__name__}:{inner}"})
            return 0



if __name__ == "__main__":
    raise SystemExit(main())
