import { useState } from 'react';
import { fileContentReport } from '@/api/moderation';
import { useI18n } from '@/i18n/I18nProvider';
import { useToast } from './Toast';

const REASONS = [
  { id: 'sexual', label: 'محتوى جنسي / إباحي' },
  { id: 'violence', label: 'عنف أو تهديد' },
  { id: 'hate', label: 'كراهية أو تمييز' },
  { id: 'harassment', label: 'تحرش أو مضايقة' },
  { id: 'spam', label: 'احتيال أو سبام' },
  { id: 'other', label: 'سبب آخر' }
] as const;

export function ReportContentButton({
  targetType,
  targetId,
  compact
}: {
  targetType: 'post' | 'reel' | 'story' | 'comment' | 'user';
  targetId: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REASONS[0].id);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!targetId) return;
    setBusy(true);
    try {
      const trimmed = details.trim();
      await fileContentReport({
        targetType,
        targetId,
        reason,
        ...(trimmed ? { details: trimmed } : {})
      });
      push('تم إرسال البلاغ. شكراً لمساعدتك في حماية المجتمع.', 'success');
      setOpen(false);
      setDetails('');
    } catch (err) {
      push(err instanceof Error ? err.message : t('errorGeneric'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="report-content-wrap">
      <button
        type="button"
        className={compact ? 'button button-ghost button-compact' : 'button button-ghost'}
        onClick={() => setOpen((v) => !v)}
      >
        إبلاغ
      </button>
      {open ? (
        <div className="report-content-panel panel-block" dir="rtl">
          <label className="tiny muted">سبب البلاغ</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="تفاصيل اختيارية (بدون معلومات خاصة)"
            maxLength={500}
          />
          <div className="row gap">
            <button type="button" className="button" disabled={busy} onClick={() => void submit()}>
              إرسال البلاغ
            </button>
            <button type="button" className="button button-ghost" onClick={() => setOpen(false)}>
              إلغاء
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
