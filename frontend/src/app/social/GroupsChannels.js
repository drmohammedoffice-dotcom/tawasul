import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { addChannelSubscriber, addGroupMember, createChannel, createGroup, fetchChannel, fetchChannelMessages, fetchChannelSubscriptions, fetchGroup, fetchGroupMembers, fetchGroupMessages, fetchMyChannels, fetchMyGroups } from '@/api/social';
import { pinSpace } from '@/api/messagingExtras';
import { markChannelRead, markGroupRead } from '@/api/focus';
import { useI18n } from '@/i18n/I18nProvider';
import { clientRequestId, getRealtimeSocket } from '@/lib/realtime';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { UserPicker } from '../ui/UserPicker';
import { getSessionSnapshot } from '@/lib/sessionBridge';
function upsertMessage(list, msg) {
    if (!msg?.id)
        return list;
    if (list.some((m) => m.id === msg.id))
        return list;
    return [...list, msg];
}
export function GroupsPage() {
    const { t } = useI18n();
    const [items, setItems] = useState([]);
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    async function reload() {
        setLoading(true);
        try {
            setItems(await fetchMyGroups());
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
    async function onCreate(e) {
        e.preventDefault();
        if (!name.trim())
            return;
        setError('');
        try {
            await createGroup(name.trim());
            setName('');
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    if (loading)
        return _jsx(PageLoader, {});
    return (_jsxs("div", { children: [_jsx("div", { className: "page-header", children: _jsx("h1", { children: t('groups') }) }), _jsxs("form", { className: "create-form", onSubmit: (e) => void onCreate(e), children: [_jsx("input", { value: name, onChange: (e) => setName(e.target.value), placeholder: t('groupName'), minLength: 2 }), _jsx("button", { className: "button", type: "submit", children: t('createGroup') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, items.length === 0 ? _jsx(EmptyState, { title: t('emptyGroups') }) : null, items.map((g) => (_jsxs(Link, { className: "list-row card-link", to: `/focus/chats/group/${g.id}`, children: [_jsx("strong", { children: g.name }), _jsxs("span", { className: "muted", children: [g.myRole, " \u00B7 ", g._count?.members ?? 0, " ", t('members')] })] }, g.id)))] }));
}
export function GroupDetailPage() {
    const { t } = useI18n();
    const { groupId = '' } = useParams();
    const location = useLocation();
    const backTo = location.pathname.startsWith('/focus') ? '/focus/chats' : '/groups';
    const [group, setGroup] = useState(null);
    const [members, setMembers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [text, setText] = useState('');
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [showInfo, setShowInfo] = useState(false);
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
        void markGroupRead(groupId).catch(() => undefined);
    }, [groupId, messages.length]);
    useEffect(() => {
        if (!groupId)
            return;
        const socket = getRealtimeSocket();
        if (!socket)
            return;
        const onNew = (data) => {
            if (data?.groupId && data.groupId !== groupId)
                return;
            setMessages((prev) => upsertMessage(prev, data));
            void markGroupRead(groupId).catch(() => undefined);
        };
        const join = () => {
            socket.emit('group:join', { groupId }, (ack) => {
                if (ack && ack.success === false) {
                    setError(t('notMember'));
                }
            });
        };
        socket.on('group:message:new', onNew);
        if (socket.connected)
            join();
        socket.on('connect', join);
        return () => {
            socket.off('group:message:new', onNew);
            socket.off('connect', join);
            socket.emit('group:leave', { groupId });
        };
    }, [groupId, t]);
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
            if (ack?.data)
                setMessages((prev) => upsertMessage(prev, ack.data));
            if (ack && ack.success === false)
                setError(t('errorGeneric'));
        });
    }
    async function addMember(user) {
        setAdding(true);
        setError('');
        try {
            await addGroupMember(groupId, user.id);
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setAdding(false);
        }
    }
    if (loading)
        return _jsx(PageLoader, {});
    if (error && !group)
        return _jsx(ErrorBanner, { message: error });
    if (!group)
        return _jsx(EmptyState, { title: t('notMember') });
    const canManage = group.myRole === 'owner' || group.myRole === 'admin';
    const meId = getSessionSnapshot()?.user?.id;
    return (_jsxs("div", { className: "tg-chat-shell", children: [_jsxs("header", { className: "tg-chat-header", children: [_jsx(Link, { to: backTo, className: "focus-back-btn", "aria-label": "Back", children: "\u2190" }), _jsxs("button", { type: "button", className: "tg-chat-title", onClick: () => setShowInfo((v) => !v), children: [_jsx(UserAvatar, { size: "sm", name: group.name }), _jsxs("span", { children: [_jsx("strong", { children: group.name }), _jsxs("span", { className: "muted tiny", children: [members.length, " ", t('members')] })] })] }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => void pinSpace('group', groupId)
                                    .then(() => undefined)
                                    .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('pinSpace') }), canManage ? (_jsx("button", { type: "button", className: "button button-compact", onClick: () => {
                                    const socket = getRealtimeSocket();
                                    socket?.emit('call:invite', { scope: 'group', spaceId: groupId, kind: 'audio' });
                                }, children: t('startGroupCall') })) : null] })] }), error ? _jsx(ErrorBanner, { message: error }) : null, showInfo ? (_jsxs("section", { className: "tg-chat-info panel-block", children: [members.map((m) => (_jsx("div", { className: "list-row", children: _jsxs(Link, { to: `/u/${m.user?.username}`, className: "tg-member-row", children: [_jsx(UserAvatar, { size: "sm", name: m.user?.displayName, username: m.user?.username, avatarUrl: m.user?.avatarUrl }), "@", m.user?.username] }) }, m.id))), canManage ? (_jsxs("div", { className: "panel-block", children: [_jsx("h3", { children: t('addMember') }), _jsx(UserPicker, { disabled: adding, onPick: (u) => void addMember(u) })] })) : null] })) : null, _jsx("div", { className: "tg-msg-list", children: messages.map((m) => {
                    const mine = meId && m.senderId === meId;
                    return (_jsxs("div", { className: `tg-msg-row ${mine ? 'mine' : 'theirs'}`, children: [!mine ? (_jsx(UserAvatar, { size: "sm", name: m.sender?.displayName, username: m.sender?.username, avatarUrl: m.sender?.avatarUrl })) : (_jsx("span", { className: "tg-msg-spacer" })), _jsxs("div", { className: "tg-bubble", children: [!mine ? _jsxs("span", { className: "tg-sender", children: ["@", m.sender?.username || 'user'] }) : null, _jsx("p", { dir: "auto", children: m.encryptedContent })] })] }, m.id));
                }) }), _jsxs("form", { className: "tg-composer comment-form", onSubmit: (e) => void send(e), children: [_jsx("input", { value: text, onChange: (e) => {
                            setText(e.target.value);
                            const socket = getRealtimeSocket();
                            socket?.emit('group:typing', { groupId, isTyping: Boolean(e.target.value.trim()) });
                        }, placeholder: t('typeMessage'), dir: "auto", enterKeyHint: "send" }), _jsx("button", { className: "button", type: "submit", disabled: !text.trim(), children: t('send') })] })] }));
}
export function ChannelsPage() {
    const { t } = useI18n();
    const [items, setItems] = useState([]);
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    async function reload() {
        setLoading(true);
        try {
            setItems(await fetchMyChannels());
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
    async function onCreate(e) {
        e.preventDefault();
        if (!name.trim())
            return;
        try {
            await createChannel(name.trim());
            setName('');
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    if (loading)
        return _jsx(PageLoader, {});
    return (_jsxs("div", { children: [_jsx("div", { className: "page-header", children: _jsx("h1", { children: t('channels') }) }), _jsxs("form", { className: "create-form", onSubmit: (e) => void onCreate(e), children: [_jsx("input", { value: name, onChange: (e) => setName(e.target.value), placeholder: t('channelName'), minLength: 2 }), _jsx("button", { className: "button", type: "submit", children: t('createChannel') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, items.length === 0 ? _jsx(EmptyState, { title: t('emptyChannels') }) : null, items.map((c) => (_jsxs(Link, { className: "list-row card-link", to: `/focus/chats/channel/${c.id}`, children: [_jsx("strong", { children: c.name }), _jsxs("span", { className: "muted", children: [c.myRole, " \u00B7 ", c._count?.subscriptions ?? 0, " ", t('subscribers')] })] }, c.id)))] }));
}
export function ChannelDetailPage() {
    const { t } = useI18n();
    const { channelId = '' } = useParams();
    const [channel, setChannel] = useState(null);
    const [subs, setSubs] = useState([]);
    const [messages, setMessages] = useState([]);
    const [text, setText] = useState('');
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    async function reload() {
        setLoading(true);
        setError('');
        try {
            const ch = await fetchChannel(channelId);
            setChannel(ch);
            const msgs = await fetchChannelMessages(channelId);
            setMessages(msgs);
            if (ch.myRole === 'owner' || ch.myRole === 'admin') {
                setSubs(await fetchChannelSubscriptions(channelId));
            }
            else {
                setSubs([]);
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
    }, [channelId]);
    useEffect(() => {
        if (!channelId)
            return;
        void markChannelRead(channelId).catch(() => undefined);
    }, [channelId, messages.length]);
    useEffect(() => {
        if (!channelId)
            return;
        const socket = getRealtimeSocket();
        if (!socket)
            return;
        const onNew = (data) => {
            if (data?.channelId && data.channelId !== channelId)
                return;
            setMessages((prev) => upsertMessage(prev, data));
            void markChannelRead(channelId).catch(() => undefined);
        };
        const join = () => {
            socket.emit('channel:join', { channelId }, (ack) => {
                if (ack && ack.success === false)
                    setError(t('notMember'));
            });
        };
        socket.on('channel:message:new', onNew);
        if (socket.connected)
            join();
        socket.on('connect', join);
        return () => {
            socket.off('channel:message:new', onNew);
            socket.off('connect', join);
            socket.emit('channel:leave', { channelId });
        };
    }, [channelId, t]);
    const canPost = channel?.myRole === 'owner' || channel?.myRole === 'admin';
    function send(e) {
        e.preventDefault();
        if (!text.trim() || !canPost)
            return;
        const socket = getRealtimeSocket();
        if (!socket) {
            setError(t('errorGeneric'));
            return;
        }
        const content = text.trim();
        setText('');
        socket.emit('channel:message:send', { channelId, encryptedContent: content, clientRequestId: clientRequestId('c') }, (ack) => {
            if (ack?.data)
                setMessages((prev) => upsertMessage(prev, ack.data));
            if (ack && (ack.success === false || ack.message?.includes?.('Forbidden'))) {
                setError(t('onlyAdminsPost'));
            }
        });
    }
    async function addSub(user) {
        setAdding(true);
        setError('');
        try {
            await addChannelSubscriber(channelId, user.id);
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setAdding(false);
        }
    }
    if (loading)
        return _jsx(PageLoader, {});
    if (error && !channel)
        return _jsx(ErrorBanner, { message: error });
    if (!channel)
        return _jsx(EmptyState, { title: t('notMember') });
    const meId = getSessionSnapshot()?.user?.id;
    return (_jsxs("div", { className: "tg-chat-shell", children: [_jsxs("header", { className: "tg-chat-header", children: [_jsx(Link, { to: "/channels", className: "button button-ghost button-compact", children: "\u2190" }), _jsxs("div", { className: "tg-chat-title", children: [_jsx(UserAvatar, { size: "sm", name: channel.name }), _jsxs("span", { children: [_jsx("strong", { children: channel.name }), _jsx("span", { className: "muted tiny", children: t('channels') })] })] })] }), error ? _jsx(ErrorBanner, { message: error }) : null, canPost ? (_jsxs("section", { className: "tg-chat-info panel-block", children: [_jsx("h2", { children: t('subscribers') }), subs.map((s) => (_jsx("div", { className: "list-row", children: _jsxs(Link, { to: `/u/${s.user?.username}`, className: "tg-member-row", children: [_jsx(UserAvatar, { size: "sm", name: s.user?.displayName, username: s.user?.username, avatarUrl: s.user?.avatarUrl }), "@", s.user?.username || s.userId] }) }, s.id))), _jsx(UserPicker, { disabled: adding, onPick: (u) => void addSub(u) })] })) : null, _jsx("div", { className: "tg-msg-list", children: messages.map((m) => {
                    const mine = meId && m.senderId === meId;
                    return (_jsxs("div", { className: `tg-msg-row ${mine ? 'mine' : 'theirs'}`, children: [!mine ? (_jsx(UserAvatar, { size: "sm", name: m.sender?.displayName, username: m.sender?.username, avatarUrl: m.sender?.avatarUrl })) : (_jsx("span", { className: "tg-msg-spacer" })), _jsxs("div", { className: "tg-bubble", children: [!mine ? _jsxs("span", { className: "tg-sender", children: ["@", m.sender?.username || 'user'] }) : null, _jsx("p", { dir: "auto", children: m.encryptedContent })] })] }, m.id));
                }) }), canPost ? (_jsxs("form", { className: "tg-composer comment-form", onSubmit: (e) => void send(e), children: [_jsx("input", { value: text, onChange: (e) => setText(e.target.value), placeholder: t('typeMessage'), dir: "auto", enterKeyHint: "send" }), _jsx("button", { className: "button", type: "submit", disabled: !text.trim(), children: t('send') })] })) : (_jsx("p", { className: "muted pad-inline", children: t('onlyAdminsPost') }))] }));
}
