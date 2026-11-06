import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchNotifications } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { formatDateDMY } from '@/lib/formatDate';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';

export { CreatePostPage } from './CreateStudio';

export function NotificationsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchNotifications()
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div>
      <div className="page-header">
        <button
          type="button"
          className="button button-ghost button-compact"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate('/feed');
          }}
        >
          ← {t('back')}
        </button>
        <h1>{t('alerts')}</h1>
        <span />
      </div>
      {items.length === 0 ? <EmptyState title={t('emptyNotifications')} /> : null}
      {items.map((n) => (
        <article key={n.id} className="post-card notification-card">
          <header className="post-header">
            <div className="post-author">
              <span className="avatar-circle sm">
                {(n.actor?.username || 'S').slice(0, 1).toUpperCase()}
              </span>
              <span className="post-author-text">
                <strong>{n.type?.replace(/_/g, ' ') || t('alerts')}</strong>
                <span className="muted">
                  {n.actor?.username ? (
                    <Link to={`/u/${n.actor.username}`}>@{n.actor.username}</Link>
                  ) : (
                    'system'
                  )}
                  {n.createdAt ? ` · ${formatDateDMY(n.createdAt)}` : ''}
                </span>
              </span>
            </div>
          </header>
        </article>
      ))}
    </div>
  );
}

export { AccountHubPage as SettingsPage } from './AccountSettingsPages';
