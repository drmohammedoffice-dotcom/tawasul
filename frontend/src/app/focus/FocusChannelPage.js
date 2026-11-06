import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchChannel, fetchChannelInvite, fetchChannelMessages, leaveChannel, pinChannelMessage } from '@/api/social';
import { fetchUnifiedInbox, setChatMute } from '@/api/focus';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { getRealtimeSocket } from '@/lib/realtime';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { IconBell, IconChat, IconEye, IconMegaphone, IconMore, IconMute, IconSearch, IconSend } from '../ui/Icons';
import { FocusBackBar } from './FocusBackBar';
import { FocusInviteSheet } from './FocusInviteSheet';
import { FocusSpacePhoto } from './FocusSpacePhoto';
function extractLinks(text) {
    const re = /https?:\/\/[^\s<>"']+/gi;
    return text.match(re) || [];
}
function formatViews(n, locale) {
    try {
        return new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', {
            notation: n >= 1000 ? 'compact' : 'standard',
            maximumFractionDigits: 1
        }).format(n);
    }
    catch {
        return String(n);
    }
}
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
function formatFullDate(iso, locale) {
    try {
        return new Date(iso).toLocaleString(locale === 'ar' ? 'ar' : 'en', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }
    catch {
        return '';
    }
}
export function FocusChannelPage() {
    const { t, locale } = useI18n();
    const { session } = useAuth();
    const navigate = useNavigate();
    const { channelId = '' } = useParams();
    const [channel, setChannel] = useState(null);
    const [messages, setMessages] = useState([]);
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [view, setView] = useState('chat');
    const [tab, setTab] = useState('media');
    const [muted, setMuted] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteUrl, setInviteUrl] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQ, setSearchQ] = useState('');
    const canPost = channel?.myRole === 'owner' || channel?.myRole === 'admin';
    const subscriberCount = channel?._count?.subscriptions ?? 0;
    async function reload() {
        setLoading(true);
        setError('');
        try {
            const ch = await fetchChannel(channelId);
            setChannel(ch);
            const msgs = (await fetchChannelMessages(channelId));
            setMessages(msgs);
            try {
                const inbox = await fetchUnifiedInbox(80, 'focus');
                const row = inbox.find((i) => i.type === 'channel' && i.id === channelId);
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
    }, [channelId]);
    useEffect(() => {
        if (!channelId)
            return;
        const socket = getRealtimeSocket();
        if (!socket)
            return;
        const onNew = (data) => {
            if (data?.channelId && data.channelId !== channelId)
                return;
            setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
        };
        const join = () => {
            socket.emit('channel:join', { channelId });
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
    }, [channelId]);
    const pinned = useMemo(() => {
        if (!channel?.pinnedMessageId)
            return null;
        return messages.find((m) => m.id === channel.pinnedMessageId) || null;
    }, [channel?.pinnedMessageId, messages]);
    const visibleMessages = useMemo(() => {
        const needle = searchQ.trim().toLowerCase();
        if (!needle)
            return messages;
        return messages.filter((m) => m.encryptedContent.toLowerCase().includes(needle));
    }, [messages, searchQ]);
    const linkItems = useMemo(() => {
        const out = [];
        for (const m of messages) {
            for (const url of extractLinks(m.encryptedContent)) {
                out.push({
                    id: `${m.id}:${url}`,
                    url,
                    snippet: m.encryptedContent.slice(0, 160),
                    at: m.timestamp
                });
            }
        }
        return out;
    }, [messages]);
    async function openInvite() {
        try {
            const inv = await fetchChannelInvite(channelId);
            const url = `${window.location.origin}/focus/join/${inv.inviteSlug}`;
            setInviteUrl(url);
            setInviteOpen(true);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function toggleMute() {
        try {
            await setChatMute('channel', channelId, !muted);
            setMuted((v) => !v);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function onLeave() {
        setMoreOpen(false);
        try {
            await leaveChannel(channelId);
            navigate('/focus/chats', { replace: true });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
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
        socket.emit('channel:message:send', { channelId, encryptedContent: content }, (ack) => {
            if (ack?.data) {
                setMessages((prev) => prev.some((m) => m.id === ack.data.id) ? prev : [...prev, ack.data]);
            }
            if (ack && ack.success === false) {
                setError(ack.message || t('onlyAdminsPost'));
            }
        });
    }
    async function pinMsg(messageId) {
        try {
            await pinChannelMessage(channelId, messageId);
            setChannel((prev) => (prev ? { ...prev, pinnedMessageId: messageId } : prev));
            setMoreOpen(false);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    if (loading && !channel)
        return _jsx(PageLoader, {});
    if (error && !channel)
        return _jsx(ErrorBanner, { message: error });
    if (!channel)
        return _jsx(EmptyState, { title: t('notMember') });
    const tabs = [
        { key: 'media', label: t('tabMedia') },
        { key: 'links', label: t('tabLinks') }
    ];
    if (view === 'profile') {
        return (_jsxs("div", { className: "tg-channel-profile", children: [_jsx(FocusBackBar, { fallbackTo: `/focus/chats/channel/${channelId}`, onBack: () => setView('chat') }), _jsxs("div", { className: "tg-profile-hero", children: [_jsx(FocusSpacePhoto, { kind: "channel", spaceId: channelId, name: channel.name, avatarUrl: channel.avatarUrl, canEdit: canPost, onUpdated: (url) => setChannel((prev) => ({ ...prev, avatarUrl: url })) }), _jsx("h1", { children: channel.name }), _jsxs("p", { className: "muted", children: [subscriberCount.toLocaleString(locale === 'ar' ? 'ar' : 'en'), " ", t('subscribers')] })] }), _jsxs("div", { className: "tg-action-row", children: [_jsxs("button", { type: "button", className: "tg-action-btn", onClick: () => setView('chat'), children: [_jsx(IconChat, { size: 20 }), _jsx("span", { children: t('messageAction') })] }), _jsxs("button", { type: "button", className: "tg-action-btn", onClick: () => void toggleMute(), children: [muted ? _jsx(IconBell, { size: 20 }) : _jsx(IconMute, { size: 20 }), _jsx("span", { children: muted ? t('unmute') : t('mute') })] }), _jsxs("button", { type: "button", className: "tg-action-btn", onClick: () => {
                                setSearchOpen(true);
                                setView('chat');
                            }, children: [_jsx(IconSearch, { size: 20 }), _jsx("span", { children: t('search') })] }), _jsxs("button", { type: "button", className: "tg-action-btn", onClick: () => setMoreOpen(true), children: [_jsx(IconMore, { size: 20 }), _jsx("span", { children: t('more') })] })] }), moreOpen ? (_jsx("div", { className: "focus-sheet-backdrop", onClick: () => setMoreOpen(false), children: _jsxs("div", { className: "focus-sheet", onClick: (e) => e.stopPropagation(), children: [_jsx("div", { className: "focus-sheet-handle" }), _jsx("button", { type: "button", className: "button", onClick: () => {
                                    setMoreOpen(false);
                                    void openInvite();
                                }, children: t('shareInviteLink') }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => {
                                    setMoreOpen(false);
                                    void toggleMute();
                                }, children: muted ? t('unmute') : t('mute') }), _jsx("button", { type: "button", className: "button button-ghost", style: { color: '#ff453a' }, onClick: () => void onLeave(), children: t('leaveChannel') }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => setMoreOpen(false), children: t('close') })] }) })) : null, _jsxs("section", { className: "tg-info-card", children: [_jsx("div", { className: "tg-info-row", children: _jsxs("div", { children: [_jsx("span", { className: "tg-info-label", children: t('shareInviteLink') }), _jsx("button", { type: "button", className: "tg-info-link", onClick: () => void openInvite(), children: inviteUrl || t('tapToGetInviteLink') })] }) }), _jsx("div", { className: "tg-info-row", children: _jsxs("div", { children: [_jsx("span", { className: "tg-info-label", children: t('description') }), _jsx("p", { className: "tg-info-desc", dir: "auto", children: channel.description || t('noDescription') })] }) })] }), _jsx("div", { className: "tg-tabs", role: "tablist", children: tabs.map((item) => (_jsx("button", { type: "button", role: "tab", "aria-selected": tab === item.key, className: `tg-tab${tab === item.key ? ' is-active' : ''}`, onClick: () => setTab(item.key), children: item.label }, item.key))) }), _jsx("div", { className: "tg-tab-panel", children: tab === 'links' ? (linkItems.length ? (_jsx("ul", { className: "tg-link-list", children: linkItems.map((item) => (_jsx("li", { children: _jsxs("a", { href: item.url, target: "_blank", rel: "noreferrer", className: "tg-link-row", children: [_jsx("span", { className: "tg-link-icon", children: "\uD83D\uDD17" }), _jsxs("span", { children: [_jsx("strong", { className: "ellipsis", children: item.url }), _jsx("span", { className: "muted tiny ellipsis", children: item.snippet }), _jsx("span", { className: "muted tiny", children: formatFullDate(item.at, locale) })] })] }) }, item.id))) })) : (_jsx("p", { className: "focus-empty-inline muted", children: t('emptyTabContent') }))) : (_jsx("p", { className: "focus-empty-inline muted", children: t('emptyTabContent') })) }), _jsx(FocusInviteSheet, { open: inviteOpen, onClose: () => setInviteOpen(false), url: inviteUrl, title: channel.name, shareText: `${t('inviteFriendsShare')}: ${channel.name}` })] }));
    }
    return (_jsxs("div", { className: "tg-channel-chat", children: [_jsx("header", { className: "tg-channel-chat-header", children: _jsx(FocusBackBar, { fallbackTo: "/focus/chats", title: channel.name, subtitle: `${subscriberCount.toLocaleString(locale === 'ar' ? 'ar' : 'en')} ${t('subscribers')}`, trailing: _jsx("button", { type: "button", className: "focus-header-avatar", onClick: () => setView('profile'), children: _jsx(UserAvatar, { size: "sm", name: channel.name, avatarUrl: channel.avatarUrl }) }) }) }), pinned ? (_jsxs("button", { type: "button", className: "tg-pinned-bar", onClick: () => setView('profile'), children: [_jsx(IconMegaphone, { size: 16 }), _jsxs("span", { className: "ellipsis", children: [_jsx("strong", { children: t('pinnedMessage') }), " ", pinned.encryptedContent.slice(0, 80)] })] })) : null, searchOpen ? (_jsxs("div", { className: "focus-search tg-search-bar", children: [_jsx(IconSearch, { size: 16 }), _jsx("input", { value: searchQ, onChange: (e) => setSearchQ(e.target.value), placeholder: t('search'), autoFocus: true }), _jsx("button", { type: "button", className: "focus-text-btn", onClick: () => setSearchOpen(false), children: t('cancel') })] })) : null, error ? _jsx(ErrorBanner, { message: error }) : null, _jsxs("div", { className: "tg-channel-msg-list", children: [visibleMessages.length === 0 ? (_jsx("p", { className: "focus-empty-inline muted", children: t('noMessagesYet') })) : null, visibleMessages.map((m) => {
                        const links = extractLinks(m.encryptedContent);
                        return (_jsxs("article", { className: "tg-channel-bubble", children: [_jsx("p", { dir: "auto", children: m.encryptedContent }), links.map((url) => (_jsx("a", { href: url, className: "tg-inline-link", target: "_blank", rel: "noreferrer", children: url }, url))), _jsxs("footer", { className: "tg-bubble-meta", children: [_jsxs("span", { className: "tg-views", children: [_jsx(IconEye, { size: 12 }), " ", formatViews(m.viewCount ?? 0, locale)] }), m.sender?.displayName || m.sender?.username ? (_jsx("span", { className: "tg-poster", children: m.sender.displayName || m.sender.username })) : null, _jsx("span", { children: formatMsgTime(m.timestamp, locale) }), m.editedAt ? _jsx("span", { children: t('edited') }) : null, canPost ? (_jsx("button", { type: "button", className: "tg-pin-mini", onClick: () => void pinMsg(m.id), children: t('pin') })) : null] })] }, m.id));
                    })] }), canPost ? (_jsxs("form", { className: "tg-channel-composer", onSubmit: (e) => void send(e), children: [_jsx("input", { value: text, onChange: (e) => setText(e.target.value), placeholder: t('typeMessage'), dir: "auto" }), _jsx("button", { type: "submit", className: "icon-btn", disabled: !text.trim(), "aria-label": t('send'), children: _jsx(IconSend, { size: 20 }) })] })) : (_jsxs("div", { className: "tg-channel-subscriber-bar", children: [_jsx("button", { type: "button", className: "icon-btn", onClick: () => setView('profile'), "aria-label": t('more'), children: _jsx(IconChat, { size: 20 }) }), _jsx("button", { type: "button", className: "button tg-unmute-wide", onClick: () => void toggleMute(), children: muted ? t('unmute') : t('mute') }), _jsx("button", { type: "button", className: "icon-btn", onClick: () => setSearchOpen(true), "aria-label": t('search'), children: _jsx(IconSearch, { size: 20 }) })] })), _jsx(FocusInviteSheet, { open: inviteOpen, onClose: () => setInviteOpen(false), url: inviteUrl, title: channel.name })] }));
}
export function FocusJoinChannelPage() {
    const { t } = useI18n();
    const { inviteSlug = '' } = useParams();
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(true);
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const { joinChannelByInvite } = await import('@/api/social');
                const sub = (await joinChannelByInvite(inviteSlug));
                if (cancelled)
                    return;
                // join returns subscription; fetch channel id via invite slug path — API returns sub with channelId ideally
                const channelId = sub?.channelId;
                if (channelId)
                    navigate(`/focus/chats/channel/${channelId}`, { replace: true });
                else
                    navigate('/focus/chats', { replace: true });
            }
            catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : t('errorGeneric'));
                    setBusy(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [inviteSlug, navigate, t]);
    return (_jsxs("div", { className: "focus-wizard", children: [_jsx(FocusBackBar, { title: t('joinChannel'), fallbackTo: "/focus/chats" }), busy ? _jsx(PageLoader, {}) : null, error ? (_jsxs(_Fragment, { children: [_jsx(ErrorBanner, { message: error }), _jsx(Link, { to: "/focus/chats", className: "button", children: t('focusChats') })] })) : null] }));
}
