import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchFocusContacts, matchPhoneContacts } from '@/api/focus';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { IconPhone, IconSearch, IconUserPlus } from '../ui/Icons';
import { FocusInviteSheet } from './FocusInviteSheet';
async function sha256Hex(value) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function tryLoadDeviceContactHashes() {
    try {
        const cap = window.Capacitor;
        if (!cap?.isNativePlatform?.())
            return [];
        const Contacts = cap.Plugins?.Contacts;
        if (!Contacts?.getContacts)
            return [];
        const result = await Contacts.getContacts({
            projection: { phones: true }
        });
        const phones = [];
        for (const c of result?.contacts || []) {
            for (const p of c.phones || []) {
                const raw = String(p.number || '').replace(/[^\d+]/g, '');
                if (raw.length >= 8)
                    phones.push(raw);
            }
        }
        const unique = [...new Set(phones)];
        return Promise.all(unique.map((p) => sha256Hex(p)));
    }
    catch {
        return [];
    }
}
export function FocusContactsPage() {
    const { t } = useI18n();
    const { session } = useAuth();
    const navigate = useNavigate();
    const [q, setQ] = useState('');
    const [items, setItems] = useState([]);
    const [phoneMatches, setPhoneMatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [inviteOpen, setInviteOpen] = useState(false);
    const inviteUrl = `${window.location.origin}/register?ref=${encodeURIComponent(session?.user?.username || '')}`;
    useEffect(() => {
        let cancelled = false;
        const handle = window.setTimeout(() => {
            setLoading(true);
            void fetchFocusContacts(q)
                .then((rows) => {
                if (!cancelled)
                    setItems(rows);
            })
                .catch((err) => {
                if (!cancelled)
                    setError(err instanceof Error ? err.message : t('errorGeneric'));
            })
                .finally(() => {
                if (!cancelled)
                    setLoading(false);
            });
        }, q ? 250 : 0);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [q, t]);
    async function syncPhone() {
        setSyncing(true);
        setError('');
        try {
            const hashes = await tryLoadDeviceContactHashes();
            if (!hashes.length) {
                setError(t('phoneSyncUnavailable'));
                return;
            }
            const matched = await matchPhoneContacts(hashes);
            setPhoneMatches(matched);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setSyncing(false);
        }
    }
    const merged = [...phoneMatches, ...items].filter((row, idx, arr) => arr.findIndex((r) => r.id === row.id) === idx);
    function statusLine(c) {
        if (c.online)
            return t('online');
        if (c.source === 'phone')
            return t('fromPhoneContacts');
        return t('tapToMessage');
    }
    return (_jsxs("div", { className: "focus-contacts", children: [_jsxs("div", { className: "focus-chats-header", children: [_jsx("button", { type: "button", className: "focus-back-btn compact", onClick: () => navigate('/focus/chats'), children: "\u2190" }), _jsx("h1", { children: t('focusContacts') }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": t('inviteFriends'), onClick: () => setInviteOpen(true), children: _jsx(IconUserPlus, { size: 20 }) })] }), _jsxs("div", { className: "focus-search", children: [_jsx(IconSearch, { size: 16 }), _jsx("input", { value: q, onChange: (e) => setQ(e.target.value), placeholder: t('search'), "aria-label": t('search') })] }), _jsxs("button", { type: "button", className: "focus-invite-row", onClick: () => setInviteOpen(true), children: [_jsx(IconUserPlus, { size: 20 }), _jsx("span", { children: t('inviteFriends') })] }), _jsxs("button", { type: "button", className: "focus-invite-row secondary", disabled: syncing, onClick: () => void syncPhone(), children: [_jsx(IconPhone, { size: 20 }), _jsx("span", { children: syncing ? t('syncingPhone') : t('syncPhoneContacts') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, loading ? _jsx(PageLoader, {}) : null, !loading && merged.length === 0 ? (_jsx("p", { className: "focus-empty-inline muted", children: t('emptyContacts') })) : null, _jsx("ul", { className: "focus-contact-list", children: merged.map((c) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "focus-contact-row", onClick: () => navigate(`/focus/chats/dm/${c.id}`, {
                            state: {
                                peer: {
                                    id: c.id,
                                    username: c.username,
                                    displayName: c.displayName,
                                    avatarUrl: c.avatarUrl
                                }
                            }
                        }), children: [_jsx(UserAvatar, { size: "md", name: c.displayName || c.username, username: c.username, avatarUrl: c.avatarUrl }), _jsxs("span", { className: "focus-contact-body", children: [_jsx("strong", { children: c.displayName || c.username }), _jsx("span", { className: c.online ? 'is-online' : 'muted', children: statusLine(c) })] })] }) }, c.id))) }), _jsx(FocusInviteSheet, { open: inviteOpen, onClose: () => setInviteOpen(false), url: inviteUrl, shareText: t('inviteFriendsShare') })] }));
}
