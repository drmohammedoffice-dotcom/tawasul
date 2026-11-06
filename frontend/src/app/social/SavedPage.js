import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { fetchBookmarks } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { PostCard } from './PostCard';
export function SavedPage() {
    const { t } = useI18n();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [loadingMore, setLoadingMore] = useState(false);
    async function load(reset = true) {
        if (reset)
            setLoading(true);
        else
            setLoadingMore(true);
        setError('');
        try {
            const cursor = !reset && items.length ? items[items.length - 1]?.bookmarkedAt : undefined;
            const data = await fetchBookmarks(cursor ? String(cursor) : undefined);
            const next = Array.isArray(data) ? data : [];
            setItems((prev) => (reset ? next : [...prev, ...next.filter((n) => !prev.some((p) => p.id === n.id))]));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }
    useEffect(() => {
        void load(true);
    }, []);
    if (loading)
        return _jsx(PageLoader, {});
    if (error && items.length === 0)
        return _jsx(ErrorBanner, { message: error, onRetry: () => void load(true) });
    return (_jsxs("div", { children: [_jsx("div", { className: "page-header", children: _jsx("h1", { children: t('saved') }) }), error ? _jsx(ErrorBanner, { message: error }) : null, items.length === 0 ? _jsx(EmptyState, { title: t('emptySaved') }) : null, items.map((post) => (_jsx(PostCard, { post: post, onChange: (next) => {
                    if (Array.isArray(next.bookmarks) && next.bookmarks.length === 0) {
                        setItems((prev) => prev.filter((p) => p.id !== next.id));
                    }
                    else {
                        setItems((prev) => prev.map((p) => (p.id === next.id ? next : p)));
                    }
                }, onRemoved: (id) => setItems((prev) => prev.filter((p) => p.id !== id)) }, post.id))), items.length > 0 ? (_jsx("button", { className: "button button-ghost", type: "button", disabled: loadingMore, onClick: () => void load(false), children: loadingMore ? t('loading') : t('loadMore') })) : null] }));
}
