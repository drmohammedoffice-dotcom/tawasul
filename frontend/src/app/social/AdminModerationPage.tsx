import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAccount } from '@/api/accounts';
import {
  assignModerationCase,
  decideModerationCase,
  fetchModerationCase,
  fetchModerationIncidents,
  fetchModerationQuality,
  fetchModerationQueues,
  resolveModerationAppeal
} from '@/api/moderation';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';

type Queues = Awaited<ReturnType<typeof fetchModerationQueues>>;

export function AdminModerationPage() {
  const { t } = useI18n();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [queues, setQueues] = useState<Queues | null>(null);
  const [quality, setQuality] = useState<any>(null);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchAccount()
      .then((account) =>
        setAllowed(account?.role === 'admin' || account?.role === 'moderator')
      )
      .catch(() => setAllowed(false));
  }, []);

  const reload = () => {
    void Promise.all([fetchModerationQueues(), fetchModerationQuality(30), fetchModerationIncidents()])
      .then(([q, qual, inc]) => {
        setQueues(q);
        setQuality(qual);
        setIncidents(Array.isArray(inc) ? inc : inc || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
  };

  useEffect(() => {
    if (!allowed) return;
    reload();
  }, [allowed]);

  if (allowed === null) return <PageLoader />;
  if (!allowed) {
    return (
      <div className="settings-page">
        <ErrorBanner message={t('adminOnly')} />
        <Link className="button button-ghost" to="/settings">
          {t('back')}
        </Link>
      </div>
    );
  }

  const openCase = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      setSelected(await fetchModerationCase(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (action: string) => {
    if (!selected?.id) return;
    setBusy(true);
    try {
      await decideModerationCase(selected.id, { action });
      await openCase(selected.id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const resolveAppeal = async (appealId: string, approve: boolean) => {
    setBusy(true);
    try {
      await resolveModerationAppeal(appealId, { approve });
      reload();
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-page" dir="rtl">
      <div className="page-header">
        <h1>إدارة سلامة المحتوى</h1>
        <Link to="/settings" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {busy ? <p>…</p> : null}

      {quality ? (
        <section className="panel-block">
          <h2>جودة التصنيف (تشغيلي)</h2>
          <p>
            حالات: {quality.cases} · قرارات: {quality.decisions} · FP تقريبي: {quality.falsePositiveProxy} ·
            طعون ✓{quality.appealsApproved}/✗{quality.appealsRejected}
          </p>
          <p>
            متوسط مراجعة: {quality.avgReviewSec ?? '—'}ث · متوسط فحص: {quality.avgScanMs ?? '—'}ms · Shadow
            agree: {quality.shadow?.agreeRate ?? '—'}
          </p>
        </section>
      ) : null}

      <section className="panel-block">
        <h2>حوادث</h2>
        <ul>
          {(incidents || []).slice(0, 10).map((i: any) => (
            <li key={i.id}>
              {i.severity} · {i.status} · {i.title}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-block">
        <h2>حرج / طوارئ</h2>
        <CaseList rows={queues?.critical || []} onOpen={openCase} />
      </section>
      <section className="panel-block">
        <h2>مشتبه / معلّم</h2>
        <CaseList rows={queues?.flagged || []} onOpen={openCase} />
      </section>
      <section className="panel-block">
        <h2>محظور / طعن</h2>
        <CaseList rows={queues?.hidden || []} onOpen={openCase} />
      </section>
      <section className="panel-block">
        <h2>طعون مفتوحة</h2>
        <ul>
          {(queues?.appeals || []).map((a: any) => (
            <li key={a.id}>
              {a.id.slice(0, 8)} · {a.status} · case {a.caseId?.slice?.(0, 8)}
              <button type="button" className="button button-compact" onClick={() => void resolveAppeal(a.id, true)}>
                قبول
              </button>
              <button type="button" className="button button-compact" onClick={() => void resolveAppeal(a.id, false)}>
                رفض
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel-block">
        <h2>بلاغات</h2>
        <ul>
          {(queues?.reports || []).map((r: any) => (
            <li key={r.id}>
              #{r.id.slice(0, 8)} · {r.targetType}/{r.targetId.slice(0, 8)} · {r.reason} · P{r.priority}
            </li>
          ))}
        </ul>
      </section>

      {selected ? (
        <section className="panel-block">
          <h2>تفاصيل الحالة</h2>
          <p>
            {selected.contentType}/{selected.contentId} · {selected.status} ·{' '}
            {selected.topCategory || '—'} ({selected.topConfidence})
          </p>
          <p>{selected.summary}</p>
          <p>سياسة: {selected.policyVersion || '—'}</p>
          <div className="button-row">
            <button
              type="button"
              className="button button-compact"
              onClick={() => {
                setBusy(true);
                void assignModerationCase(selected.id)
                  .then(() => openCase(selected.id))
                  .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                  .finally(() => setBusy(false));
              }}
            >
              إسناد لي
            </button>
            <button type="button" className="button" onClick={() => void decide('approve')}>
              قبول
            </button>
            <button type="button" className="button" onClick={() => void decide('restrict')}>
              تقييد
            </button>
            <button type="button" className="button" onClick={() => void decide('hide')}>
              إخفاء
            </button>
            <button type="button" className="button" onClick={() => void decide('remove')}>
              حذف
            </button>
            <button type="button" className="button" onClick={() => void decide('restore')}>
              إعادة
            </button>
          </div>
          <h3>Findings</h3>
          <ul>
            {(selected.findings || []).map((f: any) => (
              <li key={f.id}>
                {f.source}/{f.category} · {f.confidence}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CaseList({
  rows,
  onOpen
}: {
  rows: any[];
  onOpen: (id: string) => void;
}) {
  if (!rows.length) return <p>—</p>;
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.id}>
          <button type="button" className="button button-ghost button-compact" onClick={() => onOpen(row.id)}>
            {row.contentType}/{String(row.contentId).slice(0, 8)} · {row.status} · {row.topCategory || '—'}
          </button>
        </li>
      ))}
    </ul>
  );
}
