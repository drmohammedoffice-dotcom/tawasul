# 36 — Tawasul AI: إكمال تكامل Backend

تاريخ التنفيذ: 4 نوفمبر 2026.  
المرجع: `35-tawasul-ai-integration-validation.md`.  
الأدلة: `ai-service/validation-results/phase36-latest.json`، `phase36-nest-wiring.json`.  
لم يُمسّ `baseline-1.0.0`. لم يُنزَّل Qwen3-VL. لا ادعاء سعة إنتاجية كبيرة من اختبار محلي.

## أوامر إعادة الاختبار

```bash
cd ai-service
npm run test:ocr-bidi
npm run validate:phase36

cd ../backend
node --env-file=.env scripts/phase36-nest-wiring-check.mjs
```

جولة `validate:phase36` المسجّلة: **11/11 PASS** ≈ **157 ثانية**.

---

## 1. المسارات التي أصبحت متكاملة

| المسار | قبل 35 | بعد 36 |
| --- | --- | --- |
| نشر منشور/ريل | enqueue Postgres فقط | كما كان (غير متزامن؛ لا انتظار AI) |
| `ContentAnalysisJob` → فهم النص | `POST /v1/text/analyze` قاموس متزامن | **`POST /v1/jobs` `text.analyze`** (قاموس + إثراء GGUF إن فعّال) مع fallback متزامن/محلي |
| صور المنشور | غير محلَّلة | **`image.analyze`** عبر مسار ملف محلي مطلق من `MediaStorage.safeLocalAbsolutePath` |
| صوت/فيديو المنشور | غير محلَّل | **`audio.transcribe` / `video.analyze`** |
| Embeddings | غير مخزّنة | **`embed.batch` (BGE-M3)** → جدول `ContentEmbedding` |
| نتائج OCR/تفريغ | لا | حقول `ocrRaw` / `ocrLogical` / `ocrDisplay` / `ocrSearch` / `transcript` على `ContentUnderstanding` |
| البحث المعجمي | caption فقط | caption + مطابقة `ocrSearch` (مع ACL) |
| البحث الدلالي | غير موجود | **Shadow Mode** مفعّل افتراضياً (خلفية/سجلات)؛ **Live OFF** (`semanticSearch` مع rollout) |
| Idempotency | hash نصي | hash حزمة نص+وسائط؛ مفاتيح idempotency على وظائف AI |
| AI معطّل | نشر يعمل | يبقى كذلك؛ قاموس Nest محلي + تخطي وسائط |

تدفق النشر بعد 36:

```
POST /posts|/reels → استجابة فورية
  → ContentAnalysisJob (pending)
  → processBatch (صيانة 15s / kick)
      → /v1/jobs text.analyze
      → لكل وسائط محلية: image|audio|video jobs
      → embed.batch على caption+OCR منطقي+تفريغ
      → upsert ContentUnderstanding + ContentEmbedding
```

---

## 2. الملفات التي تم تعديلها / إضافتها

### NestJS
- `backend/src/modules/ai/tawasul-ai.client.ts` — `createJob` / `getJob` / `waitJob` / `enqueueAndWait`
- `backend/src/modules/recommendations/analysis.service.ts` — حزمة تحليل متعددة الوسائط
- `backend/src/modules/recommendations/semantic-search.service.ts` — **جديد**
- `backend/src/modules/recommendations/feature.service.ts` — `semanticSearchShadow` / `semanticSearch`
- `backend/src/modules/recommendations/recommendations.module.ts` — `MediaModule` + تصدير الخدمات
- `backend/src/modules/social/search.service.ts` — OCR lexical + دمج دلالي عند Live فقط
- `backend/src/modules/social/posts.service.ts` — إعادة تحليل عند التعديل؛ إبطال عند الحذف
- `backend/src/modules/social/reels.service.ts` — إبطال عند الحذف
- `backend/prisma/schema.prisma` — توسيع `ContentUnderstanding` + نموذج `ContentEmbedding`
- `backend/scripts/phase36-nest-wiring-check.mjs` — **جديد**

### AI Service
- `ai-service/python/ocr_bidi.py` — **جديد** (طبقات raw/logical/display/search)
- `ai-service/python/worker_ocr.py` — يستخدم bidi
- `ai-service/python/test_ocr_bidi.py` — **جديد**
- `ai-service/scripts/run-phase36-validation.mjs` — **جديد**
- `ai-service/package.json` — `validate:phase36` / `test:ocr-bidi`

---

## 3. نتائج الاختبارات (فعلية)

مصدر: `phase36-latest.json` + `phase36-nest-wiring.json`.

| الاختبار | النتيجة |
| --- | --- |
| وحدة OCR bidi | PASS |
| صحة AI `:3100` | PASS |
| رفض حقول خاصة في `/v1/jobs` | PASS (`private_fields_forbidden`) |
| وظيفة نص + idempotency | PASS (نفس `job.id`)؛ مواضيع `electric_cars`… |
| OCR عربي واضح | PASS — منطقي يحتوي بغداد/سيارة/تكنولوجيا |
| OCR إنجليزي | PASS — `BAGHDAD ELECTRIC CAR` |
| OCR مختلط | PASS — Baghdad + بغداد |
| OCR إعلان | PASS — SALE TODAY (+ عربي مستعاد جزئياً) |
| Whisper EN | PASS + علامة خصوصية |
| BGE-M3 dim=1024 ×3 | PASS |
| فحص ربط Nest المصدري | يُشغَّل عبر `phase36-nest-wiring-check.mjs` |

---

## 4. نتائج OCR العربي

| العينة | raw (مختصر) | logical (مختصر) | حكم |
| --- | --- | --- | --- |
| ar-clear | `ةيئابرهك ةرايس دادغب`… | `بغداد سيارة كهربائية` / `تكنولوجيا \| لعراق` | انعكاس الحروف **أُصلح**؛ كلمة «العراق» ظهرت `لعراق` (خطأ OCR وليس bidi) |
| mixed | `Baghdad دادغب` | `Baghdad بغداد` | جيد |
| ad | عربي بصري معكوس + SALE | خصم/%50 + SALE TODAY؛ بعض الكلمات ناقصة حرفاً | إنجليزي ممتاز؛ عربي **مقبول بعد bidi** وليس ممتازاً |

الطبقات المخزّنة: `ocrRaw` / `ocrLogical` / `ocrDisplay` / `ocrSearch`.  
الخوارزمية: فقرات عربية فقط → `get_display` (UBA)؛ مختلط مع أرقام/لاتيني → مرآة لتشغيلات الحروف العربية فقط (لا عكس كامل للنص؛ الهواتف والأسعار تُحفظ).

**لا يُدّعى دعم عربي ممتاز** — القياس يُظهر تحسناً كبيراً مقابل المرحلة 35 مع أخطاء تعرف متبقية.

---

## 5. حالة Semantic Search

| بند | الحالة |
| --- | --- |
| تخزين المتجهات | `ContentEmbedding` (JSON float[1024]، بدون قاعدة إضافية؛ pgvector مؤجّل) |
| الإنشاء | تلقائي في `processBatch` بعد النص/OCR/التفريغ |
| ACL | Live يعيد جلب المنشورات بفلاتر الخصوصية/الحظر؛ لا يظهر المحذوف (`status=stale` عند الحذف) |
| البحث التقليدي | يبقى المسار الافتراضي دائماً |
| Shadow | `semanticSearchShadow=true` افتراضياً — حساب في الخلفية **دون تأخير** الاستجابة |
| Live للمستخدمين | `semanticSearch=false` + rollout `value` — **لم يُفعَّل** |
| Cache استعلام | ذاكرة TTL 60s في `SemanticSearchService` |
| Batch | عبر `embed.batch` في AI Service |

---

## 6. قياسات الأداء (محلي، جهاز التطوير)

| عملية | زمن تقريبي |
| --- | --- |
| وظيفة نص (مع إثراء) | ~3.2 s (`textJobMs`) |
| OCR لكل صورة | ~20–24 s (CPU EasyOCR) |
| Whisper EN | ~13 s |
| Embed batch×3 | ~43 s (تحميل بارد ممكن) |
| جولة التحقق الكاملة | ~157 s |

لا يُستنتج من ذلك سعة مستخدمين؛ الطابور محدود التوازي داخل العملية.

---

## 7. الحماية والخصوصية

- لا استدعاءات Gemini/OpenAI/Anthropic على مسار التحليل.
- `OFFLINE_AI_MODE=true` يرفض مضيفي AI غير المحليين من Nest.
- رفض `messageText` / `encryptedContent` / `conversationId` في الحمولة.
- وسائط `purpose=message|chat` لا تُحلَّل.
- تُمرَّر مسارات ملفات محلية فقط — لا روابط موقَّعة خاصة إلى AI Service.
- Whisper يحمل `privacy: private_audio_not_used_for_recommendations`.
- `conversationSignals` ما زال مرفوض التفعيل.
- عند توقف AI: النشر والـ Feed يستمران؛ التحليل ينحصر في القاموس المحلي أو يُعاد لاحقاً.

---

## 8. ما يعمل فعلياً vs ما يزال تجريبياً

### يعمل فعلياً
- ربط Nest → `/v1/jobs` للنص والصورة والصوت والتضمين.
- تخزين نتائج التحليل مع الإصدار/الأنواع/معرّفات الوظائف البعيدة.
- Idempotency + إعادة محاولة Jobs في Postgres.
- إصلاح bidi لـ OCR العربي (مقيس).
- Shadow semantic search (خلفية).
- إعادة التحليل عند تعديل المنشور؛ إبطال عند الحذف.

### تجريبي / غير مقدَّم للمستخدمين
- دمج البحث الدلالي Live (علم OFF).
- جودة OCR العربي ليست ممتازة (أخطاء تعرف مثل `لعراق`).
- تفريغ لهجة عراقية حقيقية (لم تُضف عيّنات خاصة).
- Qwen3-VL (غير مُنزَّل).
- pgvector / HNSW على نطاق واسع.
- `hybridRanking` ما زال OFF؛ baseline دون تغيير.

---

## 9. المشاكل المتبقية

1. ملفات الوسائط الموجودة فقط على R2 بدون نسخة محلية تُتخطى (`local_path_missing`).
2. وظائف AI في الذاكرة — إعادة تشغيل AI Service تفقد الطابور الجاري (Nest يعيد المحاولة عبر Postgres).
3. زمن OCR/Embed على CPU يجعل الدفعات البطيئة؛ يحتاج جدولة/أولوية أوضح للإنتاج.
4. كلمة «العراق» في العيّنة ما زالت ناقصة حرفاً من EasyOCR.
5. لم يُنفَّذ اختبار E2E كامل عبر HTTP نشر منشور حقيقي في هذه الجولة (التحقق على عقود AI + فحص مصدر Nest + مخطط DB)؛ يُنصح بجولة يدوية بعد إعادة تشغيل Nest.

---

## 10. Qwen3-VL-2B Q4 + mmproj (بدون تنزيل — بانتظار الموافقة)

| البند | القيمة |
| --- | --- |
| المرشح | **Qwen3-VL-2B Instruct GGUF Q4_K_M** + ملف **mmproj** |
| الترخيص | Apache-2.0 على بطاقة النموذج الرسمية (أعد التحقق قبل أي نشر تجاري) |
| الحجم التقريبي | ~1.1–1.3GB للأوزان + مئات MB لـ mmproj |
| VRAM / RAM | مناسب لـ RTX 4060 Laptop 8GB بسياق معتدل؛ تجنّب تشغيله مع GGUF نصّي 4B على GPU معاً |
| جودة فهم الصور | أعلى بوضوح من OCR+metadata لمشاهد معقّدة |
| العربية | أفضل من البدائل الصغيرة عادةً؛ تحتاج قياساً بعد التنزيل |
| التشغيل على Windows | عبر llama.cpp / llama-server (مسار مثبت مسبقاً في المشروع) |
| القرار | **لا تنزيل في المرحلة 36** — انتظار موافقة صريحة |

---

## 11. توصيات المرحلة التالية

1. جولة E2E يدوية: نشر نص+صورة محلية → انتظار `ContentUnderstanding` / `ContentEmbedding` في Postgres.
2. تحسين عيّنات OCR العربية منخفضة الجودة وقياس WER/CER.
3. تفعيل `semanticSearch` بنسبة rollout صغيرة بعد مقارنة Shadow.
4. موافقة مالك المشروع على تنزيل Qwen3-VL-2B إن رُغب بفهم بصري أعمق.
5. الإبقاء على `baseline-1.0.0` كمسار تقديم حتى إثبات جودة الترتيب الهجين.

---

## خلاصة

المرحلة 36 تربط التطبيق فعلياً بقدرات AI Service المحلية عبر `/v1/jobs`، مع تحليل غير متزامن لا يعيق النشر، وإصلاح OCR العربي المقيس، وSemantic Search في Shadow Mode دون كسر البحث التقليدي أو baseline.
