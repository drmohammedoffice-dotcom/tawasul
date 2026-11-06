import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addGroupMember, deleteGroup, fetchGroup, fetchGroupInvite, fetchGroupMembers, fetchGroupMessages, leaveGroup, removeGroupMember, updateGroup } from '@/api/social';
import { FocusSpacePhoto } from './FocusSpacePhoto';
import { fetchFocusContacts, fetchUnifiedInbox, setChatMute } from '@/api/focus';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { clientRequestId, getRealtimeSocket } from '@/lib/realtime';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { IconBell, IconMore, IconMute, IconPlus, IconSearch, IconSend, IconSettings, IconUserPlus, IconUsers, IconVideo } from '../ui/Icons';
import { FocusBackBar } from './FocusBackBar';
import { FocusInviteSheet } from './FocusInviteSheet';
function formatMsgTime(iso, locale) {
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
function roleLabel(role, t) {
    if (role === 'owner')
        return t('ownerBadge');
    if (role === 'admin')
        return t('adminBadge');
    return '';
}
export function FocusGroupPage() {
    const { t, locale } = useI18n();
    const { session } = useAuth();
    const navigate = useNavigate();
    const { groupId = '' } = useParams();
    const [view, setView] = useState('chat');
    const [group, setGroup] = useState(null);
    const [members, setMembers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [muted, setMuted] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteUrl, setInviteUrl] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQ, setSearchQ] = useState('');
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [busy, setBusy] = useState(false);
    const [addQ, setAddQ] = useState('');
    const [contacts, setContacts] = useState([]);
    const canManage = group?.myRole === 'owner' || group?.myRole === 'admin';
    const isOwner = group?.myRole === 'owner';
    const memberCount = group?._count?.members ?? members.length;
    const meId = session?.user?.id;
    async function reload() {
        setLoading(true);
        setError('');
        try {
            const [g, m, msgs] = await Promise.all([
                fetchGroup(groupId),
                fetchGroupMembers(groupId),
                fetchGroupMessages(groupId)
            ]);
            setGroup(g);
            setMembers(m);
            setMessages(msgs);
            setEditName(g.name || '');
            setEditDesc(g.description || '');
            try {
                const inbox = await fetchUnifiedInbox(80, 'focus');
                const row = inbox.find((i) => i.type === 'group' && i.id === groupId);
                if (row)
                    setMuted(Boolean(row.muted));
            }
            catch {
                /* keep mute default */
            }
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
    }, [groupId]);
    useEffect(() => {
        if (!groupId)
            return;
        const socket = getRealtimeSocket();
        if (!socket)
            return;
        const onNew = (data) => {
            if (data?.groupId && data.groupId !== groupId)
                return;
            setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
        };
        const join = () => socket.emit('group:join', { groupId });
        socket.on('group:message:new', onNew);
        if (socket.connected)
            join();
        socket.on('connect', join);
        return () => {
            socket.off('group:message:new', onNew);
            socket.off('connect', join);
            socket.emit('group:leave', { groupId });
        };
    }, [groupId]);
    useEffect(() => {
        if (view !== 'addMembers')
            return;
        let cancelled = false;
        const handle = window.setTimeout(() => {
            void fetchFocusContacts(addQ)
                .then((rows) => {
                if (!cancelled)
                    setContacts(rows);
            })
                .catch(() => undefined);
        }, addQ ? 250 : 0);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [view, addQ]);
    const visibleMessages = useMemo(() => {
        const needle = searchQ.trim().toLowerCase();
        if (!needle)
            return messages;
        return messages.filter((m) => m.encryptedContent.toLowerCase().includes(needle));
    }, [messages, searchQ]);
    const memberIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
    async function openInvite() {
        try {
            const inv = await fetchGroupInvite(groupId);
            setInviteUrl(`${window.location.origin}/focus/join-group/${inv.inviteSlug}`);
            setInviteOpen(true);
            setMoreOpen(false);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function toggleMute() {
        try {
            await setChatMute('group', groupId, !muted);
            setMuted((v) => !v);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    function startVideoCall() {
        const socket = getRealtimeSocket();
        socket?.emit('call:invite', { scope: 'group', spaceId: groupId, kind: 'video' });
    }
    function send(e) {
        e.preventDefault();
        if (!text.trim())
            return;
        const socket = getRealtimeSocket();
        if (!socket) {
            setError(t('errorGeneric'));
            return;
        }
        const content = text.trim();
        setText('');
        socket.emit('group:message:send', { groupId, encryptedContent: content, clientRequestId: clientRequestId('g') }, (ack) => {
            if (ack?.data) {
                setMessages((prev) => prev.some((m) => m.id === ack.data.id) ? prev : [...prev, ack.data]);
            }
        });
    }
    async function saveEdit() {
        setBusy(true);
        setError('');
        try {
            const g = (await updateGroup(groupId, {
                name: editName.trim(),
                description: editDesc.trim()
            }));
            setGroup((prev) => ({ ...prev, ...g }));
            setView('settings');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function setVisibility(visibility) {
        try {
            const g = (await updateGroup(groupId, { visibility }));
            setGroup((prev) => ({ ...prev, ...g }));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function setHistory(historyVisibility) {
        try {
            const g = (await updateGroup(groupId, { historyVisibility }));
            setGroup((prev) => ({ ...prev, ...g }));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function onLeave() {
        try {
            await leaveGroup(groupId);
            navigate('/focus/chats', { replace: true });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function onDelete() {
        if (!window.confirm(t('confirmDeleteGroup')))
            return;
        try {
            await deleteGroup(groupId);
            navigate('/focus/chats', { replace: true });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function addPerson(userId) {
        setBusy(true);
        try {
            await addGroupMember(groupId, userId);
            await reload();
            setView('profile');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function kick(userId) {
        try {
            await removeGroupMember(groupId, userId);
            setMembers((prev) => prev.filter((m) => m.userId !== userId));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    if (loading && !group)
        return _jsx(PageLoader, {});
    if (error && !group)
        return _jsx(ErrorBanner, { message: error });
    if (!group)
        return _jsx(EmptyState, { title: t('notMember') });
    /* ——— Edit profile (name / photo / description) ——— */
    if (view === 'edit') {
        return (_jsxs("div", { className: "tg-group-settings", children: [_jsxs("header", { className: "tg-edit-top", children: [_jsx("button", { type: "button", className: "focus-back-btn", onClick: () => setView('settings'), children: "\u2715" }), _jsx("button", { type: "button", className: "tg-save-fab", disabled: busy || editName.trim().length < 2, onClick: () => void saveEdit(), "aria-label": t('saveProfile'), children: "\u2713" })] }), _jsx("div", { className: "tg-profile-hero", children: _jsx(FocusSpacePhoto, { kind: "group", spaceId: groupId, name: editName || group.name, avatarUrl: group.avatarUrl, canEdit: canManage, onUpdated: (url) => setGroup((prev) => ({ ...prev, avatarUrl: url })) }) }), _jsxs("div", { className: "tg-settings-card", children: [_jsx("input", { className: "tg-settings-field", value: editName, onChange: (e) => setEditName(e.target.value), placeholder: t('groupName'), dir: "auto" }), _jsx("textarea", { className: "tg-settings-field", value: editDesc, onChange: (e) => setEditDesc(e.target.value), placeholder: t('description'), rows: 3, dir: "auto" })] }), error ? _jsx(ErrorBanner, { message: error }) : null] }));
    }
    /* ——— Settings list ——— */
    if (view === 'settings') {
        const inviteCount = group.inviteSlug ? 1 : 0;
        const adminCount = members.filter((m) => m.role === 'owner' || m.role === 'admin').length;
        return (_jsxs("div", { className: "tg-group-settings", children: [_jsx(FocusBackBar, { title: t('groupSettings'), onBack: () => setView('profile'), trailing: canManage ? (_jsx("button", { type: "button", className: "focus-text-btn", onClick: () => setView('edit'), children: t('edit') })) : null }), error ? _jsx(ErrorBanner, { message: error }) : null, canManage ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "tg-profile-hero compact", children: [_jsx(FocusSpacePhoto, { kind: "group", spaceId: groupId, name: group.name, avatarUrl: group.avatarUrl, canEdit: canManage, onUpdated: (url) => setGroup((prev) => ({ ...prev, avatarUrl: url })) }), _jsx("h1", { children: group.name })] }), _jsxs("div", { className: "tg-settings-card", children: [_jsxs("button", { type: "button", className: "tg-settings-row", onClick: () => void setVisibility(group.visibility === 'public' ? 'private' : 'public'), children: [_jsx("span", { className: "tg-ico blue", children: _jsx(IconUsers, { size: 18 }) }), _jsx("span", { className: "tg-settings-main", children: _jsx("strong", { children: t('groupType') }) }), _jsx("span", { className: "muted tiny", children: group.visibility === 'public' ? t('publicGroup') : t('privateGroup') })] }), _jsxs("button", { type: "button", className: "tg-settings-row", onClick: () => void setHistory(group.historyVisibility === 'hidden' ? 'visible' : 'hidden'), children: [_jsx("span", { className: "tg-ico green", children: _jsx(IconSend, { size: 18 }) }), _jsx("span", { className: "tg-settings-main", children: _jsx("strong", { children: t('chatHistory') }) }), _jsx("span", { className: "muted tiny", children: group.historyVisibility === 'hidden' ? t('historyHidden') : t('historyVisible') })] }), _jsxs("button", { type: "button", className: "tg-settings-row", onClick: () => void openInvite(), children: [_jsx("span", { className: "tg-ico orange", children: "\uD83D\uDD17" }), _jsx("span", { className: "tg-settings-main", children: _jsx("strong", { children: t('inviteLinks') }) }), _jsx("span", { className: "muted tiny", children: inviteCount || 1 })] }), _jsxs("button", { type: "button", className: "tg-settings-row", onClick: () => setView('edit'), children: [_jsx("span", { className: "tg-ico purple", children: "\u270E" }), _jsx("span", { className: "tg-settings-main", children: _jsx("strong", { children: t('edit') }) }), _jsx("span", { className: "chev", children: "\u203A" })] })] })] })) : null, _jsxs("div", { className: "tg-settings-card", children: [_jsxs("button", { type: "button", className: "tg-settings-row", onClick: () => setView('profile'), children: [_jsx("span", { className: "tg-ico blue", children: _jsx(IconUsers, { size: 18 }) }), _jsx("span", { className: "tg-settings-main", children: _jsx("strong", { children: t('members') }) }), _jsx("span", { className: "muted tiny", children: memberCount })] }), _jsxs("button", { type: "button", className: "tg-settings-row", onClick: () => setView('profile'), children: [_jsx("span", { className: "tg-ico green", children: "\u2605" }), _jsx("span", { className: "tg-settings-main", children: _jsx("strong", { children: t('administrators') }) }), _jsx("span", { className: "muted tiny", children: adminCount })] })] }), !isOwner ? (_jsx("button", { type: "button", className: "tg-danger-btn", onClick: () => void onLeave(), children: t('leaveGroup') })) : (_jsx("button", { type: "button", className: "tg-danger-btn", onClick: () => void onDelete(), children: t('deleteGroup') })), _jsx(FocusInviteSheet, { open: inviteOpen, onClose: () => setInviteOpen(false), url: inviteUrl, title: group.name })] }));
    }
    /* ——— Add members ——— */
    if (view === 'addMembers') {
        return (_jsxs("div", { className: "tg-group-settings", children: [_jsx(FocusBackBar, { title: t('addMembers'), onBack: () => setView('profile') }), _jsxs("div", { className: "focus-search", children: [_jsx(IconSearch, { size: 16 }), _jsx("input", { value: addQ, onChange: (e) => setAddQ(e.target.value), placeholder: t('searchContacts') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsx("ul", { className: "focus-pick-list", children: contacts
                        .filter((c) => !memberIds.has(c.id))
                        .map((c) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "focus-pick-row", disabled: busy, onClick: () => void addPerson(c.id), children: [_jsx(UserAvatar, { size: "md", name: c.displayName || c.username, username: c.username, avatarUrl: c.avatarUrl }), _jsxs("span", { className: "focus-contact-body", children: [_jsx("strong", { children: c.displayName || c.username }), _jsxs("span", { className: "muted", children: ["@", c.username] })] }), _jsx(IconPlus, { size: 18 })] }) }, c.id))) })] }));
    }
    /* ——— Profile (Telegram group info) ——— */
    if (view === 'profile') {
        return (_jsxs("div", { className: "tg-channel-profile", children: [_jsxs("header", { className: "tg-profile-topbar", children: [_jsx("button", { type: "button", className: "focus-back-btn", onClick: () => setView('chat'), children: "\u2190" }), _jsxs("div", { className: "tg-profile-top-actions", children: [canManage ? (_jsx("button", { type: "button", className: "focus-back-btn", onClick: () => setView('addMembers'), "aria-label": t('addMembers'), children: _jsx(IconPlus, { size: 18 }) })) : null, canManage ? (_jsx("button", { type: "button", className: "focus-text-btn", onClick: () => setView('edit'), children: t('edit') })) : null] })] }), _jsxs("div", { className: "tg-profile-hero", children: [_jsx(FocusSpacePhoto, { kind: "group", spaceId: groupId, name: group.name, avatarUrl: group.avatarUrl, canEdit: canManage, onUpdated: (url) => setGroup((prev) => ({ ...prev, avatarUrl: url })) }), _jsx("h1", { children: group.name }), _jsxs("p", { className: "muted", children: [memberCount.toLocaleString(locale === 'ar' ? 'ar' : 'en'), " ", t('members')] })] }), _jsxs("div", { className: "tg-action-row", children: [_jsxs("button", { type: "button", className: "tg-action-btn", onClick: startVideoCall, children: [_jsx(IconVideo, { size: 20 }), _jsx("span", { children: t('videoChat') })] }), _jsxs("button", { type: "button", className: "tg-action-btn", onClick: () => void toggleMute(), children: [muted ? _jsx(IconBell, { size: 20 }) : _jsx(IconMute, { size: 20 }), _jsx("span", { children: muted ? t('unmute') : t('mute') })] }), _jsxs("button", { type: "button", className: "tg-action-btn", onClick: () => {
                                setSearchOpen(true);
                                setView('chat');
                            }, children: [_jsx(IconSearch, { size: 20 }), _jsx("span", { children: t('search') })] }), _jsxs("button", { type: "button", className: "tg-action-btn", onClick: () => setMoreOpen(true), children: [_jsx(IconMore, { size: 20 }), _jsx("span", { children: t('more') })] })] }), moreOpen ? (_jsx("div", { className: "focus-sheet-backdrop", onClick: () => setMoreOpen(false), children: _jsxs("div", { className: "focus-sheet", onClick: (e) => e.stopPropagation(), children: [_jsx("div", { className: "focus-sheet-handle" }), _jsx("button", { type: "button", className: "button", onClick: () => {
                                    setMoreOpen(false);
                                    void openInvite();
                                }, children: t('shareInviteLink') }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => {
                                    setMoreOpen(false);
                                    void toggleMute();
                                }, children: muted ? t('unmute') : t('mute') }), !isOwner ? (_jsx("button", { type: "button", className: "button button-ghost", style: { color: '#ff453a' }, onClick: () => void onLeave(), children: t('leaveGroup') })) : (_jsx("button", { type: "button", className: "button button-ghost", style: { color: '#ff453a' }, onClick: () => void onDelete(), children: t('deleteGroup') })), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => setMoreOpen(false), children: t('close') })] }) })) : null, _jsxs("button", { type: "button", className: "tg-settings-entry", onClick: () => setView('settings'), children: [_jsx("span", { className: "tg-ico orange", children: _jsx(IconSettings, { size: 18 }) }), _jsx("strong", { children: t('groupSettings') }), _jsx("span", { className: "chev", children: "\u203A" })] }), _jsxs("section", { className: "tg-members-card", children: [canManage ? (_jsxs("button", { type: "button", className: "tg-member-row add", onClick: () => setView('addMembers'), children: [_jsx("span", { className: "tg-add-member-ico", children: _jsx(IconUserPlus, { size: 20 }) }), _jsx("strong", { className: "tg-add-label", children: t('addMembers') })] })) : null, members.map((m) => {
                            const name = m.user?.displayName?.trim() ||
                                m.user?.username ||
                                (m.userId.length > 16 ? m.userId.slice(0, 8) : m.userId);
                            const badge = roleLabel(m.role, t);
                            return (_jsxs("div", { className: "tg-member-row", children: [_jsx(UserAvatar, { size: "md", name: name, username: m.user?.username, avatarUrl: m.user?.avatarUrl }), _jsxs("span", { className: "focus-contact-body", children: [_jsx("strong", { children: name }), _jsx("span", { className: m.online ? 'is-online' : 'muted', children: m.online ? t('online') : t('lastSeenRecently') })] }), badge ? _jsx("span", { className: `tg-role-badge ${m.role}`, children: badge }) : null, canManage && m.role !== 'owner' && m.userId !== meId ? (_jsx("button", { type: "button", className: "tg-kick", onClick: () => void kick(m.userId), children: "\u2715" })) : null] }, m.id));
                        })] }), _jsxs("div", { className: "tg-media-strip", children: [_jsx("span", { className: "tg-tab is-active", children: t('tabMedia') }), _jsx("p", { className: "muted tiny pad-inline", children: t('emptyTabContent') })] }), _jsx(FocusInviteSheet, { open: inviteOpen, onClose: () => setInviteOpen(false), url: inviteUrl, title: group.name })] }));
    }
    /* ——— Chat ——— */
    return (_jsxs("div", { className: "tg-channel-chat", children: [_jsx(FocusBackBar, { fallbackTo: "/focus/chats", title: group.name, subtitle: `${memberCount} ${t('members')}`, trailing: _jsx("button", { type: "button", className: "focus-header-avatar", onClick: () => setView('profile'), children: _jsx(UserAvatar, { size: "sm", name: group.name, avatarUrl: group.avatarUrl }) }) }), searchOpen ? (_jsxs("div", { className: "focus-search tg-search-bar", children: [_jsx(IconSearch, { size: 16 }), _jsx("input", { value: searchQ, onChange: (e) => setSearchQ(e.target.value), placeholder: t('search'), autoFocus: true }), _jsx("button", { type: "button", className: "focus-text-btn", onClick: () => setSearchOpen(false), children: t('cancel') })] })) : null, error ? _jsx(ErrorBanner, { message: error }) : null, _jsxs("div", { className: "tg-channel-msg-list tg-group-msg-list", children: [visibleMessages.length === 0 ? (_jsx("p", { className: "focus-empty-inline muted", children: t('noMessagesYet') })) : null, visibleMessages.map((m) => {
                        const mine = meId && m.senderId === meId;
                        return (_jsxs("div", { className: `tg-msg-row ${mine ? 'mine' : 'theirs'}`, children: [!mine ? (_jsx(UserAvatar, { size: "sm", name: m.sender?.displayName, username: m.sender?.username, avatarUrl: m.sender?.avatarUrl })) : (_jsx("span", { className: "tg-msg-spacer" })), _jsxs("div", { className: `tg-bubble ${mine ? 'mine' : ''}`, children: [!mine ? (_jsx("span", { className: "tg-sender", children: m.sender?.displayName || m.sender?.username || 'user' })) : null, _jsx("p", { dir: "auto", children: m.encryptedContent }), _jsx("span", { className: "tg-bubble-time", children: formatMsgTime(m.timestamp, locale) })] })] }, m.id));
                    })] }), _jsxs("form", { className: "tg-channel-composer", onSubmit: (e) => void send(e), children: [_jsx("input", { value: text, onChange: (e) => {
                            setText(e.target.value);
                            getRealtimeSocket()?.emit('group:typing', {
                                groupId,
                                isTyping: Boolean(e.target.value.trim())
                            });
                        }, placeholder: t('typeMessage'), dir: "auto" }), _jsx("button", { type: "submit", className: "icon-btn", disabled: !text.trim(), "aria-label": t('send'), children: _jsx(IconSend, { size: 20 }) })] })] }));
}
