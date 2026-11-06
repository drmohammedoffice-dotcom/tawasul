import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
function feedCursor(item) {
    if (item?.recommendationCursor)
        return String(item.recommendationCursor);
    if (!item?.createdAt)
        return item?.id ?? null;
    const iso = typeof item.createdAt === 'string' ? item.createdAt : new Date(item.createdAt).toISOString();
    return iso || item?.id || null;
}
export function FeedPage() {
    const { t } = useI18n();
    const [items, setItems] = useState([]);
    const [stories, setStories] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [cursor, setCursor] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const sentinelRef = useRef(null);
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
        }
        catch (err) {
            if (err instanceof SessionExpiredError) {
                setError(t('sessionExpired'));
            }
            else {
                setError(err instanceof Error ? err.message : t('errorGeneric'));
            }
        }
        finally {
            setLoading(false);
        }
    }, [t]);
    const loadMore = useCallback(async () => {
        if (!hasMore || !cursor || busyRef.current)
            return;
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
        }
        catch (err) {
            if (!(err instanceof SessionExpiredError)) {
                setError(err instanceof Error ? err.message : t('errorGeneric'));
            }
        }
        finally {
            setLoadingMore(false);
            busyRef.current = false;
        }
    }, [cursor, hasMore, t]);
    useEffect(() => {
        void reload();
    }, [reload]);
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore)
            return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting))
                void loadMore();
        }, { rootMargin: '240px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, loadMore]);
    if (loading) {
        return (_jsxs("div", { className: "feed-page", children: [_jsx("div", { className: "page-header", children: _jsx("h1", { children: t('home') }) }), _jsx(SkeletonFeed, {})] }));
    }
    if (error && items.length === 0) {
        return (_jsxs("div", { className: "feed-page", children: [_jsx("div", { className: "page-header", children: _jsx("h1", { children: t('home') }) }), _jsx(ErrorBanner, { message: error, onRetry: () => void reload() })] }));
    }
    return (_jsxs("div", { className: "feed-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('home') }), _jsx(Link, { className: "button button-compact button-ghost", to: "/create", children: t('create') })] }), error ? _jsx(ErrorBanner, { message: error, onRetry: () => void reload() }) : null, _jsx(StoriesRail, { stories: stories, onChanged: () => void reload() }), items.length === 0 ? (_jsx(EmptyState, { title: t('emptyFeed'), action: _jsxs("div", { className: "inline-actions", children: [_jsx(Link, { className: "button button-compact", to: "/explore", children: t('openExplore') }), _jsx(Link, { className: "button button-compact button-ghost", to: "/create", children: t('createSomething') })] }) })) : null, items.map((item) => isFeedReel(item) ? (_jsx(ImpressionSlot, { contentType: "reel", contentId: item.id, surface: "feed", children: _jsx(FeedReelCard, { reel: item, onChange: (next) => setItems((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...next } : p))), onRemoved: (id) => setItems((prev) => prev.filter((p) => p.id !== id)) }) }, `reel-${item.id}`)) : (_jsx(ImpressionSlot, { contentType: "post", contentId: item.id, surface: "feed", children: _jsx(PostCard, { post: item, onChange: (next) => setItems((prev) => prev.map((p) => (p.id === next.id ? next : p))), onRemoved: (id) => setItems((prev) => prev.filter((p) => p.id !== id)) }) }, `post-${item.id}`))), _jsx("div", { ref: sentinelRef, className: "feed-sentinel" }), loadingMore ? _jsx("p", { className: "muted center-muted", children: t('loading') }) : null] }));
}
