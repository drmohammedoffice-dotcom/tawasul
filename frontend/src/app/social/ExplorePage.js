import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchExplore, searchAll } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { clearSearchHistory, listSearchHistory, pushSearchHistory, removeSearchHistory } from '@/lib/searchHistory';
import { EmptyState, ErrorBanner, SkeletonFeed } from '../ui/States';
import { MediaFrame } from '../ui/MediaFrame';
import { PostCard } from './PostCard';
import { FeedReelCard, isFeedReel } from './FeedReelCard';
function tileMedia(item) {
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
function isFeaturedTile(item, index) {
    if (index % 10 !== 2 && index % 10 !== 5)
        return false;
    return isFeedReel(item) || String(tileMedia(item).mimeType || '').startsWith('video/');
}
function formatViews(n) {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1000)
        return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(n);
}
export function ExplorePage() {
    const { t } = useI18n();
    const [q, setQ] = useState('');
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerStart, setViewerStart] = useState(0);
    const [users, setUsers] = useState([]);
    const [posts, setPosts] = useState([]);
    const [hashtags, setHashtags] = useState([]);
    const [taggedPosts, setTaggedPosts] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [history, setHistory] = useState(() => listSearchHistory());
    const sentinelRef = useRef(null);
    const viewerAnchorRef = useRef(null);
    const busyRef = useRef(false);
    const abortRef = useRef(null);
    const lastSavedRef = useRef('');
    const searchInputRef = useRef(null);
    const reload = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await fetchExplore();
            const list = Array.isArray(data) ? data : [];
            setItems(list);
            setHasMore(list.length >= 36);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setLoading(false);
        }
    }, [t]);
    const loadMore = useCallback(async () => {
        if (!hasMore || busyRef.current || items.length === 0 || q.trim())
            return;
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
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
                if (err?.name === 'AbortError' || String(err?.message || '').includes('abort'))
                    return;
                setError(err instanceof Error ? err.message : t('errorGeneric'));
            })
                .finally(() => setSearchLoading(false));
        }, 320);
        return () => window.clearTimeout(handle);
    }, [q, t]);
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore || viewerOpen || q.trim())
            return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting))
                void loadMore();
        }, { rootMargin: '320px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, loadMore, viewerOpen, q]);
    useEffect(() => {
        if (!viewerOpen)
            return;
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
    function openViewer(index) {
        setViewerStart(index);
        setViewerOpen(true);
    }
    function updateItem(next) {
        setItems((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...next } : p)));
    }
    function onRemoveHistory(item, e) {
        e.preventDefault();
        e.stopPropagation();
        removeSearchHistory(item.q);
        setHistory(listSearchHistory());
    }
    const searching = q.trim().length > 0;
    const showHistory = !searching && history.length > 0;
    const searchEmpty = !searchLoading &&
        searched &&
        users.length === 0 &&
        posts.length === 0 &&
        hashtags.length === 0 &&
        taggedPosts.length === 0;
    if (viewerOpen) {
        const ordered = [...items.slice(viewerStart), ...items.slice(0, viewerStart)];
        return (_jsxs("div", { className: "explore-viewer", role: "dialog", "aria-modal": "true", children: [_jsxs("div", { className: "explore-viewer-bar", children: [_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setViewerOpen(false), children: t('close') }), _jsx("span", { className: "explore-viewer-title", children: t('explore') })] }), _jsxs("div", { className: "explore-viewer-feed", children: [ordered.map((item, i) => (_jsx("div", { ref: i === 0 ? viewerAnchorRef : undefined, children: isFeedReel(item) ? (_jsx(FeedReelCard, { reel: item, onChange: updateItem })) : (_jsx(PostCard, { post: item, onChange: updateItem, onRemoved: (id) => {
                                    setItems((prev) => prev.filter((p) => p.id !== id));
                                    if (ordered.length <= 1)
                                        setViewerOpen(false);
                                } })) }, `${item.kind || 'x'}-${item.id}`))), _jsx("div", { ref: sentinelRef, className: "feed-sentinel" }), loadingMore ? _jsx("p", { className: "muted center-muted", children: t('loading') }) : null] })] }));
    }
    return (_jsxs("div", { className: "explore-page explore-page-ig explore-with-search", children: [_jsxs("div", { className: "explore-search-bar", children: [_jsx("input", { ref: searchInputRef, className: "explore-search-input", value: q, onChange: (e) => setQ(e.target.value), placeholder: t('searchPlaceholder'), autoComplete: "off", "aria-label": t('search') }), q ? (_jsx("button", { type: "button", className: "explore-search-clear", onClick: () => setQ(''), "aria-label": t('close'), children: "\u00D7" })) : null] }), error ? _jsx(ErrorBanner, { message: error, onRetry: () => void reload() }) : null, searching ? (_jsxs("div", { className: "explore-search-results", children: [searchLoading ? _jsx("p", { className: "muted center-muted", children: t('loading') }) : null, searchEmpty ? _jsx(EmptyState, { title: t('emptySearch') }) : null, hashtags.length > 0 ? (_jsxs("section", { className: "panel-block", children: [_jsx("h2", { children: t('hashtagResults') }), hashtags.map((h) => (_jsxs("button", { type: "button", className: "list-row", onClick: () => setQ(`#${h.tag}`), children: [_jsxs("strong", { children: ["#", h.tag] }), _jsxs("span", { className: "muted", children: [(h._count?.posts ?? 0) + (h._count?.reels ?? 0), " ", t('posts')] })] }, h.id)))] })) : null, users.length > 0 ? (_jsxs("section", { className: "panel-block", children: [_jsx("h2", { children: t('people') }), users.map((u) => (_jsxs(Link, { className: "list-row card-link", to: `/u/${u.username}`, children: [_jsxs("span", { className: "inline-actions", children: [_jsx("span", { className: "avatar-circle sm", children: (u.displayName || u.username || '?').slice(0, 1).toUpperCase() }), _jsxs("strong", { children: ["@", u.username] })] }), _jsx("span", { className: "muted", children: u.displayName || (u.isPrivate ? t('privateAccount') : '') })] }, u.id)))] })) : null, taggedPosts.length > 0 ? (_jsxs("section", { className: "panel-block", children: [_jsx("h2", { children: t('taggedPosts') }), _jsx("div", { className: "explore-grid explore-grid-ig", children: taggedPosts.map((p) => {
                                    const media = p.media?.[0]?.media;
                                    return (_jsx(Link, { to: `/p/${p.id}`, className: "explore-tile explore-tile-ig", children: _jsx(MediaFrame, { mediaId: media?.id || p.media?.[0]?.mediaId, secureUrl: media?.secureUrl, mimeType: media?.mimeType, variant: "grid", controls: false }) }, p.id));
                                }) })] })) : null, posts.length > 0 ? (_jsxs("section", { className: "panel-block", children: [_jsx("h2", { children: t('posts') }), _jsx("div", { className: "explore-grid explore-grid-ig", children: posts.map((p) => {
                                    const media = p.media?.[0]?.media;
                                    return (_jsx(Link, { to: `/p/${p.id}`, className: "explore-tile explore-tile-ig", children: _jsx(MediaFrame, { mediaId: media?.id || p.media?.[0]?.mediaId, secureUrl: media?.secureUrl, mimeType: media?.mimeType, variant: "grid", controls: false }) }, p.id));
                                }) })] })) : null] })) : (_jsxs(_Fragment, { children: [showHistory ? (_jsxs("section", { className: "search-history panel-block explore-history", children: [_jsxs("div", { className: "search-history-head", children: [_jsx("h2", { children: t('recentSearches') }), _jsx("button", { type: "button", className: "linkish", onClick: () => {
                                            clearSearchHistory();
                                            setHistory([]);
                                        }, children: t('clearAll') })] }), _jsx("ul", { className: "search-history-list", children: history.map((h) => (_jsxs("li", { children: [_jsxs("button", { type: "button", className: "search-history-row", onClick: () => setQ(h.q), children: [_jsx("span", { className: "search-history-ico", "aria-hidden": true, children: "\u25F7" }), _jsx("span", { className: "search-history-q", children: h.q })] }), _jsx("button", { type: "button", className: "search-history-x", "aria-label": t('removeFromHistory'), onClick: (e) => onRemoveHistory(h, e), children: "\u00D7" })] }, `${h.q}-${h.savedAt}`))) })] })) : null, loading ? _jsx(SkeletonFeed, {}) : null, !loading && items.length === 0 && !error ? _jsx(EmptyState, { title: t('emptyExplore') }) : null, _jsx("div", { className: "explore-grid explore-grid-ig", children: items.map((item, index) => {
                            const media = tileMedia(item);
                            const featured = isFeaturedTile(item, index);
                            const video = media.isVideo || isFeedReel(item);
                            const views = Number(item.viewCount ?? item._count?.views ?? 0);
                            return (_jsxs("button", { type: "button", className: `explore-tile explore-tile-ig ${featured ? 'is-featured' : ''} ${video ? 'is-video' : ''}`, onClick: () => openViewer(index), "aria-label": isFeedReel(item) ? t('reels') : t('explore'), children: [_jsx(MediaFrame, { mediaId: media.mediaId, secureUrl: media.secureUrl, posterUrl: media.posterUrl, mimeType: media.mimeType, processingStatus: media.processingStatus, playable: media.playable, variant: "grid", eager: index < 12, controls: false, muted: true, autoPlay: video }), isFeedReel(item) ? (_jsx("span", { className: "explore-reel-badge", "aria-hidden": true, children: "\u25B7" })) : null, views > 0 ? (_jsxs("span", { className: "explore-views-badge", "aria-hidden": true, children: ["\uD83D\uDC41 ", formatViews(views)] })) : null] }, `${item.kind || 'post'}-${item.id}`));
                        }) }), _jsx("div", { ref: sentinelRef, className: "feed-sentinel" }), loadingMore ? _jsx("p", { className: "muted center-muted", children: t('loading') }) : null] }))] }));
}
