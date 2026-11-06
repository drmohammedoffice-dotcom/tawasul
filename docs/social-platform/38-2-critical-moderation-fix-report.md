# 38.2 — Critical Moderation Failure Fix (P0)

تاريخ الإصلاح: 4 نوفمبر 2026.  
الأدلة: `ai-service/validation-results/phase38-2-latest.json` — **24 PASS / 0 FAIL / 2 SKIP**.

## 1. السبب الجذري

فشل الاختبار الحقيقي (صورة إباحية + نص إباحي يظهران للعامة دون حظر) لم يكن «نقص كلمات في قائمة» فقط، بل انقطاع متعدد في دورة الحياة:

| # | الخلل | الأثر |
| --- | --- | --- |
| 1 | `Post.moderationStatus` الافتراضي **`APPROVED`** عند الإنشاء | المحتوى عام قبل أي فحص |
| 2 | `PUBLIC_MODERATION_STATUSES` تضمّن **`PENDING_REVIEW`** | حتى بعد بدء المهمة يبقى المنشور في Feed/Search/API |
| 3 | لا يوجد مصنف صور NSFW — `image.analyze` = OCR/metadata فقط | الصورة الصامتة بلا نص لا تُكتشف أبداً |
| 4 | Backend يتجاهل نتائج الرؤية ويأخذ OCR فقط | حتى لو وُجدت إشارة بصرية لن تُستخدم للسلامة |
| 5 | `auto_clean → APPROVED` عند غياب hits | صورة غير مفحوصة تُعامل كسليمة |
| 6 | `moderation.enqueue` بدون انتظار | سباق: الاستجابة تُرجع قبل الحجر |
| 7 | روابط الوسائط تُصدر دون فحص `moderationStatus` | وصول مباشر للملف رغم تقييد المنشور لاحقاً |
| 8 | أنماط النص الجنسي ضيقة نسبياً | لهجة عراقية / عبارات شائعة قد تفوت |

تقرير المرحلة 38 وثّق صراحةً: «PENDING ما زال ظاهراً» و«Qwen3-VL غير مُنزَّل — مشاهد بصرية بلا نص قد تمر». هذا التصميم هو السبب، لا مجرد عطل مؤقت في Queue.

## 2. المسار الذي لم يكن يعمل

```
رفع → إنشاء منشور (APPROVED) → إرجاع URLs عامة
     → enqueue async لاحقاً → PENDING (ما زال عاماً)
     → image.analyze بلا NSFW → OCR فارغ غالباً
     → نص قد يفوت الأنماط → auto_clean → APPROVED
```

## 3. الإصلاح المنفَّذ

### 3.1 حجر قبل الموافقة (Quarantine)
- سياسة العرض: عامة فقط `APPROVED` | `RESTORED`
- `PENDING_REVIEW` و `REVIEW_FAILED` و `HIDDEN`… ليست عامة
- إنشاء Post/Reel/Story بحالة `PENDING_REVIEW` + `await enqueueAsync`
- افتراضي Prisma للمنشورات/الريلز/القصص: `PENDING_REVIEW`
- شارة مالك: «قيد المراجعة» / «محتوى محظور»

### 3.2 مصنف صور NSFW فعلي
- النموذج: **`Falconsai/nsfw_image_detection`** (ViT)
- الترخيص: **Apache-2.0** (استخدام تجاري مسموح)
- الحجم ≈ 100MB — CPU عبر `transformers` + `torch` الموجودين
- Worker: `ai-service/python/worker_nsfw.py`
- مسار مزدوج: AI Service `image.analyze.nsfw` **أو** استدعاء محلي مباشر من Nest (`FingerprintService.classifyNsfw`) إن تعطّل AI
- يُسجَّل: modelId، modelVersion، nsfwScore، label، inference، elapsedMs
- عتبات: ≥0.72 حظر، 0.45–0.72 مراجعة بشرية، أقل = طبيعي
- **لا وجه / لا تعرّف هوية أشخاص**

### 3.3 نص جنسي أقوى + دمج مستقل
- توسيع العربية / العراقية / الإنجليزية / arabizi / leet
- نتيجة الصورة لا تُلغى بنص نظيف والعكس
- طبي/علمي يُخفَّف عبر `MEDICAL_SAFE`

### 3.4 Fail-closed
- صورة موجودة بدون نتيجة NSFW حقيقية → `REVIEW_FAILED` / `PENDING_REVIEW` — **لا APPROVED**
- فشل المهمة بعد المحاولات → `REVIEW_FAILED`
- لا ثقة افتراضية عند فشل النموذج

### 3.5 بوابة الوسائط
- `generateSecureReadUrl` يرفض غير المالك إذا المنشور/الريل/القصة ليست `APPROVED|RESTORED`

### 3.6 زر إبلاغ
- مكوّن `ReportContentButton` مربوط بـ `/moderation/reports`
- منشورات، ريلز، حسابات (قائمة الملف الشخصي)

## 4. الملفات المعدَّلة / المضافة

- `backend/src/modules/moderation/moderation.visibility.ts`
- `backend/src/modules/moderation/moderation.service.ts`
- `backend/src/modules/moderation/content-access.gate.ts`
- `backend/src/modules/moderation/fingerprint.service.ts`
- `backend/src/modules/moderation/engine/safety-scanner.ts`
- `backend/src/modules/social/{posts,reels,stories}.service.ts`
- `backend/src/modules/media/media.service.ts`
- `backend/prisma/schema.prisma`
- `ai-service/python/worker_nsfw.py`
- `ai-service/src/providers/heavy-providers.ts` + `queue/job-queue.ts` + `config.ts`
- `ai-service/manifests/models.registry.json`
- `frontend/src/app/ui/ReportContentButton.tsx` + PostCard / FeedReelCard / ProfilePages
- `backend/scripts/phase38-2-critical-moderation-fix.mjs`

## 5. نتائج الاختبارات

| اختبار | نتيجة |
| --- | --- |
| PENDING/REVIEW_FAILED ليست عامة | PASS |
| نص جنسي AR/IQ/EN/leet/arabizi | PASS |
| طبي غير محظور / نص نظيف | PASS |
| NSFW worker: أوزان + inference حقيقي على fixture آمن | PASS (~230s أول تشغيل مع تنزيل) |
| Fixture الآمن لا يُصنَّف nsfw تلقائياً | PASS |
| صورة NSFW لا تُلغى بنص نظيف (دمج) | PASS |
| نص جنسي لا يُلغى بخلو صورة | PASS |
| DB: PENDING خارج الاستعلام العام | PASS |
| API رابط مباشر لـ PENDING محجوب | PASS |
| عقود fail-closed في الكود | PASS |

**تخطي صريح:** لا نخزّن fixtures إباحية مرخّصة في المستودع؛ إثبات النموذج تم بـ inference حقيقي + مسار القرار. رحلة UI تفاعلية كاملة تتطلّب تسجيل دخول يدوي.

## 6. إثبات عدم الظهور قبل الموافقة

- `isPubliclyVisible('PENDING_REVIEW') === false`
- استعلام Prisma العام لا يُرجع PENDING
- API `GET /posts/:id` لا يسرّب PENDING لغير المخوّلين
- روابط الوسائط لغير المالك تُرفض قبل APPROVED

## 7. قيود متبقية

1. مصنف Falconsai ثنائي (nsfw/normal) — ليس تشريحاً قانونياً؛ الحالات الحدّية → مراجعة بشرية.
2. فيديو: NSFW على إطارات كاملة يحتاج استخراج FFmpeg مستمر (النص + الحجر يمنعان الظهور قبل الفحص).
3. إن فُقد المسار المحلي للملف (R2 فقط بلا نسخة محلية) يبقى الحجر حتى يتوفر فحص موثوق.
4. اختبار E2E بمتصفح على صورة إباحية مرخّصة لم يُنفَّذ هنا عمداً (سياسة عدم تخزين مواد حساسة).

## 8. معيار النجاح — حالة المرحلة

| شرط | حالة |
| --- | --- |
| اكتشاف عبر نموذج صور فعلي (أوزان + inference) | ✅ مثبت |
| اكتشاف نصي موسّع | ✅ |
| دمج نتائج مستقل | ✅ |
| لا ظهور عام قبل APPROVED | ✅ |
| لا موافقة عند تعطل/غياب فحص الصورة | ✅ |
| بوابة API + وسائط | ✅ |
| بلاغات UI مربوطة | ✅ |
| لا ادعاء نجاح بواجهة فقط | ✅ |

**المرحلة 38.2 مكتملة ضمن القيود الموثّقة أعلاه.**
