import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { searchAll } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import {
  clearSearchHistory,
  listSearchHistory,
  pushSearchHistory,
  removeSearchHistory,
  type SearchHistoryItem
} from '@/lib/searchHistory';
import { EmptyState, ErrorBanner } from '../ui/States';
import { MediaFrame } from '../ui/MediaFrame';

export function SearchPage() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [hashtags, setHashtags] = useState<any[]>([]);
  const [taggedPosts, setTaggedPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<SearchHistoryItem[]>(() => listSearchHistory());
  const abortRef = useRef<AbortController | null>(null);
  const lastSavedRef = useRef('');

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
      setLoading(false);
      setSearched(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
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
        .finally(() => setLoading(false));
    }, 320);
    return () => window.clearTimeout(handle);
  }, [q, t]);

  const showHistory = !q.trim() && history.length > 0;

  const empty =
    !loading &&
    searched &&
    users.length === 0 &&
    posts.length === 0 &&
    hashtags.length === 0 &&
    taggedPosts.length === 0;

  function onRemoveHistory(item: SearchHistoryItem, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    removeSearchHistory(item.q);
    setHistory(listSearchHistory());
  }

  function onClearAll() {
    clearSearchHistory();
    setHistory([]);
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('search')}</h1>
      </div>
      <input
        className="search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('searchPlaceholder')}
        autoComplete="off"
      />

      {showHistory ? (
        <section className="search-history panel-block">
          <div className="search-history-head">
            <h2>{t('recentSearches')}</h2>
            <button type="button" className="linkish" onClick={onClearAll}>
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

      {loading ? <p className="muted">{t('loading')}</p> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {empty ? <EmptyState title={t('emptySearch')} /> : null}

      {hashtags.length > 0 ? (
        <section className="panel-block">
          <h2>{t('hashtagResults')}</h2>
          {hashtags.map((h) => (
            <button
              key={h.id}
              type="button"
              className="list-row"
              onClick={() => setQ(`#${h.tag}`)}
            >
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
          <div className="explore-grid">
            {taggedPosts.map((p) => {
              const media = p.media?.[0]?.media;
              return (
                <Link key={p.id} to={`/p/${p.id}`} className="search-post-tile">
                  <MediaFrame
                    mediaId={media?.id || p.media?.[0]?.mediaId}
                    secureUrl={media?.secureUrl}
                    mimeType={media?.mimeType}
                    variant="grid"
                    controls={false}
                  />
                  <span className="explore-tile-meta">@{p.author?.username}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {posts.length > 0 ? (
        <section className="panel-block">
          <h2>{t('posts')}</h2>
          <div className="explore-grid">
            {posts.map((p) => {
              const media = p.media?.[0]?.media;
              return (
                <div key={p.id} className="search-post-tile">
                  <MediaFrame
                    mediaId={media?.id || p.media?.[0]?.mediaId}
                    secureUrl={media?.secureUrl}
                    mimeType={media?.mimeType}
                    variant="grid"
                    controls={false}
                  />
                  <Link to={`/u/${p.author?.username}`} className="explore-tile-meta">
                    @{p.author?.username}
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
