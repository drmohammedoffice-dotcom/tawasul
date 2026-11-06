# 38.1 — Advanced Content Safety, Protection & Governance

تاريخ التنفيذ: 4 نوفمبر 2026.  
الأدلة: `ai-service/validation-results/phase38-1-latest.json` (31 PASS / 0 FAIL / 4 SKIP صريح).  
امتداد للمرحلة 38 — لا نظام موازٍ، لا فحص تلقائي للمحادثات/المكالمات الخاصة، لا خدمات AI خارجية، لم يُمسّ محرك التوصيات الأساسي.

## 1. ملخص الحكم

المرحلة **مكتملة ضمن الحدود الموثّقة**: المحتوى بحالة `HIDDEN`/`REMOVED`/`RESTRICTED` لا يُعاد عبر استعلام عام ولا عبر رابط مباشر API بعد المصادقة/البوابة، والطعون والمراجعة وسجل التدقيق غير القابل للحذف تعمل عبر الـ Backend. الفجوات المتبقية (بصمة فيديو/صوت E2E كاملة، مجموعة دقة معلّمة واسعة، Precision/Recall حقيقي لكل فئة) مُعلنة أدناه وليست «نجاحاً صامتاً».

## 2. ما تم تنفيذه

### 2.1 Emergency Content Protection
- علم `ModerationCase.emergency` + أولوية 100 + عزل فوري إلى `HIDDEN` عند مؤشرات حرجة (عنف وشيك / أنماط حساسة في السياسة).
- إخراج من الاكتشاف/التوصيات عبر `discoveryModerationWhere` + `ContentAccessGate`.
- تدقيق `emergency.isolate` في `ModerationAuditLog`.
- مسار تصعيد بشري: `needsHuman` + طابور حرج؛ النموذج ليس جهة قانونية.

### 2.2 منع تسرب المحتوى المحظور (ContentAccessGate)
خدمة مركزية `content-access.gate.ts` مربوطة بـ:
- `PostsService.getById` / `assertCanEngageWithPost` / `listBookmarks`
- `ReelsService.getById` / `assertCanEngage`
- `StoriesService.view`
- `ContentControlsService` (مشاركة/رابط/تحميل) عبر `assertShareable`
- فلاتر العرض العامة السابقة (Feed / Search / Explore / Profiles) من المرحلة 38

الرفض للغرباء يكون `404 content_not_found` لتفادي تسريب الوجود.

### 2.3 بصمات المحتوى
- `ModerationFingerprint`: `sha256` + `ahash` (worker محلي `ai-service/python/worker_phash.py`)
- عتبة Hamming قابلة للتعديل (افتراضي 8) — التشابه الضعيف لا يحظر تلقائياً
- تطابق غير مؤكد → مراجعة؛ لا قاعدة بيانات مفتوحة لبصمات حساسة؛ لا تعرّف هوية أشخاص

### 2.4 مكافحة التحايل
- `text-normalize.ts`: تطويل، تشكيل، Zero-width، تكرار، leet، أرقام داخل كلمات عربية، Arabizi
- الاحتفاظ بالنص الأصلي للأدلة؛ التطبيع للمطابقة فقط
- توسيع أنماط التهديد (`اقتلك` + Arabizi)

### 2.5 Risk Scoring
- `RiskScoreService`: فئة/شدة/ثقة/تهديد/تكرار مؤكد/تحايل؛ البلاغات وحدها محدودة السقف
- لا دين/سياسة/عرق؛ صلاحية عبر `UserViolation.expiresAt`

### 2.6 مركز جودة AI + Shadow
- `GET /moderation/admin/quality` — وكلاء تشغيلية (FP proxy، طعون، زمن مراجعة/فحص، shadow agree)
- `ModerationShadowResult` + `ModerationRuntimeConfig.shadowEnabled` — التحليل التجريبي لا يغيّر `moderationStatus`
- إمكانية تعطيل Shadow والرجوع لإصدار سياسة سابق عبر إصدارات السياسة

### 2.7 مراجعة بشرية
- طابور أولوية (حرج/طوارئ أولاً)، تعيين مراجع، ملاحظات داخلية، أسباب قرار موحّدة
- قرارات حساسة عبر RBAC `case.decide`
- `DELETE /moderation/admin/audit/:id` → `audit_log_immutable`

### 2.8 شفافية المستخدم
- صفحة `/settings/moderation` — «حالة الحساب والمخالفات»
- `GET /moderation/me/account` + طعن عند السماح؛ بلا هوية مبلّغ وبلا تفاصيل تقنية للتجاوز

### 2.9 مكافحة إساءة البلاغات
- `evaluateReportAbuse` — أنماط رفض متكرر/استهداف؛ لا عقاب لمجرد عدم ثبوت بلاغ واحد
- البلاغات لا تغيّر التصنيف الآلي وحدها دون مراجعة

### 2.10 Incident Management + Retention
- فتح/إغلاق حوادث، ربط قضايا، تعيين مسؤول، تدقيق
- `ModerationRetentionPolicy` + كنس Shadow تلقائي؛ حذف الأدلة/القضايا مقيّد ومُوَثَّق
- `ModerationEvidenceAccessLog` لمشاهدة/تنزيل الأدلة

## 3. ما لم يُنفَّذ بالكامل (وأسباب صادقة)

| البند | السبب |
| --- | --- |
| E2E إعادة ترميز فيديو كاملة | مسار إطارات موجود جزئياً؛ لا اختبار إعادة ترميز فعلي في هذه الجولة |
| Audio fingerprint مرخّص | لا مكوّن مرخّص مدمج؛ الاعتماد على تفريغ Whisper عند توفر AI |
| VL / OCR شامل لكل الصور | OCR عبر وظائف AI المحلية عند المسار المحلي؛ لا VL خارجي |
| Precision/Recall معلّم لكل فئة لغة | لوحة الجودة تستخدم وكلاء تشغيلية؛ مجموعة اختبار آمنة محدودة في سكربتات 38/38.1 |
| مقارنة نموذج جديد مقابل قديم بواجهة A/B كاملة | Shadow + إصدارات سياسة؛ لا سيرفر نماذج متعدد الإصدارات منفصل |
| حذف تلقائي صارم لكل الأدلة عند انتهاء المدة | كنس Shadow آمن؛ حذف القضايا/الأدلة يبقى إجراءً إدارياً موثّقاً لحماية التدقيق القانوني |

## 4. مخطط الخدمات والعمليات

```
Publish → ModerationJob (async)
        → SafetyScanner (normalized text + optional OCR/ASR local)
        → FingerprintService (sha256/ahash)
        → RiskScore → Case (+ emergency isolate?)
        → Content status update
        → optional ShadowResult (no status write)

Any fetch/share/bookmark → ContentAccessGate → allow|404
Reports → abuse score → queue (no auto override)
Appeals → independent human review → audit append-only
Retention sweep → delete old shadow samples
```

## 5. تغييرات قاعدة البيانات

جداول/حقول مضافة أو موسّعة فوق المرحلة 38:
- `ModerationCase.emergency`, `riskScore`, `assignedReviewerId`, `internalNotes`
- `UserModerationState.riskScore`
- `ModerationFingerprint`
- `ModerationShadowResult`
- `ModerationIncident`
- `ModerationRetentionPolicy`
- `ModerationEvidenceAccessLog`
- `ModerationRuntimeConfig`

## 6. API endpoints الجديدة/الموسّعة

| Method | Path |
| --- | --- |
| GET | `/api/moderation/me/account` |
| GET | `/api/moderation/admin/quality` |
| GET | `/api/moderation/admin/runtime` |
| PUT | `/api/moderation/admin/shadow` |
| GET/POST | `/api/moderation/admin/incidents` |
| POST | `/api/moderation/admin/incidents/:id/close` |
| GET/PUT | `/api/moderation/admin/retention` |
| POST | `/api/moderation/admin/retention/sweep` |
| DELETE | `/api/moderation/admin/audit/:id` → مرفوض دائماً |

(مسارات الطابور/القرار/الطعون/البلاغات من المرحلة 38 ما زالت قائمة.)

## 7. نتائج الاختبارات الفعلية

سكربت: `backend/scripts/phase38-1-advanced-safety-validation.mjs`  
النتيجة: **31 PASS / 0 FAIL / 4 SKIP**

أبرز النجاحات:
1. حالات غير العامة غير قابلة للاستعلام العام + API رابط مباشر لا يسرّب HIDDEN
2. بوابة مربوطة بـ posts/reels/stories/share/bookmarks
3. sha256 + aHash مستقران
4. Arabizi + أرقام داخل كلمات عربية + سياق إدانة
5. Shadow لا يغيّر الحالة؛ سجل التدقيق غير قابل للحذف عبر API
6. Risk: البلاغات وحدها لا تهيمن؛ الحالات الحرجة ترتفع
7. سياسة احتفاظ جاهزة؛ جدول الحوادث جاهز
8. عقد عدم فحص الرسائل الخاصة موثّق في الكود

التخطيات الصريحة: فيديو معاد ترميزه، بصمة صوت مرخّصة، VL كامل، كلام محظور في فيديو بدون corpus.

## 8. مؤشرات الدقة والأخطاء

- لوحة الجودة: وكلاء (`falsePositiveProxy` = استعادة بشرية بعد إخفاء آلي، معدلات طعون، زمن مراجعة/فحص، shadow agreeRate)
- سكربتات 38/38.1: عينات نصية آمنة؛ **ليست** بديلاً عن مجموعة اختبار يدوية واسعة قبل الإطلاق العام
- لا استخدام رسائل خاصة للتدريب أو التقييم

## 9. اختبارات الصلاحيات والخصوصية

- قرارات حساسة تتطلب `case.decide`
- حذف التدقيق مرفوض
- لا مسح تلقائي لـ `purpose=message|chat`
- أدلة حساسة: مسار وصول مسجّل (`EvidenceAccessLog`)؛ المواد شديدة الحساسية لا تُنسخ في واجهات اعتيادية (سياسة تشغيلية)

## 10. زمن المعالجة والموارد

- النشر غير متزامن (صيانة ~12ث)
- aHash worker محلي خفيف على صور الاختبار
- لا استدعاء سحابي للسلامة

## 11. المخاطر المتبقية

1. أسطح نادرة (إشعارات قديمة مخزّنة، روابط مشاركة سابقة في DM) قد تذكر معرّفاً لكن الجلب يفشل بالبوابة
2. aHash عتبة ثابتة قد تفوّت تعديلات قوية أو تنتج تشابهاً كاذباً نادراً → مراجعة بشرية مطلوبة
3. بدون مجموعة معلّمة كبيرة، Precision/Recall التشغيلي تقريبي
4. فشل AI المحلي يترك المهام في الطابور لإعادة المعالجة — العرض يعتمد على الحالة الحالية للمحتوى

## 12. قبل الإطلاق العام

1. تشغيل سكربتي 38 و 38.1 على بيئة staging مع مستخدمين حقيقيين للصلاحيات
2. توسيع مجموعة اختبار نص/صورة معلّمة يدوياً (بدون مواد غير قانونية)
3. تمرين طوارئ: عزل → تنبيه مشرف → تصعيد بشري → إغلاق حادثة
4. مراجعة قانونية لمُدد الاحتفاظ حسب الاختصاص
5. التأكد أن صلاحيات `moderator`/`admin` مضبوطة في الإنتاج
6. مراقبة `quality` و shadow agree لأيام قبل تفعيل سياسة/نموذج جديد

## 13. الملفات الرئيسية

- `backend/src/modules/moderation/content-access.gate.ts`
- `backend/src/modules/moderation/fingerprint.service.ts`
- `backend/src/modules/moderation/risk-score.service.ts`
- `backend/src/modules/moderation/moderation-governance.service.ts`
- `backend/src/modules/moderation/engine/text-normalize.ts`
- `backend/src/modules/moderation/engine/safety-scanner.ts`
- `backend/src/modules/social/{posts,reels,stories,content-controls}.service.ts`
- `frontend/src/app/social/{AdminModerationPage,AccountModerationPage}.tsx`
- `backend/scripts/phase38-1-advanced-safety-validation.mjs`
- `ai-service/python/worker_phash.py`
