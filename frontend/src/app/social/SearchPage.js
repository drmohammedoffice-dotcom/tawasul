import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { searchAll } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { clearSearchHistory, listSearchHistory, pushSearchHistory, removeSearchHistory } from '@/lib/searchHistory';
import { EmptyState, ErrorBanner } from '../ui/States';
import { MediaFrame } from '../ui/MediaFrame';
export function SearchPage() {
    const { t } = useI18n();
    const [q, setQ] = useState('');
    const [users, setUsers] = useState([]);
    const [posts, setPosts] = useState([]);
    const [hashtags, setHashtags] = useState([]);
    const [taggedPosts, setTaggedPosts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [searched, setSearched] = useState(false);
    const [history, setHistory] = useState(() => listSearchHistory());
    const abortRef = useRef(null);
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
                if (err?.name === 'AbortError' || String(err?.message || '').includes('abort'))
                    return;
                setError(err instanceof Error ? err.message : t('errorGeneric'));
            })
                .finally(() => setLoading(false));
        }, 320);
        return () => window.clearTimeout(handle);
    }, [q, t]);
    const showHistory = !q.trim() && history.length > 0;
    const empty = !loading &&
        searched &&
        users.length === 0 &&
        posts.length === 0 &&
        hashtags.length === 0 &&
        taggedPosts.length === 0;
    function onRemoveHistory(item, e) {
        e.preventDefault();
        e.stopPropagation();
        removeSearchHistory(item.q);
        setHistory(listSearchHistory());
    }
    function onClearAll() {
        clearSearchHistory();
        setHistory([]);
    }
    return (_jsxs("div", { children: [_jsx("div", { className: "page-header", children: _jsx("h1", { children: t('search') }) }), _jsx("input", { className: "search-input", value: q, onChange: (e) => setQ(e.target.value), placeholder: t('searchPlaceholder'), autoComplete: "off" }), showHistory ? (_jsxs("section", { className: "search-history panel-block", children: [_jsxs("div", { className: "search-history-head", children: [_jsx("h2", { children: t('recentSearches') }), _jsx("button", { type: "button", className: "linkish", onClick: onClearAll, children: t('clearAll') })] }), _jsx("ul", { className: "search-history-list", children: history.map((h) => (_jsxs("li", { children: [_jsxs("button", { type: "button", className: "search-history-row", onClick: () => setQ(h.q), children: [_jsx("span", { className: "search-history-ico", "aria-hidden": true, children: "\u25F7" }), _jsx("span", { className: "search-history-q", children: h.q })] }), _jsx("button", { type: "button", className: "search-history-x", "aria-label": t('removeFromHistory'), onClick: (e) => onRemoveHistory(h, e), children: "\u00D7" })] }, `${h.q}-${h.savedAt}`))) })] })) : null, loading ? _jsx("p", { className: "muted", children: t('loading') }) : null, error ? _jsx(ErrorBanner, { message: error }) : null, empty ? _jsx(EmptyState, { title: t('emptySearch') }) : null, hashtags.length > 0 ? (_jsxs("section", { className: "panel-block", children: [_jsx("h2", { children: t('hashtagResults') }), hashtags.map((h) => (_jsxs("button", { type: "button", className: "list-row", onClick: () => setQ(`#${h.tag}`), children: [_jsxs("strong", { children: ["#", h.tag] }), _jsxs("span", { className: "muted", children: [(h._count?.posts ?? 0) + (h._count?.reels ?? 0), " ", t('posts')] })] }, h.id)))] })) : null, users.length > 0 ? (_jsxs("section", { className: "panel-block", children: [_jsx("h2", { children: t('people') }), users.map((u) => (_jsxs(Link, { className: "list-row card-link", to: `/u/${u.username}`, children: [_jsxs("span", { className: "inline-actions", children: [_jsx("span", { className: "avatar-circle sm", children: (u.displayName || u.username || '?').slice(0, 1).toUpperCase() }), _jsxs("strong", { children: ["@", u.username] })] }), _jsx("span", { className: "muted", children: u.displayName || (u.isPrivate ? t('privateAccount') : '') })] }, u.id)))] })) : null, taggedPosts.length > 0 ? (_jsxs("section", { className: "panel-block", children: [_jsx("h2", { children: t('taggedPosts') }), _jsx("div", { className: "explore-grid", children: taggedPosts.map((p) => {
                            const media = p.media?.[0]?.media;
                            return (_jsxs(Link, { to: `/p/${p.id}`, className: "search-post-tile", children: [_jsx(MediaFrame, { mediaId: media?.id || p.media?.[0]?.mediaId, secureUrl: media?.secureUrl, mimeType: media?.mimeType, variant: "grid", controls: false }), _jsxs("span", { className: "explore-tile-meta", children: ["@", p.author?.username] })] }, p.id));
                        }) })] })) : null, posts.length > 0 ? (_jsxs("section", { className: "panel-block", children: [_jsx("h2", { children: t('posts') }), _jsx("div", { className: "explore-grid", children: posts.map((p) => {
                            const media = p.media?.[0]?.media;
                            return (_jsxs("div", { className: "search-post-tile", children: [_jsx(MediaFrame, { mediaId: media?.id || p.media?.[0]?.mediaId, secureUrl: media?.secureUrl, mimeType: media?.mimeType, variant: "grid", controls: false }), _jsxs(Link, { to: `/u/${p.author?.username}`, className: "explore-tile-meta", children: ["@", p.author?.username] })] }, p.id));
                        }) })] })) : null] }));
}
