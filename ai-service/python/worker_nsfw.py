#!/usr/bin/env python3
"""
Local NSFW image classifier for Tawasul moderation.

Model: Falconsai/nsfw_image_detection (Apache-2.0, commercial OK)
ViT-based binary classifier (nsfw | normal). Runs on CPU by default.
Does not perform face recognition or person identification.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

MODEL_ID = "Falconsai/nsfw_image_detection"
MODEL_VERSION = "falconsai-nsfw-vit-v1"


def classify(path: str, model_dir: str) -> dict:
    from PIL import Image
    import torch
    from transformers import AutoImageProcessor, AutoModelForImageClassification

    cache = Path(model_dir)
    cache.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    processor = AutoImageProcessor.from_pretrained(MODEL_ID, cache_dir=str(cache))
    model = AutoModelForImageClassification.from_pretrained(MODEL_ID, cache_dir=str(cache))
    model.eval()

    with Image.open(path) as img:
        image = img.convert("RGB")

    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)[0]

    id2label = {int(k): v for k, v in model.config.id2label.items()}
    scores = {id2label[i]: float(probs[i]) for i in range(len(probs))}
    nsfw_score = float(scores.get("nsfw", scores.get("NSFW", 0.0)))
    normal_score = float(scores.get("normal", scores.get("Normal", 1.0 - nsfw_score)))
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    # Conservative thresholds — uncertain band goes to human review upstream.
    if nsfw_score >= 0.72:
        label = "nsfw"
        confidence = nsfw_score
    elif nsfw_score >= 0.45:
        label = "uncertain"
        confidence = nsfw_score
    else:
        label = "normal"
        confidence = normal_score

    return {
        "ok": True,
        "provider": "transformers",
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "license": "Apache-2.0",
        "inference": True,
        "weightsLoaded": True,
        "label": label,
        "nsfwScore": round(nsfw_score, 4),
        "normalScore": round(normal_score, 4),
        "scores": scores,
        "elapsedMs": elapsed_ms,
        "device": "cpu",
    }


def main() -> int:
    req = json.load(sys.stdin)
    path = str(req.get("path") or "")
    model_dir = str(req.get("modelDir") or os.environ.get("NSFW_MODEL_DIR") or "")
    if not path or not Path(path).exists():
        sys.stdout.write(json.dumps({"ok": False, "reason": "missing_path", "inference": False}))
        return 0
    if not model_dir:
        model_dir = str(Path(__file__).resolve().parents[1] / "models" / "nsfw")
    try:
        out = classify(path, model_dir)
        sys.stdout.write(json.dumps(out, ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(
            json.dumps(
                {
                    "ok": False,
                    "reason": str(exc)[:300],
                    "inference": False,
                    "weightsLoaded": False,
                    "modelId": MODEL_ID,
                },
                ensure_ascii=False,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
