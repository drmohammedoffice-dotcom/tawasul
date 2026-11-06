# 33 — Tawasul AI: محرك ذكاء اصطناعي محلي مستقل

تاريخ التنفيذ: 3 نوفمبر 2026. لا Gemini ولا OpenAI ولا Anthropic ولا أي API ذكاء اصطناعي خارجي. لم يُنزَّل أي نموذج ثقيل. لم يُمسّ `baseline-1.0.0` كمسار تقديم.

## 1. تدقيق ما قبل البناء

| المكوّن | الحالة | القرار |
| --- | --- | --- |
| محرك التوصيات `baseline-1.0.0` | مطبق ومختبر | يُحتفظ به كمسار آمن |
| قاموس `lexicon-1.0.0` داخل Nest | مطبق ومختبر | يُوسَّع ويُنسخ إلى الخدمة المستقلة |
| `ContentUnderstanding` / `ContentAnalysisJob` | مطبقة | تُعاد استخدامها |
| مفاتيح `hybridRanking` و`shadowRanking` | مطبقة ومتوقفة | تبقى؛ لا تفعيل جماعي |
| وحدة `modules/ai` mock | محاكاة وترجمة وقواعد | تُترك كما هي؛ لا تُحوَّل إلى LLM على الرسائل |
| BullMQ | غير موجود سابقاً | طابور داخل `ai-service` أولاً؛ BullMQ مثبت كتبعية للاستخدام لاحقاً مع Redis |
| Ollama / CUDA toolkit / نماذج | غير مثبتة | لا تنزيل دون موافقة |
| التقرير 31 | غير موجود | لا يُختلق |
| التقرير 32 | موجود | اعتمدت مواصفات اللابتوب منه |

## 2. البنية الجديدة

خدمة مستقلة: `ai-service/` باسم الحزمة `@secure-messaging/ai-service`، المنفذ الافتراضي `127.0.0.1:3100`.

المكوّنات المنفذة فعلياً:

1. AI Router عبر HTTP (`/health`, `/v1/text/analyze`, `/v1/jobs`, `/v1/models`, `/v1/admin/overview`, training).
2. Model Registry من `manifests/models.registry.json`.
3. Local Model Provider: القاموس جاهز؛ GGUF/OCR/Vision/Whisper/Embeddings يرجعون `model_missing` أو `disabled`.
4. Task Queue داخل العملية: أولوية، إعادة محاولة، backoff، idempotency، حد GPU=1 وCPU=2.
5. Worker Manager مبسّط داخل الطابور.
6. Result Cache بالذاكرة مع تجزئة المحتوى.
7. Model Health + Resource Monitor (`nvidia-smi` عند التوفر).
8. Evaluation helpers لـ Precision/NDCG مقابل baseline دون ترقية تلقائية.
9. Training Pipeline خطي خفيف على بيانات عامة فقط، مع رفض حقول الرسائل الخاصة.
10. Admin overview عبر Nest للمشرفين فقط.
11. `OFFLINE_AI_MODE` يمنع fetch إلى مضيفي AI الخارجيين المعروفين.

Nest:

- `TawasulAiClient` يستدعي الخدمة المحلية فقط.
- عند `OFFLINE_AI_MODE` يرفض أي `AI_SERVICE_URL` غير localhost.
- `ContentAnalysisService` يفضّل الخدمة إن وُجدت، وإلا القاموس المحلي. فشل الخدمة لا يوقف النشر.
- لوحة المشرف تعرض كتلة `tawasulAi`.

## 3. محرك التوصيات

لم يُستبدل الترتيب المقدَّم. `baseline-1.0.0` يبقى. Shadow/hybrid/engagement ما زالت خلف مفاتيح متوقفة. أدوات التقييم في `ai-service/src/eval/recommendation-eval.ts` لا تروّج نموذجاً جديداً. الرسائل الخاصة ما زالت ممنوعة من مسار الاهتمامات.

## 4. الاختبارات المنفذة

أمر: `npm test` داخل `ai-service`.

النتيجة الفعلية:

```json
{"ok":true,"queue":{"enqueued":1,"done":1,"failed":0,"unavailable":0,"deduped":1,"byStatus":{"done":1},"size":1,"gpuBusy":0,"cpuBusy":0},"offlineBlocked":1,"lexiconTopics":["electric_cars","iraq_local","cars","technology"]}
```

ما غُطي:

- نص عربي مع لهجة عراقية وإنجليزي.
- حظر اتصال OpenAI أثناء Offline.
- جاهزية القاموس وغياب النماذج الثقيلة.
- طابور + منع التكرار.
- رفض تدريب بحقل `messageText`.
- تدريب خطي على بيانات اصطناعية عامة (ليس LLM).
- HTTP 401 بدون رمز، و400 عند حقول خاصة.

`npx tsc --noEmit` في الخلفية نُفِّذ بعد الربط.

## 5. ما يعمل الآن

- خدمة AI مستقلة قابلة للتشغيل محلياً.
- تحليل نص محلي Offline بالقاموس، مع مصطلحات عراقية إضافية.
- طابور ومراقبة موارد وتسجيل نماذج.
- ربط اختياري من Nest دون كسر التطبيق.
- وضع Offline مثبت باختبار يمنع الاستدعاء الخارجي.

## 6. ما يحتاج موافقة تنزيل قبل التفعيل

| النموذج | الحجم التقريبي | الترخيص | ملاحظات |
| --- | --- | --- | --- |
| Qwen3-4B Q4_K_M | 2.5 GB | Apache-2.0 | مرشح أول للنص. يحتاج llama.cpp |
| PaddleOCR Arabic | <0.1 GB | Apache-2.0 | CPU مفضّل |
| faster-whisper-small | ~0.5 GB | MIT | ليس للرسائل الخاصة |
| BGE-M3 | ~2.2 GB | MIT | لا pgvector بعد |
| Qwen3-VL | يُراجع | يُراجع التجاري | لا تنزيل قبل قراءة البطاقة |

المساحة الحرة على القرص وقت التدقيق السابق ~259 GB. VRAM الحرة كانت ~6.5 GB. لم يُنزَّل شيء في هذه المرحلة.

## 7. التشغيل

```bash
cd ai-service
npm install
npm run test
npm run dev
```

في `backend/.env` (أسماء فقط هنا):

- `AI_SERVICE_URL=http://127.0.0.1:3100`
- `AI_SERVICE_TOKEN=<نفس AI_INTERNAL_TOKEN>`
- `OFFLINE_AI_MODE=true`

## 8. القدرة على 100,000 مستخدم

لم تُثبت. هذا اللابتوب للتطوير فقط. البنية قابلة للنقل إلى خادم GPU لاحق: خدمة مستقلة، عنوان عبر بيئة، نماذج على قرص محلي، طابور قابل للتوسعة. أي ادعاء سعة إنتاجية قبل قياس الحمل على عتاد الإنتاج غير صحيح.

## 9. المشكلات المتبقية

- مشغّل llama.cpp غير مثبت.
- أوزان النماذج الثقيلة غير موجودة.
- BullMQ مثبت لكن الطابور الحالي داخل العملية؛ النقل إلى Redis workers خطوة لاحقة بعد استقرار العقود.
- اختبارات OCR/فيديو حقيقية تنتظر النماذج.
- صفحة المشرف تعرض JSON حالة الخدمة؛ تحسين الواجهة لاحق.
- وحدات `/ai/*` ما زالت محاكاة ولا يجوز وصلها بنموذج على نص المحادثات.

## 10. قرار الجاهزية

جاهز كتأسيس Local-First مع تحليل نص قاموسي Offline واختبارات حقيقية. غير جاهز لإعلان أن الرؤية أو Whisper أو GGUF تعمل. غير جاهز لاستبدال baseline. الخطوة التالية بعد موافقتك: تنزيل نموذج واحد فقط (`Qwen3-4B Q4_K_M`) وربط llama.cpp.
