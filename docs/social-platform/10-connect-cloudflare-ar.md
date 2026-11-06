# ربط SecureChat مع Cloudflare R2 + Deduplication (SHA-256)

## ما تم تجهيزه في المشروع

- دعم `MEDIA_STORAGE_DRIVER=r2`
- رفع مباشر عبر روابط موقّعة (Presigned PUT) — البايتات لا تمر عبر Nest
- تأكيد الرفع: `POST /media/complete` (ومرادف `POST /media/confirm`)
- **Instant Upload / Dedup:** العميل يرسل `contentHash` (SHA-256)؛ إن وُجد ملف جاهز بنفس البصمة يُعاد `instant: true` بدون رفع
- قراءة خاصة عبر روابط موقّعة (موصى به)
- ملف CORS: `infrastructure/cloudflare/r2-cors.json`
- سكربت فحص: `node scripts/check-cloudflare-r2.mjs`

## مسار الرفع

1. المتصفح يحسب SHA-256 للملف.
2. `POST /media/upload-ticket` مع `{ fileName, mimeType, mediaType, sizeBytes, contentHash, purpose }`.
3. إن `instant: true` → استخدم `media.id` مباشرة.
4. وإلا → `PUT` إلى Presigned URL في R2 ثم `POST /media/complete` مع نفس `contentHash`.

## متغيرات `backend/.env`

```env
# تفعيل R2 (اترك local للتطوير بدون Cloudflare)
MEDIA_STORAGE_DRIVER=r2
MEDIA_SIGNED_URL_TTL_SECONDS=600
MEDIA_ALLOW_PUBLIC_READS=false

CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_R2_BUCKET=securechat-media
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=

# اختياري — يُشتق من Account ID إن تُرك فارغاً:
# https://<ACCOUNT_ID>.r2.cloudflarestorage.com
CLOUDFLARE_R2_ENDPOINT=

# للقراءة العامة فقط عند MEDIA_ALLOW_PUBLIC_READS=true
CLOUDFLARE_R2_PUBLIC_BASE_URL=
```

لا ترفع `.env` إلى Git ولا تلصق الأسرار في الشات.

## خطواتك في لوحة Cloudflare (مرة واحدة)

1. ادخل [Cloudflare Dashboard](https://dash.cloudflare.com) → **R2 Object Storage**.
2. **Create bucket** — مثلاً `securechat-media` (نفس `CLOUDFLARE_R2_BUCKET`).
3. من نظرة R2 → **Manage R2 API Tokens** → **Create API token**:
   - Permissions: **Object Read & Write** على هذا الـ Bucket.
   - انسخ فوراً **Access Key ID** و **Secret Access Key** (السر يظهر مرة واحدة).
4. انسخ **Account ID** من الشريط الجانبي في صفحة Cloudflare / R2.
5. على الـ Bucket → **Settings** → **CORS Policy** — الصق محتوى `infrastructure/cloudflare/r2-cors.json` وعدّل `AllowedOrigins` لتشمل:
   - `http://localhost:5173` و `http://127.0.0.1:5173`
   - نطاق الإنتاج + أصول Capacitor (`https://localhost`, …)
   - Methods: `GET`, `PUT`, `HEAD`؛ Expose: `ETag`, `Content-Length`, `Content-Type`.
6. (اختياري) Custom Domain للقراءة العامة → ضعه في `CLOUDFLARE_R2_PUBLIC_BASE_URL` وفعّل `MEDIA_ALLOW_PUBLIC_READS=true` فقط عند الحاجة. الافتراضي الموصى به: قراءة موقّعة خاصة.
7. عبّئ `backend/.env` ثم:

```bash
node scripts/check-cloudflare-r2.mjs
cd backend
npm run dev
```

انتظر `OK: Connected` من سكربت الفحص.

## ملاحظات أمان

- لا تمرير ملفات عبر الـ API عند استخدام R2.
- Postgres يخزّن البيانات الوصفية فقط (`MediaAsset` + `contentHash`).
- حذف ملف لا يمسح كائن R2 إن وُجدت نسخ ملكية أخرى لنفس `storageKey` (dedup).
- أبقِ الـ Bucket خاصاً ما لم تحتج نطاقاً عاماً.
