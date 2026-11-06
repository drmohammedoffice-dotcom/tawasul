import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchFeed, fetchStoriesFeed } from '@/api/social';
import { SessionExpiredError } from '@/lib/apiError';
import { useI18n } from '@/i18n/I18nProvider';
import { EmptyState, ErrorBanner, SkeletonFeed } from '../ui/States';
import { PostCard } from './PostCard';
import { FeedReelCard, isFeedReel } from './FeedReelCard';
import { StoriesRail } from './StoriesUI';
import { ImpressionSlot } from './ImpressionSlot';

function feedCursor(item: any): string | null {
  if (item?.recommendationCursor) return String(item.recommendationCursor);
  if (!item?.createdAt) return item?.id ?? null;
  const iso = typeof item.createdAt === 'string' ? item.createdAt : new Date(item.createdAt).toISOString();
  return iso || item?.id || null;
}

export function FeedPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [feed, storyFeed] = await Promise.all([fetchFeed(), fetchStoriesFeed()]);
      setItems(feed);
      setStories(storyFeed);
      setCursor(feedCursor(feed[feed.length - 1]));
      setHasMore(feed.length >= 20);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setError(t('sessionExpired'));
      } else {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor || busyRef.current) return;
    busyRef.current = true;
    setLoadingMore(true);
    try {
      const more = await fetchFeed(cursor);
      setItems((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        return [...prev, ...more.filter((p) => !ids.has(p.id))];
      });
      setCursor(feedCursor(more[more.length - 1]));
      setHasMore(more.length >= 20);
    } catch (err) {
      if (!(err instanceof SessionExpiredError)) {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    } finally {
      setLoadingMore(false);
      busyRef.current = false;
    }
  }, [cursor, hasMore, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '240px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  if (loading) {
    return (
      <div className="feed-page">
        <div className="page-header">
          <h1>{t('home')}</h1>
        </div>
        <SkeletonFeed />
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="feed-page">
        <div className="page-header">
          <h1>{t('home')}</h1>
        </div>
        <ErrorBanner message={error} onRetry={() => void reload()} />
      </div>
    );
  }

  return (
    <div className="feed-page">
      <div className="page-header">
        <h1>{t('home')}</h1>
        <Link className="button button-compact button-ghost" to="/create">
          {t('create')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}
      <StoriesRail stories={stories} onChanged={() => void reload()} />
      {items.length === 0 ? (
        <EmptyState
          title={t('emptyFeed')}
          action={
            <div className="inline-actions">
              <Link className="button button-compact" to="/explore">
                {t('openExplore')}
              </Link>
              <Link className="button button-compact button-ghost" to="/create">
                {t('createSomething')}
              </Link>
            </div>
          }
        />
      ) : null}
      {items.map((item) =>
        isFeedReel(item) ? (
          <ImpressionSlot key={`reel-${item.id}`} contentType="reel" contentId={item.id} surface="feed">
            <FeedReelCard
              reel={item}
              onChange={(next) => setItems((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...next } : p)))}
              onRemoved={(id) => setItems((prev) => prev.filter((p) => p.id !== id))}
            />
          </ImpressionSlot>
        ) : (
          <ImpressionSlot key={`post-${item.id}`} contentType="post" contentId={item.id} surface="feed">
            <PostCard
              post={item}
              onChange={(next) => setItems((prev) => prev.map((p) => (p.id === next.id ? next : p)))}
              onRemoved={(id) => setItems((prev) => prev.filter((p) => p.id !== id))}
            />
          </ImpressionSlot>
        )
      )}
      <div ref={sentinelRef} className="feed-sentinel" />
      {loadingMore ? <p className="muted center-muted">{t('loading')}</p> : null}
    </div>
  );
}
