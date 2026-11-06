#!/usr/bin/env python3
"""Local BGE-M3 embedding worker."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    req = json.load(sys.stdin)
    texts = req.get("texts") or []
    if not isinstance(texts, list) or not texts:
        json.dump({"ok": False, "status": "unavailable", "reason": "texts_missing"}, sys.stdout)
        return 0
    model_dir = req.get("modelDir") or str(Path(__file__).resolve().parents[1] / "models" / "embeddings" / "bge-m3")
    Path(model_dir).mkdir(parents=True, exist_ok=True)
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer("BAAI/bge-m3", cache_folder=model_dir)
    vectors = model.encode([str(t)[:4000] for t in texts], normalize_embeddings=True)
    json.dump(
        {
            "ok": True,
            "provider": "bge-m3",
            "modelId": "bge-m3",
            "data": {
                "dim": int(len(vectors[0])),
                "count": len(vectors),
                "vectors": [v.tolist() for v in vectors],
            },
        },
        sys.stdout,
        ensure_ascii=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
