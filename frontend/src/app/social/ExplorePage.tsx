import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchExplore, searchAll } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import {
  clearSearchHistory,
  listSearchHistory,
  pushSearchHistory,
  removeSearchHistory,
  type SearchHistoryItem
} from '@/lib/searchHistory';
import { EmptyState, ErrorBanner, SkeletonFeed } from '../ui/States';
import { MediaFrame } from '../ui/MediaFrame';
import { PostCard } from './PostCard';
import { FeedReelCard, isFeedReel } from './FeedReelCard';

function tileMedia(item: any) {
  if (isFeedReel(item)) {
    const media = item.media;
    return {
      mediaId: media?.id || item.mediaId,
      secureUrl: media?.secureUrl,
      posterUrl: media?.posterUrl || media?.thumbnailUrl,
      mimeType: media?.mimeType || 'video/mp4',
      processingStatus: media?.processingStatus,
      playable: media?.playable !== false,
      isVideo: true
    };
  }
  const row = item.media?.[0];
  const media = row?.media;
  return {
    mediaId: media?.id || row?.mediaId,
    secureUrl: media?.secureUrl,
    posterUrl: media?.posterUrl || media?.thumbnailUrl,
    mimeType: media?.mimeType,
    processingStatus: media?.processingStatus,
    playable: media?.processingStatus !== 'processing',
    isVideo: String(media?.mimeType || '').startsWith('video/')
  };
}

/** Instagram-style featured cells: every 5th reel (or video) spans 2 rows. */
function isFeaturedTile(item: any, index: number) {
  if (index % 10 !== 2 && index % 10 !== 5) return false;
  return isFeedReel(item) || String(tileMedia(item).mimeType || '').startsWith('video/');
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function ExplorePage() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerStart, setViewerStart] = useState(0);
  const [users, setUsers] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [hashtags, setHashtags] = useState<any[]>([]);
  const [taggedPosts, setTaggedPosts] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<SearchHistoryItem[]>(() => listSearchHistory());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const viewerAnchorRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastSavedRef = useRef('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchExplore();
      const list = Array.isArray(data) ? data : [];
      setItems(list);
      setHasMore(list.length >= 36);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadMore = useCallback(async () => {
    if (!hasMore || busyRef.current || items.length === 0 || q.trim()) return;
    busyRef.current = true;
    setLoadingMore(true);
    try {
      const lastId = items[items.length - 1]?.id;
      const more = await fetchExplore(lastId);
      setItems((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        return [...prev, ...more.filter((p) => !ids.has(p.id))];
      });
      setHasMore(more.length >= 36);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoadingMore(false);
      busyRef.current = false;
    }
  }, [hasMore, items, q, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setHistory(listSearchHistory());
  }, []);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 1) {
      abortRef.current?.abort();
      setUsers([]);
      setPosts([]);
      setHashtags([]);
      setTaggedPosts([]);
      setSearchLoading(false);
      setSearched(false);
      return;
    }
    setSearchLoading(true);
    const handle = window.setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      void searchAll(trimmed, ac.signal)
        .then((res) => {
          setUsers(res.users ?? []);
          setPosts(res.posts ?? []);
          setHashtags(res.hashtags ?? []);
          setTaggedPosts(res.taggedPosts ?? []);
          setSearched(true);
          if (trimmed !== lastSavedRef.current) {
            pushSearchHistory(trimmed);
            lastSavedRef.current = trimmed;
            setHistory(listSearchHistory());
          }
        })
        .catch((err) => {
          if (err?.name === 'AbortError' || String(err?.message || '').includes('abort')) return;
          setError(err instanceof Error ? err.message : t('errorGeneric'));
        })
        .finally(() => setSearchLoading(false));
    }, 320);
    return () => window.clearTimeout(handle);
  }, [q, t]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || viewerOpen || q.trim()) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '320px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, viewerOpen, q]);

  useEffect(() => {
    if (!viewerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const tmr = window.setTimeout(() => {
      viewerAnchorRef.current?.scrollIntoView({ block: 'start' });
    }, 40);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(tmr);
    };
  }, [viewerOpen, viewerStart]);

  function openViewer(index: number) {
    setViewerStart(index);
    setViewerOpen(true);
  }

  function updateItem(next: any) {
    setItems((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...next } : p)));
  }

  function onRemoveHistory(item: SearchHistoryItem, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    removeSearchHistory(item.q);
    setHistory(listSearchHistory());
  }

  const searching = q.trim().length > 0;
  const showHistory = !searching && history.length > 0;
  const searchEmpty =
    !searchLoading &&
    searched &&
    users.length === 0 &&
    posts.length === 0 &&
    hashtags.length === 0 &&
    taggedPosts.length === 0;

  if (viewerOpen) {
    const ordered = [...items.slice(viewerStart), ...items.slice(0, viewerStart)];
    return (
      <div className="explore-viewer" role="dialog" aria-modal="true">
        <div className="explore-viewer-bar">
          <button type="button" className="button button-ghost button-compact" onClick={() => setViewerOpen(false)}>
            {t('close')}
          </button>
          <span className="explore-viewer-title">{t('explore')}</span>
        </div>
        <div className="explore-viewer-feed">
          {ordered.map((item, i) => (
            <div key={`${item.kind || 'x'}-${item.id}`} ref={i === 0 ? viewerAnchorRef : undefined}>
              {isFeedReel(item) ? (
                <FeedReelCard reel={item} onChange={updateItem} />
              ) : (
                <PostCard
                  post={item}
                  onChange={updateItem}
                  onRemoved={(id) => {
                    setItems((prev) => prev.filter((p) => p.id !== id));
                    if (ordered.length <= 1) setViewerOpen(false);
                  }}
                />
              )}
            </div>
          ))}
          <div ref={sentinelRef} className="feed-sentinel" />
          {loadingMore ? <p className="muted center-muted">{t('loading')}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="explore-page explore-page-ig explore-with-search">
      <div className="explore-search-bar">
        <input
          ref={searchInputRef}
          className="explore-search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          autoComplete="off"
          aria-label={t('search')}
        />
        {q ? (
          <button type="button" className="explore-search-clear" onClick={() => setQ('')} aria-label={t('close')}>
            ×
          </button>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}

      {searching ? (
        <div className="explore-search-results">
          {searchLoading ? <p className="muted center-muted">{t('loading')}</p> : null}
          {searchEmpty ? <EmptyState title={t('emptySearch')} /> : null}

          {hashtags.length > 0 ? (
            <section className="panel-block">
              <h2>{t('hashtagResults')}</h2>
              {hashtags.map((h) => (
                <button key={h.id} type="button" className="list-row" onClick={() => setQ(`#${h.tag}`)}>
                  <strong>#{h.tag}</strong>
                  <span className="muted">
                    {(h._count?.posts ?? 0) + (h._count?.reels ?? 0)} {t('posts')}
                  </span>
                </button>
              ))}
            </section>
          ) : null}

          {users.length > 0 ? (
            <section className="panel-block">
              <h2>{t('people')}</h2>
              {users.map((u) => (
                <Link key={u.id} className="list-row card-link" to={`/u/${u.username}`}>
                  <span className="inline-actions">
                    <span className="avatar-circle sm">
                      {(u.displayName || u.username || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <strong>@{u.username}</strong>
                  </span>
                  <span className="muted">{u.displayName || (u.isPrivate ? t('privateAccount') : '')}</span>
                </Link>
              ))}
            </section>
          ) : null}

          {taggedPosts.length > 0 ? (
            <section className="panel-block">
              <h2>{t('taggedPosts')}</h2>
              <div className="explore-grid explore-grid-ig">
                {taggedPosts.map((p) => {
                  const media = p.media?.[0]?.media;
                  return (
                    <Link key={p.id} to={`/p/${p.id}`} className="explore-tile explore-tile-ig">
                      <MediaFrame
                        mediaId={media?.id || p.media?.[0]?.mediaId}
                        secureUrl={media?.secureUrl}
                        mimeType={media?.mimeType}
                        variant="grid"
                        controls={false}
                      />
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}

          {posts.length > 0 ? (
            <section className="panel-block">
              <h2>{t('posts')}</h2>
              <div className="explore-grid explore-grid-ig">
                {posts.map((p) => {
                  const media = p.media?.[0]?.media;
                  return (
                    <Link key={p.id} to={`/p/${p.id}`} className="explore-tile explore-tile-ig">
                      <MediaFrame
                        mediaId={media?.id || p.media?.[0]?.mediaId}
                        secureUrl={media?.secureUrl}
                        mimeType={media?.mimeType}
                        variant="grid"
                        controls={false}
                      />
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <>
          {showHistory ? (
            <section className="search-history panel-block explore-history">
              <div className="search-history-head">
                <h2>{t('recentSearches')}</h2>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    clearSearchHistory();
                    setHistory([]);
                  }}
                >
                  {t('clearAll')}
                </button>
              </div>
              <ul className="search-history-list">
                {history.map((h) => (
                  <li key={`${h.q}-${h.savedAt}`}>
                    <button type="button" className="search-history-row" onClick={() => setQ(h.q)}>
                      <span className="search-history-ico" aria-hidden>
                        ◷
                      </span>
                      <span className="search-history-q">{h.q}</span>
                    </button>
                    <button
                      type="button"
                      className="search-history-x"
                      aria-label={t('removeFromHistory')}
                      onClick={(e) => onRemoveHistory(h, e)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {loading ? <SkeletonFeed /> : null}
          {!loading && items.length === 0 && !error ? <EmptyState title={t('emptyExplore')} /> : null}

          <div className="explore-grid explore-grid-ig">
            {items.map((item, index) => {
              const media = tileMedia(item);
              const featured = isFeaturedTile(item, index);
              const video = media.isVideo || isFeedReel(item);
              const views = Number(item.viewCount ?? item._count?.views ?? 0);
              return (
                <button
                  key={`${item.kind || 'post'}-${item.id}`}
                  type="button"
                  className={`explore-tile explore-tile-ig ${featured ? 'is-featured' : ''} ${video ? 'is-video' : ''}`}
                  onClick={() => openViewer(index)}
                  aria-label={isFeedReel(item) ? t('reels') : t('explore')}
                >
                  <MediaFrame
                    mediaId={media.mediaId}
                    secureUrl={media.secureUrl}
                    posterUrl={media.posterUrl}
                    mimeType={media.mimeType}
                    processingStatus={media.processingStatus}
                    playable={media.playable}
                    variant="grid"
                    eager={index < 12}
                    controls={false}
                    muted
                    autoPlay={video}
                  />
                  {isFeedReel(item) ? (
                    <span className="explore-reel-badge" aria-hidden>
                      ▷
                    </span>
                  ) : null}
                  {views > 0 ? (
                    <span className="explore-views-badge" aria-hidden>
                      👁 {formatViews(views)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div ref={sentinelRef} className="feed-sentinel" />
          {loadingMore ? <p className="muted center-muted">{t('loading')}</p> : null}
        </>
      )}
    </div>
  );
}
