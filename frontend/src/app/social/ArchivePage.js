import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { archivePost, archiveReel, fetchContentArchive } from '@/api/content';
import { deletePost, deleteReel } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { MediaFrame } from '../ui/MediaFrame';
import { useToast } from '../ui/Toast';
function formatDate(iso) {
    if (!iso)
        return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
export function ArchivePage() {
    const { t } = useI18n();
    const { push } = useToast();
    const [posts, setPosts] = useState([]);
    const [reels, setReels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const allItems = useMemo(() => [
        ...posts.map((p) => ({ ...p, kind: 'post' })),
        ...reels.map((r) => ({ ...r, kind: 'reel' }))
    ], [posts, reels]);
    async function reload() {
        setLoading(true);
        setError('');
        try {
            const data = await fetchContentArchive();
            setPosts((data.posts || []).map((p) => ({ ...p, kind: 'post' })));
            setReels((data.reels || []).map((r) => ({ ...r, kind: 'reel' })));
            setSelected(new Set());
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void reload();
    }, []);
    function toggle(id) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    }
    function selectAll() {
        setSelected(new Set(allItems.map((i) => `${i.kind}:${i.id}`)));
    }
    function clearSelection() {
        setSelected(new Set());
    }
    async function restoreOne(kind, id) {
        if (kind === 'post')
            await archivePost(id, false);
        else
            await archiveReel(id, false);
    }
    async function deleteOne(kind, id) {
        if (kind === 'post')
            await deletePost(id);
        else
            await deleteReel(id);
    }
    async function restoreSelected() {
        if (!selected.size)
            return;
        setBusy(true);
        setError('');
        try {
            for (const key of selected) {
                const [kind, id] = key.split(':');
                await restoreOne(kind, id);
            }
            push(t('restored'), 'success');
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function deleteSelected() {
        if (!selected.size)
            return;
        if (!window.confirm(t('confirmDeleteSelected')))
            return;
        setBusy(true);
        setError('');
        try {
            for (const key of selected) {
                const [kind, id] = key.split(':');
                await deleteOne(kind, id);
            }
            push(t('deleted'), 'success');
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function restoreItem(item) {
        setBusy(true);
        try {
            await restoreOne(item.kind, item.id);
            push(t('restored'), 'success');
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function deleteItem(item) {
        if (!window.confirm(t('confirmDeleteForever')))
            return;
        setBusy(true);
        try {
            await deleteOne(item.kind, item.id);
            push(t('deleted'), 'success');
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    if (loading)
        return _jsx(PageLoader, {});
    function renderGrid(items, emptyKey) {
        if (!items.length)
            return _jsx(EmptyState, { title: t(emptyKey) });
        return (_jsx("div", { className: "archive-grid", children: items.map((item) => {
                const key = `${item.kind}:${item.id}`;
                const checked = selected.has(key);
                const media = item.media;
                return (_jsxs("article", { className: `archive-tile ${checked ? 'is-selected' : ''}`, children: [_jsx("label", { className: "archive-check", children: _jsx("input", { type: "checkbox", checked: checked, onChange: () => toggle(key) }) }), _jsxs("div", { className: `archive-thumb ${item.kind === 'reel' ? 'is-reel' : ''}`, children: [media?.id || media?.secureUrl ? (_jsx(MediaFrame, { mediaId: media?.id ?? null, secureUrl: media?.secureUrl ?? null, posterUrl: media?.posterUrl ?? null, mimeType: media?.mimeType ?? null, variant: "grid", controls: false })) : (_jsx("div", { className: "archive-thumb-fallback", children: item.kind === 'reel' ? t('reels') : t('posts') })), item.kind === 'reel' ? _jsx("span", { className: "archive-reel-badge", children: "\u25B7" }) : null] }), _jsxs("div", { className: "archive-meta", children: [_jsx("p", { className: "archive-caption", children: item.caption || item.id.slice(0, 10) }), _jsx("span", { className: "muted tiny", children: formatDate(item.archivedAt || item.createdAt) })] }), _jsxs("div", { className: "archive-actions", children: [_jsx("button", { type: "button", className: "button button-compact", disabled: busy, onClick: () => void restoreItem(item), children: t('restore') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", disabled: busy, onClick: () => void deleteItem(item), children: t('deleteForever') })] })] }, key));
            }) }));
    }
    return (_jsxs("div", { className: "archive-page", children: [_jsxs("div", { className: "page-header", children: [_jsx(Link, { className: "button button-ghost button-compact", to: "/profile", children: t('back') }), _jsx("h1", { children: t('archive') })] }), error ? _jsx(ErrorBanner, { message: error, onRetry: () => void reload() }) : null, _jsx("p", { className: "muted", children: t('archiveHint') }), _jsxs("div", { className: "archive-toolbar", children: [_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: selectAll, disabled: !allItems.length, children: t('selectAll') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: clearSelection, disabled: !selected.size, children: t('clearSelection') }), _jsxs("button", { type: "button", className: "button button-compact", disabled: busy || !selected.size, onClick: () => void restoreSelected(), children: [t('restoreSelected'), " (", selected.size, ")"] }), _jsx("button", { type: "button", className: "button button-ghost button-compact danger-text", disabled: busy || !selected.size, onClick: () => void deleteSelected(), children: t('deleteSelected') })] }), _jsx("h2", { children: t('posts') }), renderGrid(posts, 'emptyArchivePosts'), _jsx("h2", { children: t('reels') }), renderGrid(reels, 'emptyArchiveReels')] }));
}
