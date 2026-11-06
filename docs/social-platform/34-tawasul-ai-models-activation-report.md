# 34 — تفعيل النماذج المحلية لتواصل AI

تاريخ التنفيذ: 3 نوفمبر 2026. موافقة المالك على التنزيل كاملة. لا Gemini ولا OpenAI ولا Anthropic في وقت التشغيل. `baseline-1.0.0` لم يُستبدل.

## 1. ما نُزّل وثُبّت

| المكوّن | المسار المحلي | الحالة |
| --- | --- | --- |
| Qwen3-4B Q4_K_M GGUF | `ai-service/models/text/Qwen3-4B-Q4_K_M.gguf` (~2.33 GB) | جاهز |
| llama.cpp (CPU build) | `ai-service/bin/llama/cpu/llama-server.exe` | جاهز على `127.0.0.1:8081` |
| EasyOCR ar+en | `ai-service/models/ocr/` (+ أوزان EasyOCR) | جاهز (بديل Windows) |
| faster-whisper-small | `ai-service/models/speech/` | جاهز (`av==12.3.0` مثبت للتوافق) |
| BGE-M3 | `ai-service/models/embeddings/bge-m3/` | جاهز (dim=1024) |
| Qwen3-VL | غير منزّل | الرؤية = OCR + metadata فقط |

PaddleOCR يبقى في السجل لكنه **متعطل على هذا البناء من Windows** (`oneDNN NotImplementedError`). EasyOCR هو المسار الفعّال للتطوير المحلي.

## 2. إصلاحات تشغيل مهمة

1. **مسارات عربية + OpenCV**: قراءة الصور عبر PIL→numpy قبل EasyOCR (تفادي `img.shape` = None).
2. **ضجيج stdout**: كتم مخرجات EasyOCR حتى لا يفسد JSON للعمال.
3. **PyAV**: تثبيت `av==12.3.0` لأن `19.x` يكسر faster-whisper (`metadata_errors`).
4. **llama-server**: إعادة استخدام خادم محلّي قائم على المنفذ 8081؛ قالب Qwen3 مع `/no_think`.
5. **السجل**: المجلدات الفارغة لا تُعدّ منصَّبة؛ `easyocr-ar-en` مضاف للسجل.

## 3. نتائج اختبارات حقيقية (HTTP / طابور)

الخدمة: `127.0.0.1:3100` مع `OFFLINE_AI_MODE=true`.

| المهمة | النتيجة |
| --- | --- |
| `text.analyze` قاموس | مواضيع `electric_cars` / `iraq_local` لنص عربي عراقي |
| `text.analyze` + GGUF | `enrichment.ok=true` عبر llama.cpp / Qwen3-4B |
| `image.analyze` | OCR قرأ `BAGHDAD ELECTRIC CAR` بثقة ~0.81 |
| `audio.transcribe` على `tone.wav` | `ok=true`، نص تقريبي `Beep`، مدة 2ث |
| `embed.batch` | متجهان، البعد 1024 |

لم تُرفع بيانات إلى أي مزوّد سحابي. الرسائل الخاصة ما زالت مرفوضة في العقود.

## 4. إعدادات التشغيل (أسماء فقط)

`ai-service/.env`:

- `ENABLE_TEXT_GGUF=true`
- `ENABLE_OCR=true`
- `ENABLE_WHISPER=true`
- `ENABLE_EMBEDDINGS=true`
- `ENABLE_VISION=true` (fallback محلي بدون أوزان VL)
- `LLAMA_SERVER_PORT=8081`
- `LLAMA_NGL=0` (CPU في هذه الجولة؛ Vulkan لاحقاً اختياري)

`backend/.env` مربوط بـ:

- `AI_SERVICE_URL=http://127.0.0.1:3100`
- `AI_SERVICE_TOKEN` = نفس `AI_INTERNAL_TOKEN`
- `OFFLINE_AI_MODE=true`

فشل الخدمة لا يوقف النشر؛ Nest يعود للقاموس المحلي و`baseline-1.0.0`.

## 5. ما لم يُدَّعَ

- لا سعة 100 ألف مستخدم.
- لا استبدال لمحرّك التوصيات المقدَّم.
- لا أوزان Qwen3-VL؛ الرؤية حالياً OCR+metadata.
- لا تدريب LLM؛ مسار التدريب الخطي العام فقط.
- اللابتوب بيئة تطوير (RTX 4060 Laptop 8GB، RAM ~16GB).

## 6. قرار الجاهزية

محلياً: Local-First فعّال للقاموس + GGUF نصّي + OCR + Whisper + Embeddings. جاهز للاستخدام التطويري مع Nest. غير جاهز لإعلان إنتاج أو رؤية متعددة الوسائط كاملة قبل VL وخادم GPU منفصل وقياس حمل.
