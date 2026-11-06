#!/usr/bin/env python3
"""Unit tests for OCR bidi layers — no EasyOCR load required."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ocr_bidi import process_ocr_line, process_ocr_payload


def assert_eq(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r} got {actual!r}")


def main() -> int:
    ar = process_ocr_line("ةيئابرهك ةرايس دادغب")
    assert_eq(ar["logical"], "بغداد سيارة كهربائية", "ar.logical")
    assert "بغداد" in ar["search"], "ar.search"
    assert ar["raw"] == "ةيئابرهك ةرايس دادغب", "ar.raw"

    mixed = process_ocr_line("SALE 25000 IQD دادغب")
    assert_eq(mixed["logical"], "SALE 25000 IQD بغداد", "mixed.logical")
    assert "25000" in mixed["logical"], "mixed.price"

    phone = process_ocr_line("لصتا 07701234567 دادغب")
    assert_eq(phone["logical"], "اتصل 07701234567 بغداد", "phone.logical")
    assert "07701234567" in phone["logical"], "phone.digits"

    en = process_ocr_line("BAGHDAD ELECTRIC CAR")
    assert_eq(en["logical"], "BAGHDAD ELECTRIC CAR", "en.logical")

    payload = process_ocr_payload(
        [
            {"text": "دادغب", "confidence": 0.9},
            {"text": "Iraq Tech", "confidence": 0.8},
        ]
    )
    assert payload["textLogical"].split("\n")[0] == "بغداد", "payload.logical"
    assert "Iraq Tech" in payload["textLogical"], "payload.en"
    assert payload["textRaw"].startswith("دادغب"), "payload.raw"

    leave = process_ocr_line("بغداد", arabic_order="logical")
    assert_eq(leave["logical"], "بغداد", "leave.logical")

    print(json.dumps({"ok": True, "suite": "ocr_bidi"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
