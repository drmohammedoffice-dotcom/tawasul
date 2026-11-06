import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  adminGetVerification,
  adminListVerifications,
  adminReviewVerification,
  fetchAccount
} from '@/api/accounts';
import { useI18n } from '@/i18n/I18nProvider';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { useToast } from '../ui/Toast';

export function AdminVerificationPage() {
  const { t } = useI18n();
  const { push } = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchAccount()
      .then((a) => setAllowed(a?.role === 'admin'))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    setBusy(true);
    void adminListVerifications(statusFilter || undefined)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
      .finally(() => setBusy(false));
  }, [allowed, statusFilter, t]);

  async function openDetail(id: string) {
    setBusy(true);
    setError('');
    try {
      setSelected(await adminGetVerification(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function review(status: 'approved' | 'rejected' | 'more_info_required') {
    if (!selected) return;
    setBusy(true);
    try {
      await adminReviewVerification(selected.id, {
        status,
        ...(note.trim() ? { adminNote: note.trim() } : {})
      });
      push(t('reviewSaved'), 'success');
      setSelected(null);
      setNote('');
      setItems(await adminListVerifications(statusFilter || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (allowed === null) return <PageLoader />;
  if (!allowed) {
    return (
      <div>
        <ErrorBanner message={t('adminOnly')} />
        <Link className="button button-ghost" to="/settings">
          {t('back')}
        </Link>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <Link className="button button-ghost button-compact" to="/settings">
          {t('back')}
        </Link>
        <h1>{t('adminVerification')}</h1>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="inline-actions">
        {['pending_review', 'more_info_required', 'approved', 'rejected', ''].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            className={`button button-compact ${statusFilter === s ? '' : 'button-ghost'}`}
            onClick={() => setStatusFilter(s)}
          >
            {s || t('all')}
          </button>
        ))}
      </div>
      {busy && !selected ? <p className="muted">{t('loading')}</p> : null}
      {!busy && items.length === 0 ? <EmptyState title={t('emptyVerificationQueue')} /> : null}
      <div className="admin-verif-list">
        {items.map((row) => (
          <button key={row.id} type="button" className="list-row" onClick={() => void openDetail(row.id)}>
            <strong>@{row.user?.username}</strong>
            <span className="muted">
              {row.track} · {row.status} · {row.businessName || row.applicantName || '—'}
            </span>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="settings-card">
          <h2>
            @{selected.user?.username} — {selected.status}
          </h2>
          <p className="muted">
            {selected.track} · {selected.businessName || selected.applicantName || '—'}
          </p>
          <p className="muted tiny">
            hashes: reg={selected.hasRegistrationHash ? 'yes' : 'no'} id=
            {selected.hasIdentityHash ? 'yes' : 'no'}
          </p>
          <div className="doc-grid">
            {(selected.documents || []).map((d: any) => (
              <div key={d.id} className="doc-card">
                <strong>{d.docType}</strong>
                {d.secureUrl ? (
                  <a href={d.secureUrl} target="_blank" rel="noopener noreferrer">
                    {t('viewDocument')}
                  </a>
                ) : (
                  <span className="muted">{t('mediaMissing')}</span>
                )}
              </div>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('adminNote')}
            rows={3}
          />
          <div className="inline-actions">
            <button type="button" className="button" disabled={busy} onClick={() => void review('approved')}>
              {t('approve')}
            </button>
            <button
              type="button"
              className="button button-ghost"
              disabled={busy}
              onClick={() => void review('more_info_required')}
            >
              {t('moreInfo')}
            </button>
            <button type="button" className="button button-ghost" disabled={busy} onClick={() => void review('rejected')}>
              {t('reject')}
            </button>
            <button type="button" className="button button-ghost" onClick={() => setSelected(null)}>
              {t('close')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
