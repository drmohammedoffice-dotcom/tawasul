import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAccountTransparency, submitAppeal } from '@/api/moderation';
import { deletePost, deleteReel } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';

function RestrictedThumb({ item }: { item: any }) {
  const poster = item.posterUrl || null;
  const src = poster || item.thumbUrl || null;
  const isVideo = String(item.mimeType || '').startsWith('video/');

  if (!src) {
    return <span className="muted tiny">لا معاينة</span>;
  }

  if (isVideo && !poster) {
    return (
      <video
        src={`${src}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        aria-hidden
      />
    );
  }

  if (isVideo && poster) {
    return <img src={poster} alt="" loading="lazy" />;
  }

  return <img src={src} alt="" loading="lazy" />;
}

export function AccountModerationPage() {
  const { t } = useI18n();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState('');

  const reload = () => {
    void fetchAccountTransparency()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
  };

  useEffect(() => {
    reload();
  }, []);

  async function onAppeal(item: any) {
    const statement = window.prompt('اشرح سبب الطعن — سيُعاد إرسال المحتوى للمراجعة');
    if (!statement?.trim()) return;
    setBusyId(item.caseId);
    setError('');
    setOkMsg('');
    try {
      await submitAppeal(item.caseId, statement);
      setOkMsg('تم إرسال الطعن — بانتظار نتيجة الفحص.');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(item: any) {
    const label = item.contentType === 'reel' ? 'الريل' : 'المنشور';
    if (!window.confirm(`حذف ${label} نهائياً؟ لن يظهر في الملف ولا في المخالفات.`)) return;
    setBusyId(item.caseId);
    setError('');
    setOkMsg('');
    try {
      if (item.contentType === 'reel') await deleteReel(item.contentId);
      else if (item.contentType === 'post') await deletePost(item.contentId);
      else throw new Error('لا يمكن حذف هذا النوع من هنا');
      setOkMsg('تم حذف المحتوى.');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusyId(null);
    }
  }

  if (!data && !error) return <PageLoader />;

  const items = (data?.items || []).filter(
    (item: any) => item && item.status !== 'APPROVED'
  );

  return (
    <div className="settings-page" dir="rtl">
      <div className="page-header">
        <h1>حالة الحساب والمخالفات</h1>
        <Link to="/settings" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {okMsg ? <p className="moderation-ok-msg">{okMsg}</p> : null}
      <section className="panel-block">
        <h2>حالة الحساب</h2>
        <p>
          {data?.state?.state || 'none'}
          {data?.state?.publishBlockedUntil
            ? ` · حظر نشر حتى ${new Date(data.state.publishBlockedUntil).toLocaleString()}`
            : ''}
        </p>
      </section>
      <section className="panel-block">
        <h2>المحتوى المقيّد</h2>
        <p className="muted tiny">
          المخالفات لا تظهر في ملفك الشخصي. يمكنك تقديم طعن أو حذف المحتوى من هنا. إذا قُبل الطعن
          يُعاد الظهور في الملف تلقائياً.
        </p>
        {items.length === 0 ? (
          <p className="muted">لا يوجد محتوى مقيّد حالياً.</p>
        ) : (
          <ul className="moderation-restricted-list">
            {items.map((item: any) => {
              const busy = busyId === item.caseId;
              const appealPending =
                item.status === 'APPEAL_PENDING' ||
                item.appeal?.status === 'OPEN' ||
                item.appeal?.status === 'UNDER_REVIEW';
              return (
                <li key={item.caseId} className="moderation-restricted-item">
                  <div className="moderation-restricted-thumb">
                    <RestrictedThumb item={item} />
                  </div>
                  <div className="moderation-restricted-meta">
                    <div className="moderation-restricted-title">
                      <span className="moderation-status-pill">{item.statusLabel || item.status}</span>
                      <span className="muted tiny">
                        {item.contentType}/{String(item.contentId).slice(0, 8)}
                      </span>
                    </div>
                    {item.caption ? <div className="muted ellipsis">{item.caption}</div> : null}
                    <div>{item.userReason || item.category || '—'}</div>
                    <div className="muted tiny">
                      {item.decidedAt ? new Date(item.decidedAt).toLocaleString() : ''}
                    </div>
                    {item.appealLabel ? (
                      <div className={`moderation-appeal-banner${appealPending ? ' is-pending' : ''}`}>
                        {item.appealLabel}
                      </div>
                    ) : null}
                    {item.reviewResult ? (
                      <div className="moderation-review-result">{item.reviewResult}</div>
                    ) : null}
                    <div className="moderation-restricted-actions">
                      {item.canAppeal ? (
                        <button
                          type="button"
                          className="button button-compact"
                          disabled={busy}
                          onClick={() => void onAppeal(item)}
                        >
                          تقديم طعن
                        </button>
                      ) : null}
                      {item.canDelete ? (
                        <button
                          type="button"
                          className="button button-ghost button-compact moderation-delete-btn"
                          disabled={busy}
                          onClick={() => void onDelete(item)}
                        >
                          حذف
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="panel-block">
        <h2>المخالفات المؤكدة</h2>
        <ul>
          {(data?.violations || []).map((v: any) => (
            <li key={v.id}>
              {v.category} · {v.penalty} · {new Date(v.createdAt).toLocaleDateString()}
              {v.expiresAt ? ` · حتى ${new Date(v.expiresAt).toLocaleDateString()}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
