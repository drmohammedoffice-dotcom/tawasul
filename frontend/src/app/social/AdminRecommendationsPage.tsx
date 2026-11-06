import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAccount } from '@/api/accounts';
import { fetchRecommendationAdmin, rollbackRecommendation, saveRecommendationFeature } from '@/api/recommendations';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';

export function AdminRecommendationsPage() {
  const { t } = useI18n();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetchAccount()
      .then((account) => setAllowed(account?.role === 'admin'))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void fetchRecommendationAdmin()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
  }, [allowed, t]);

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

  const weights = data?.weights || {};
  return (
    <div className="settings-page" dir="auto">
      <div className="page-header">
        <h1>{t('recommendationAdmin')}</h1>
        <Link to="/settings" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {data ? (
        <section className="panel-block">
          <p>
            {data.version} · {data.trainedModel ? 'ML' : 'baseline'}
          </p>
          <ul>
            {Object.entries(weights).map(([key, value]) => (
              <li key={key}>
                {key}: {String(value)}
              </li>
            ))}
          </ul>
          <h2>Serve</h2>
          <ul>
            {(data.serve || []).map((row: any) => (
              <li key={row.surface}>
                {row.surface}: {row.requests} · {row.avgMs} ms
              </li>
            ))}
          </ul>
          <h2>Today</h2>
          <ul>
            {(data.today || []).map((row: any) => (
              <li key={`${row.eventType}-${row.outcome}-${row.reason || ''}`}>
                {row.eventType} {row.outcome}
                {row.reason ? ` (${row.reason})` : ''}: {row.count}
              </li>
            ))}
          </ul>
          <p>
            {t('analysisStatus')}: {JSON.stringify(data.analysis || {})}
          </p>
          <h2>Tawasul AI</h2>
          <p>{JSON.stringify(data.tawasulAi || { connected: false })}</p>
          <p>
            {data.participantsToday ?? 0} · {t('conversationSignalsOff')}
          </p>
          <h2>{t('featureFlags')}</h2>
          <ul>
            {(data.features || []).map((row: { key: string; enabled: boolean; value: number }) => (
              <li key={row.key}>
                <button
                  type="button"
                  className="button button-ghost button-compact"
                  onClick={() =>
                    void saveRecommendationFeature(row.key, !row.enabled, row.value)
                      .then(() => fetchRecommendationAdmin().then(setData))
                      .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                  }
                >
                  {row.key}: {row.enabled ? 'on' : 'off'} · {row.value}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button button-ghost"
            onClick={() =>
              void rollbackRecommendation()
                .then(() => fetchRecommendationAdmin().then(setData))
                .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
            }
          >
            {t('rollbackBaseline')}
          </button>
          <p>{JSON.stringify(data.exclusions || {})}</p>
          <p>{JSON.stringify(data.distribution || {})}</p>
        </section>
      ) : (
        <PageLoader />
      )}
    </div>
  );
}
