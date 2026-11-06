import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchUnifiedInbox, pinInboxItem, setChatMute, unpinInboxItem } from '@/api/focus';
import { blockUser, deleteGroup, leaveChannel, leaveGroup, unblockUser } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { IconCompose, IconMegaphone, IconMore, IconPlus, IconSearch, IconUsers } from '../ui/Icons';
import { getRealtimeSocket } from '@/lib/realtime';
const ARCHIVE_KEY = 'securechat-focus-archived';
const BLOCKED_KEY = 'securechat-focus-blocked';
function formatTime(iso, locale) {
    if (!iso)
        return '';
    try {
        return new Date(iso).toLocaleTimeString(locale === 'ar' ? 'ar' : 'en', {
            hour: 'numeric',
            minute: '2-digit'
        });
    }
    catch {
        return '';
    }
}
function rowKey(row) {
    return `${row.type}:${row.id}`;
}
function readSet(key) {
    try {
        const raw = JSON.parse(window.localStorage.getItem(key) || '[]');
        return new Set(Array.isArray(raw) ? raw.map(String) : []);
    }
    catch {
        return new Set();
    }
}
function writeSet(key, set) {
    window.localStorage.setItem(key, JSON.stringify([...set]));
}
export function FocusChatsPage() {
    const { t, locale } = useI18n();
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [q, setQ] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [filter, setFilter] = useState('all');
    const [menuKey, setMenuKey] = useState(null);
    const [archived, setArchived] = useState(() => readSet(ARCHIVE_KEY));
    const [blocked, setBlocked] = useState(() => readSet(BLOCKED_KEY));
    async function reload() {
        setLoading(true);
        setError('');
        try {
            setItems(await fetchUnifiedInbox(80, 'focus'));
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
    useEffect(() => {
        const socket = getRealtimeSocket();
        if (!socket)
            return;
        const refresh = () => void reload();
        socket.on('message:new', refresh);
        socket.on('group:message:new', refresh);
        socket.on('channel:message:new', refresh);
        return () => {
            socket.off('message:new', refresh);
            socket.off('group:message:new', refresh);
            socket.off('channel:message:new', refresh);
        };
    }, []);
    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        let list = [...items].sort((a, b) => {
            if (a.pinned !== b.pinned)
                return a.pinned ? -1 : 1;
            if (a.pinned && b.pinned)
                return (a.pinSortOrder ?? 0) - (b.pinSortOrder ?? 0);
            const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
            const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
            return tb - ta;
        });
        list = list.filter((row) => {
            const key = rowKey(row);
            const isArchived = archived.has(key);
            const isBlocked = blocked.has(key);
            if (filter === 'archived')
                return isArchived || isBlocked;
            if (isArchived || isBlocked)
                return false;
            if (filter === 'dm')
                return row.type === 'dm';
            if (filter === 'group')
                return row.type === 'group';
            if (filter === 'channel')
                return row.type === 'channel';
            return true;
        });
        if (!needle)
            return list;
        return list.filter((row) => row.title.toLowerCase().includes(needle) ||
            (row.subtitle || '').toLowerCase().includes(needle) ||
            (row.lastMessage || '').toLowerCase().includes(needle));
    }, [items, q, filter, archived, blocked]);
    function openRow(row) {
        setMenuKey(null);
        if (row.type === 'dm') {
            navigate(`/focus/chats/dm/${row.id}`, {
                state: {
                    peer: {
                        id: row.id,
                        username: row.username || undefined,
                        displayName: row.title,
                        avatarUrl: row.avatarUrl
                    }
                }
            });
        }
        else if (row.type === 'group')
            navigate(`/focus/chats/group/${row.id}`);
        else
            navigate(`/focus/chats/channel/${row.id}`);
    }
    async function togglePin(row) {
        setMenuKey(null);
        try {
            if (row.pinned)
                await unpinInboxItem(row.type, row.id);
            else
                await pinInboxItem(row.type, row.id);
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function toggleMute(row) {
        setMenuKey(null);
        try {
            await setChatMute(row.type, row.id, !row.muted);
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    function toggleArchive(row) {
        setMenuKey(null);
        const key = rowKey(row);
        setArchived((prev) => {
            const next = new Set(prev);
            if (next.has(key))
                next.delete(key);
            else
                next.add(key);
            writeSet(ARCHIVE_KEY, next);
            return next;
        });
    }
    async function leaveOrDelete(row) {
        setMenuKey(null);
        try {
            if (row.type === 'group') {
                const okLeave = window.confirm(t('confirmLeaveGroup'));
                if (!okLeave)
                    return;
                try {
                    await leaveGroup(row.id);
                }
                catch {
                    if (window.confirm(t('confirmDeleteGroup')))
                        await deleteGroup(row.id);
                    else
                        return;
                }
            }
            else if (row.type === 'channel') {
                if (!window.confirm(t('confirmLeaveChannel')))
                    return;
                await leaveChannel(row.id);
            }
            else {
                toggleArchive(row);
                return;
            }
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function toggleBlock(row) {
        setMenuKey(null);
        const key = rowKey(row);
        const isBlocked = blocked.has(key);
        try {
            if (isBlocked) {
                if (row.type === 'dm')
                    await unblockUser(row.id);
                setBlocked((prev) => {
                    const next = new Set(prev);
                    next.delete(key);
                    writeSet(BLOCKED_KEY, next);
                    return next;
                });
            }
            else {
                const msg = row.type === 'dm' ? t('confirmBlockUser') : t('confirmBlockChat');
                if (!window.confirm(msg))
                    return;
                if (row.type === 'dm')
                    await blockUser(row.id);
                setBlocked((prev) => {
                    const next = new Set(prev);
                    next.add(key);
                    writeSet(BLOCKED_KEY, next);
                    return next;
                });
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    if (loading && items.length === 0)
        return _jsx(PageLoader, {});
    const filters = [
        { id: 'all', label: t('filterAll') },
        { id: 'dm', label: t('filterUsers') },
        { id: 'group', label: t('filterGroups') },
        { id: 'channel', label: t('filterChannels') },
        { id: 'archived', label: t('filterArchived') }
    ];
    return (_jsxs("div", { className: "focus-chats", children: [_jsxs("div", { className: "focus-chats-header", children: [_jsx("span", { className: "focus-header-spacer" }), _jsx("h1", { children: t('focusChats') }), _jsxs("div", { className: "focus-chats-actions", children: [_jsx(Link, { to: "/focus/contacts", className: "icon-btn", "aria-label": t('newMessage'), children: _jsx(IconCompose, { size: 20 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": t('create'), onClick: () => setCreateOpen((v) => !v), children: _jsx(IconPlus, { size: 20 }) })] })] }), createOpen ? (_jsx("div", { className: "focus-create-panel", children: _jsxs("div", { className: "focus-create-kinds", children: [_jsxs("button", { type: "button", className: "is-active", onClick: () => navigate('/focus/create/group'), children: [_jsx(IconUsers, { size: 16 }), " ", t('createGroup')] }), _jsxs("button", { type: "button", onClick: () => navigate('/focus/create/channel'), children: [_jsx(IconMegaphone, { size: 16 }), " ", t('createChannel')] })] }) })) : null, _jsx("div", { className: "focus-filter-tabs", role: "tablist", children: filters.map((f) => (_jsx("button", { type: "button", role: "tab", "aria-selected": filter === f.id, className: filter === f.id ? 'is-active' : '', onClick: () => setFilter(f.id), children: f.label }, f.id))) }), _jsxs("div", { className: "focus-search", children: [_jsx(IconSearch, { size: 16 }), _jsx("input", { value: q, onChange: (e) => setQ(e.target.value), placeholder: t('search'), "aria-label": t('search') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, filtered.length === 0 ? (_jsx("p", { className: "focus-empty-inline muted", children: t('emptyFocusChats') })) : (_jsx("ul", { className: "focus-chat-list", children: filtered.map((row) => {
                    const key = rowKey(row);
                    const menuOpen = menuKey === key;
                    const isBlocked = blocked.has(key);
                    return (_jsxs("li", { className: row.pinned ? 'is-pinned' : '', children: [_jsxs("div", { className: "focus-chat-row-wrap", children: [_jsxs("button", { type: "button", className: "focus-chat-row", onClick: () => openRow(row), children: [_jsx(UserAvatar, { size: "lg", name: row.title, username: row.username || row.title, avatarUrl: row.avatarUrl }), _jsxs("span", { className: "focus-chat-body", children: [_jsxs("span", { className: "focus-chat-top", children: [_jsxs("strong", { children: [row.title, row.type === 'group' ? (_jsx("span", { className: "focus-type-tag", children: t('groups') })) : null, row.type === 'channel' ? (_jsx("span", { className: "focus-type-tag", children: t('channels') })) : null, isBlocked ? (_jsx("span", { className: "focus-type-tag danger", children: t('blockedTag') })) : null] }), _jsx("time", { children: formatTime(row.lastAt, locale) })] }), _jsxs("span", { className: "focus-chat-bottom", children: [_jsx("span", { className: "muted ellipsis", children: row.lastMessage || t('noMessagesYet') }), row.unreadCount > 0 ? (_jsx("span", { className: `focus-unread${row.muted ? ' is-muted' : ''}`, children: row.unreadCount > 99 ? '99+' : row.unreadCount })) : null] })] })] }), _jsx("button", { type: "button", className: "focus-row-more", "aria-label": t('more'), onClick: (e) => {
                                            e.stopPropagation();
                                            setMenuKey(menuOpen ? null : key);
                                        }, children: _jsx(IconMore, { size: 18 }) })] }), menuOpen ? (_jsxs("div", { className: "focus-row-menu", role: "menu", children: [_jsx("button", { type: "button", role: "menuitem", onClick: () => void togglePin(row), children: row.pinned ? t('unpin') : t('pin') }), _jsx("button", { type: "button", role: "menuitem", onClick: () => void toggleMute(row), children: row.muted ? t('unmute') : t('mute') }), _jsx("button", { type: "button", role: "menuitem", onClick: () => toggleArchive(row), children: archived.has(key) ? t('unarchiveChat') : t('archiveChat') }), _jsx("button", { type: "button", role: "menuitem", onClick: () => void toggleBlock(row), children: isBlocked ? t('unblock') : t('block') }), _jsx("button", { type: "button", role: "menuitem", className: "danger", onClick: () => void leaveOrDelete(row), children: row.type === 'dm'
                                            ? t('deleteChat')
                                            : row.type === 'group'
                                                ? t('leaveGroup')
                                                : t('leaveChannel') })] })) : null] }, key));
                }) })), menuKey ? (_jsx("button", { type: "button", className: "focus-menu-scrim", "aria-label": t('close'), onClick: () => setMenuKey(null) })) : null] }));
}
