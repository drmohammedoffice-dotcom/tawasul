# securechat-ai-service — Tawasul AI

Local-first AI runtime for SecureChat / تواصل. No Gemini, OpenAI, Anthropic, or other external AI APIs during operation.

## What works now (Dev laptop, after owner download approval)

- HTTP service on `127.0.0.1:3100`
- `OFFLINE_AI_MODE=true` blocks known external AI hosts
- Lexicon text understanding (`lexicon-1.0.0`) for Arabic, Iraqi terms, and English
- Optional GGUF enrichment via local `llama-server` + `Qwen3-4B-Q4_K_M.gguf`
- EasyOCR Arabic/English (PaddleOCR broken on this Windows oneDNN build)
- faster-whisper-small transcription (pin `av==12.3.0`)
- BGE-M3 embeddings (dim 1024)
- Vision fallback = OCR + image metadata (Qwen3-VL weights **not** installed)
- Job queue with retries, priority, idempotency, GPU/CPU concurrency caps
- Model registry under `manifests/models.registry.json`
- Lightweight linear training artifacts (not an LLM fine-tune)
- Internal token auth for all `/v1/*` routes

## Models on disk

| Model | Flag | Notes |
| --- | --- | --- |
| Qwen3-4B Q4_K_M GGUF | `ENABLE_TEXT_GGUF` | llama.cpp CPU; Vulkan optional later |
| EasyOCR ar+en | `ENABLE_OCR` | PIL→numpy load (Unicode path safe) |
| faster-whisper-small | `ENABLE_WHISPER` | Not for private voice recommendations |
| BGE-M3 | `ENABLE_EMBEDDINGS` | No pgvector yet |
| Qwen3-VL | `ENABLE_VISION` | Not downloaded; OCR fallback only |

## Run

```bash
cd ai-service
cp .env.example .env
# set AI_INTERNAL_TOKEN; enable heavy flags only after models exist under models/
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm install
npm run test
npm run dev
```

Optional separate llama process (or let the service start it):

```bash
.\bin\llama\cpu\llama-server.exe -m models\text\Qwen3-4B-Q4_K_M.gguf --host 127.0.0.1 --port 8081 -c 2048 -ngl 0 --jinja
```

Health (no token): `GET http://127.0.0.1:3100/health`

## Nest wiring

In `backend/.env`:

```
AI_SERVICE_URL=http://127.0.0.1:3100
AI_SERVICE_TOKEN=<same as AI_INTERNAL_TOKEN>
OFFLINE_AI_MODE=true
```

If the AI service is down, Nest keeps publishing content and falls back to the in-process lexicon. Ranking stays on `baseline-1.0.0` unless hybrid features are explicitly enabled.

## Privacy

- Private message fields are rejected by the API and training pipeline.
- Conversation signals remain disabled in the recommendation module.
- Model paths are never exposed to the public frontend; admin sees status only through Nest admin auth.

## Docs

- `docs/social-platform/33-tawasul-ai-local-engine-report.md` — scaffold
- `docs/social-platform/34-tawasul-ai-models-activation-report.md` — model activation results
