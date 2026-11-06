# 38 — Tawasul Content Safety & Moderation System

تاريخ التنفيذ: 4 نوفمبر 2026.  
الأدلة القابلة لإعادة التشغيل: `ai-service/validation-results/phase38-moderation-latest.json`.  
لم يُمسّ `baseline-1.0.0`. لا فحص تلقائي للرسائل الخاصة. لا مواد استغلال قاصرين في الاختبارات.

## 1. ما كان موجوداً قبل التنفيذ

| المكوّن | الحالة |
| --- | --- |
| `Report` | إنشاء بلاغ فقط؛ بلا طابور مراجعة أو تأثير عالمي |
| تحليل المحتوى | `ContentUnderstanding` للتوصيات/البحث — ليس سلامة |
| إخفاء المحتوى | `deletedAt` / `archivedAt` + حظر/كتم للمشاهد |
| أدوار | `free` / `premium` / `admin` فقط |
| لوحة إدارة سلامة | غير موجودة |
| AI سلامة مخصص | غير موجود |

## 2. ما تم تنفيذه فعلياً

1. **سياسة مرقّمة** `tawasul-community@1.0.0` مع فئات قابلة للتعديل من الإدارة.
2. **محرك قواعد سياقي** (`safety-scanner.ts`) عربي/عراقي/إنجليزي + مقاومة تشويش خفيفة + تمييز سياق الإدانة/التوعية/الطبي.
3. **دورة حياة محتوى** عبر `moderationStatus` على Post/Reel/Story/Comment/ReelComment.
4. **مهام غير متزامنة** `ModerationJob` + صيانة كل 12 ثانية؛ النشر لا ينتظر AI.
5. **ربط AI المحلي** OCR/تفريغ عبر `/v1/jobs` عند توفر مسار ملف محلي (بدون سحابة).
6. **بصمة محتوى** للكشف عن إعادة الرفع بعد الحظر.
7. **بلاغات** محسّنة (أولوية، حد إساءة، ربط بمراجعة).
8. **طعون** OPEN→… مع إعادة فحص ومنع التكرار بعد الإغلاق النهائي.
9. **عقوبات حساب** `UserViolation` + `UserModerationState` (تحذير/تعليق/…).
10. **RBAC** `moderator` vs `admin`.
11. **انعكاس العرض** على Feed الزمني، Search، Explore/Reels ranking، Stories، و`getById` (المالك يرى الشارة فقط).
12. **لوحة** `/settings/admin/moderation` مربوطة بالـ API.

## 3. الملفات الرئيسية

### Backend
- `backend/prisma/schema.prisma` — نماذج المراجعة + حقول الحالة + دور `moderator`
- `backend/src/modules/moderation/**` — الوحدة كاملة
- `backend/src/modules/social/{posts,reels,stories,profiles,search}.service.ts`
- `backend/src/modules/recommendations/candidate.service.ts`
- `backend/src/app.module.ts`
- `backend/scripts/phase38-moderation-validation.mjs`

### Frontend
- `frontend/src/api/moderation.ts`
- `frontend/src/app/social/AdminModerationPage.tsx`
- مسارات في `SocialRoot.tsx` + رابط الإعدادات

## 4. مخطط قاعدة البيانات (ملخص)

- `ModerationPolicy` / `ModerationPolicyVersion`
- `ModerationCase` / `ModerationFinding` / `ModerationDecision`
- `ModerationAppeal` / `ModerationJob` / `ModerationAuditLog`
- `UserViolation` / `UserModerationState`
- توسيع `Report` (priority, caseId, resolved*)
- `Post|Reel|Story|Comment.moderationStatus` (+ fingerprint للمنشورات/الريلز/القصص)

## 5. API Endpoints

| Method | Path | من |
| --- | --- | --- |
| POST | `/moderation/reports` | مستخدم |
| GET | `/moderation/me/content/:kind/:id` | مالك المحتوى |
| POST | `/moderation/cases/:caseId/appeals` | مالك |
| GET | `/moderation/admin/queues` | مشرف |
| GET | `/moderation/admin/cases/:id` | مشرف |
| POST | `/moderation/admin/cases/:id/decide` | مشرف |
| POST | `/moderation/admin/appeals/:id/resolve` | مشرف |
| GET/PUT | `/moderation/admin/policy` | قراءة للمشرف؛ تعديل للـ admin |
| POST | `/moderation/admin/accounts/:userId/state` | admin (disable) / admin|suspend perms |

`POST /reports` القديم يوجّه إلى نفس محرك البلاغات.

## 6. آلية الفحص

```
نشر → ModerationJob(pending) + moderationStatus=PENDING_REVIEW (ما زال ظاهراً)
  → scan نص/هاشتاغ (قواعد سياقية)
  → إن وُجد ملف محلي: image.analyze (OCR) / audio|video (Whisper)
  → دمج النتائج + تطبيق عتبات السياسة
  → قرار آلي: APPROVED | FLAGGED | RESTRICTED | HIDDEN | REMOVED
  → الحالات الملتبسة: needsHuman=true → طابور المشرفين
```

الرسائل الخاصة: لا تُمرَّر؛ وسائط `purpose=message|chat` تُستبعد؛ حقول `messageText`/`encryptedContent` مرفوضة في AI Service كما في المراحل السابقة.

**Vision متقدم (Qwen3-VL):** غير مُنزَّل — الاعتماد الحالي على القواعد + OCR + تفريغ. يحتاج موافقة لاحقة.

## 7. نتائج الاختبارات (مجموعة معلومة)

مصدر: `phase38-moderation-latest.json` — **17/17 PASS**.

| # | الحالة | النتيجة |
| --- | --- | --- |
| 1 | نص جنسي محظور | PASS (sexual) |
| 2 | تحريض قتل | PASS (violence) |
| 3 | إدانة جريمة قتل (سياق) | PASS (لا حظر) |
| 4 | تقرير صحفي عن عنف | PASS (لا حظر) |
| 5 | محتوى طبي | PASS (لا حظر) |
| 6 | تشجيع إيذاء نفس | PASS (self_harm) |
| 7 | توعية/طلب مساعدة | PASS (لا حظر) |
| 8 | كراهية | PASS (hate) |
| 9 | تهديد إنجليزي مباشر | PASS |
| 10 | لهجة عراقية تهديد | PASS |
| 11 | تشويش p0rn | PASS |
| 12 | نص داخل صورة (محاكاة OCR) | PASS |
| 13 | منشور تقني نظيف | PASS |
| 14 | احتيال/سبام | PASS |
| 15 | عدم فحص الخاص تلقائياً (عقد) | PASS |
| 16–17 | ثبات الهاش/البصمة | PASS |

**Precision = 1.0 · Recall = 1.0** على هذه المجموعة الاصطناعية فقط — **ليست** ادعاء دقة إنتاجية عامة.

### لم تُنفَّذ كـ E2E HTTP كامل في هذه الجولة (مقيّد بالوقت/الوسائط)
- فيديو جنسي حقيقي، فيديو تحريض صوتي، طعن مقبول/مرفوض عبر Nest حي، بلاغ كيدي متكرر عبر API، مشرف غير مخول، إعادة رفع ملف حقيقي، توقف AI أثناء النشر (منطق الكود: يبقى PENDING_REVIEW ويعاد المحاولة — يحتاج إثبات تشغيل حي).

هذه الفجوات موثّقة أدناه كمتبقية.

## 8. أمثلة قد يخطئ فيها النموذج

- سخرية ثقيلة تستخدم ألفاظ تهديد دون سياق إدانة واضح → إيجابية كاذبة محتملة → تُفضَّل FLAGGED + بشري.
- OCR عربي ما زال غير مثالي (مرحلة 36) → قد يفوتك نص داخل صورة منخفضة الجودة.
- بدون VL: مشاهد بصرية صامتة بلا نص قد تمر حتى تُبلَّغ أو يُضاف نموذج رؤية.

## 9. الأداء والموارد

- الفحص النصي: ملي ثانية محلياً.
- OCR/Whisper: ثوانٍ إلى عشرات الثواني على CPU (نفس قيود المرحلة 35/36).
- الطابور: دفعات صغيرة (3) كل 12 ثانية؛ لا يوقف النشر أو الدردشة.

## 10. ما يزال يحتاج تطويراً / مراجعة بشرية

1. إثبات E2E كامل: نشر → إخفاء من Search/Explore → طعن → قرار.
2. تعليق/منشورات القنوات والمجموعات العامة: الربط جاهز للبلاغ؛ الفحص الآلي يُوسَّع بنفس `enqueue`.
3. Qwen3-VL بعد الموافقة لفحص بصري أقوى.
4. FFmpeg لإطارات فيديو كثيفة (حالياً يعتمد مسار AI `video.analyze` القائم).
5. واجهة بلاغ داخل المنشور للمستخدم النهائي (API جاهز؛ UI جزئي عبر لوحة الإدارة).
6. pgvector غير مطلوب هنا.

## 11. مخاطر متبقية

- قرارات آلية ليست دليلاً قانونياً — الحالات الحرجة تُعلَّم `critical` وتُفضَّل المراجعة.
- إعادة الرفع عبر R2 فقط بدون بصمة ملف محلية قد يضعف كشف التكرار.
- دور `moderator` يحتاج تعيين يدوي في DB (`User.role`).

## أوامر إعادة الاختبار

```bash
cd backend
node scripts/phase38-moderation-validation.mjs
npx prisma db push
npm run dev
```

لوحة: `/settings/admin/moderation` (admin أو moderator).
