#!/usr/bin/env python3
"""Average-hash (aHash) perceptual fingerprint for local images. No face ID."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def ahash_hex(path: str, size: int = 8) -> str:
    from PIL import Image

    with Image.open(path) as img:
        gray = img.convert("L").resize((size, size), Image.Resampling.LANCZOS)
        pixels = list(gray.getdata())
    avg = sum(pixels) / len(pixels)
    bits = "".join("1" if p >= avg else "0" for p in pixels)
    return f"{int(bits, 2):0{size * size // 4}x}"


def main() -> int:
    req = json.load(sys.stdin)
    path = str(req.get("path") or "")
    if not path or not Path(path).exists():
        sys.stdout.write(json.dumps({"ok": False, "reason": "missing"}))
        return 0
    try:
        value = ahash_hex(path)
        sys.stdout.write(
            json.dumps(
                {
                    "ok": True,
                    "kind": "ahash",
                    "value": value,
                    "note": "8x8 average hash; Hamming distance used for near-dupes",
                },
                ensure_ascii=False,
            )
        )
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(json.dumps({"ok": False, "reason": f"{type(exc).__name__}:{exc}"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
