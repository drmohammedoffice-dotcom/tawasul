#!/usr/bin/env python3
"""Unicode-aware OCR text normalization for EasyOCR Arabic output.

EasyOCR on this Windows stack emits Arabic *visual* (LTR-presented) order.
Layers:

- raw:     exact OCR string
- logical: recovered logical order for search / NLP
- display: UBA get_display(logical) for LTR surfaces that do not apply bidi
- search:  NFC / tatweel-stripped logical text

Recovery uses the Unicode Bidirectional Algorithm (python-bidi get_display)
for Arabic-script paragraphs, and Arabic letter-run mirroring when Latin or
European digits are mixed so phone numbers and IQD prices keep their places.
Full-string reverse is never applied.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

from bidi.algorithm import get_display

_ARABIC_LETTER_RUN = re.compile(
    r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+"
)
_LATIN_OR_DIGIT = re.compile(r"[A-Za-z0-9]")


def has_arabic(text: str) -> bool:
    return bool(_ARABIC_LETTER_RUN.search(text or ""))


def has_latin_or_digit(text: str) -> bool:
    return bool(_LATIN_OR_DIGIT.search(text or ""))


def mirror_arabic_letter_runs(text: str) -> str:
    """Mirror only Arabic letter runs; keep Latin, digits, and punctuation."""
    if not text:
        return text
    parts: list[str] = []
    last = 0
    for match in _ARABIC_LETTER_RUN.finditer(text):
        parts.append(text[last : match.start()])
        parts.append(match.group()[::-1])
        last = match.end()
    parts.append(text[last:])
    return "".join(parts)


def visual_to_logical(text: str) -> str:
    """Recover logical order from EasyOCR visual Arabic presentation."""
    if not text or not has_arabic(text):
        return text
    if has_latin_or_digit(text):
        # Mixed ads / phones: do not reorder whole paragraph — mirror Arabic runs only.
        return mirror_arabic_letter_runs(text)
    # Arabic-script paragraph: UBA get_display recovers logical from visual OCR.
    return get_display(text)


def normalize_search(text: str) -> str:
    if not text:
        return ""
    normalized = unicodedata.normalize("NFC", text)
    normalized = normalized.replace("\u0640", "")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def process_ocr_line(raw: str, *, arabic_order: str = "visual") -> dict[str, str]:
    raw = raw or ""
    if arabic_order == "visual" and has_arabic(raw):
        logical = visual_to_logical(raw)
    else:
        logical = raw
    display = get_display(logical) if has_arabic(logical) else logical
    return {
        "raw": raw,
        "logical": logical,
        "display": display,
        "search": normalize_search(logical),
    }


def process_ocr_payload(lines: list[dict[str, Any]], *, arabic_order: str = "visual") -> dict[str, Any]:
    processed = []
    for item in lines:
        text = str(item.get("text") or "")
        fields = process_ocr_line(text, arabic_order=arabic_order)
        processed.append(
            {
                "text": fields["logical"],
                "textRaw": fields["raw"],
                "textLogical": fields["logical"],
                "textDisplay": fields["display"],
                "textSearch": fields["search"],
                "confidence": float(item.get("confidence") or 0),
            }
        )
    logical_join = "\n".join(x["textLogical"] for x in processed)
    display_join = "\n".join(x["textDisplay"] for x in processed)
    search_join = " ".join(x["textSearch"] for x in processed if x["textSearch"])
    raw_join = "\n".join(x["textRaw"] for x in processed)
    return {
        "lines": processed,
        "text": logical_join,
        "textRaw": raw_join,
        "textLogical": logical_join,
        "textDisplay": display_join,
        "textSearch": search_join,
        "arabicOrderAssumed": arabic_order,
        "note": (
            "EasyOCR Arabic treated as visual presentation; "
            "logical via UBA get_display (Arabic-only) or Arabic letter-run mirror (mixed); "
            "display via UBA get_display(logical)."
        ),
    }
