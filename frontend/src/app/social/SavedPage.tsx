import { useEffect, useState } from 'react';
import { fetchBookmarks } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { PostCard } from './PostCard';

export function SavedPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  async function load(reset = true) {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    setError('');
    try {
      const cursor = !reset && items.length ? items[items.length - 1]?.bookmarkedAt : undefined;
      const data = await fetchBookmarks(cursor ? String(cursor) : undefined);
      const next = Array.isArray(data) ? data : [];
      setItems((prev) => (reset ? next : [...prev, ...next.filter((n) => !prev.some((p) => p.id === n.id))]));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, []);

  if (loading) return <PageLoader />;
  if (error && items.length === 0) return <ErrorBanner message={error} onRetry={() => void load(true)} />;

  return (
    <div>
      <div className="page-header">
        <h1>{t('saved')}</h1>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {items.length === 0 ? <EmptyState title={t('emptySaved')} /> : null}
      {items.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onChange={(next) => {
            if (Array.isArray(next.bookmarks) && next.bookmarks.length === 0) {
              setItems((prev) => prev.filter((p) => p.id !== next.id));
            } else {
              setItems((prev) => prev.map((p) => (p.id === next.id ? next : p)));
            }
          }}
          onRemoved={(id) => setItems((prev) => prev.filter((p) => p.id !== id))}
        />
      ))}
      {items.length > 0 ? (
        <button className="button button-ghost" type="button" disabled={loadingMore} onClick={() => void load(false)}>
          {loadingMore ? t('loading') : t('loadMore')}
        </button>
      ) : null}
    </div>
  );
}
