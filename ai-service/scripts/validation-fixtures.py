#!/usr/bin/env python3
"""Generate OCR/audio fixtures for integration validation (local only)."""
from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "models" / "fixtures"
ROOT.mkdir(parents=True, exist_ok=True)


def font(size: int):
    for name in (
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\tahoma.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\msyh.ttc",
    ):
        p = Path(name)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                continue
    return ImageFont.load_default()


def save_text(name: str, lines: list[str], size: int = 48, rotate: int = 0, blurish: bool = False):
    f = font(size)
    # measure
    tmp = Image.new("RGB", (10, 10), "white")
    d = ImageDraw.Draw(tmp)
    widths, heights = [], []
    for line in lines:
        box = d.textbbox((0, 0), line, font=f)
        widths.append(box[2] - box[0])
        heights.append(box[3] - box[1])
    w = max(widths) + 80
    h = sum(heights) + 40 * len(lines) + 60
    img = Image.new("RGB", (max(w, 400), max(h, 160)), "white")
    d = ImageDraw.Draw(img)
    y = 30
    for i, line in enumerate(lines):
        d.text((40, y), line, fill="black", font=f)
        y += heights[i] + 28
    if rotate:
        img = img.rotate(rotate, expand=True, fillcolor="white")
    if blurish:
        img = img.resize((img.width // 2, img.height // 2)).resize(img.size)
    out = ROOT / name
    img.save(out)
    print("wrote", out.name, out.stat().st_size)


def write_tone(name: str, seconds: float = 1.5, freq: float = 880.0):
    rate = 16000
    n = int(rate * seconds)
    out = ROOT / name
    with wave.open(str(out), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(n):
            val = int(12000 * math.sin(2 * math.pi * freq * (i / rate)))
            frames += struct.pack("<h", val)
        w.writeframes(frames)
    print("wrote", out.name, out.stat().st_size)


def main() -> None:
    save_text("ocr-en-clear.png", ["BAGHDAD ELECTRIC CAR", "Iraq Tech 2026"])
    save_text("ocr-ar-clear.png", ["بغداد سيارة كهربائية", "تكنولوجيا العراق"])
    save_text("ocr-mixed.png", ["Baghdad بغداد", "Electric سيارة"])
    save_text("ocr-ad.png", ["خصم 50%", "اشتري الآن", "SALE TODAY"], size=56)
    save_text("ocr-tilted.png", ["بغداد", "BAGHDAD"], size=52, rotate=12)
    save_text("ocr-lowqual.png", ["سيارة كهربائية"], size=40, blurish=True)
    write_tone("tone.wav", 2.0, 880.0)
    write_tone("tone-noise.wav", 2.0, 220.0)
    print("fixtures-ready", ROOT)


if __name__ == "__main__":
    main()
