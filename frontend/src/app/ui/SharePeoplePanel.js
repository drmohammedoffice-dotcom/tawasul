import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { fetchFollowing, searchAll } from '@/api/social';
import { createShareLink, shareContentToDm } from '@/api/content';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { IconSend } from './Icons';
import { UserAvatar } from './UserAvatar';
import { useToast } from './Toast';
export function SharePeoplePanel({ targetType, targetId, onClose, onShared, className = '' }) {
    const { t } = useI18n();
    const { push } = useToast();
    const me = getSessionSnapshot()?.user?.id;
    const [q, setQ] = useState('');
    const [people, setPeople] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [busyId, setBusyId] = useState(null);
    const [sentIds, setSentIds] = useState(() => new Set());
    async function loadPeople(query) {
        try {
            if (!query.trim()) {
                const uname = getSessionSnapshot()?.user?.username;
                if (uname) {
                    const following = await fetchFollowing(uname);
                    const rows = (Array.isArray(following) ? following : []).map((f) => f.following || f.user || f);
                    setPeople(rows.filter((u) => u?.id && u.id !== me).slice(0, 40));
                    return;
                }
            }
            const res = await searchAll(query.trim());
            setPeople((res.users || []).filter((u) => u.id !== me).slice(0, 24));
        }
        catch {
            setPeople([]);
        }
    }
    useEffect(() => {
        void loadPeople('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetId]);
    useEffect(() => {
        const handle = window.setTimeout(() => void loadPeople(q), 280);
        return () => window.clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q]);
    async function sendTo(userId) {
        setBusyId(userId);
        try {
            const res = await shareContentToDm({ targetType, targetId, receiverIds: [userId] });
            setSentIds((prev) => new Set(prev).add(userId));
            setSelectedId(null);
            onShared?.(typeof res?.shareCount === 'number' ? res.shareCount : undefined);
            push(t('sharedToChat'), 'success');
        }
        catch (err) {
            push(err instanceof Error ? err.message : t('errorGeneric'), 'error');
        }
        finally {
            setBusyId(null);
        }
    }
    return (_jsxs("div", { className: `share-panel share-people-panel ${className}`.trim(), children: [_jsxs("div", { className: "reel-sheet-head", children: [_jsx("strong", { children: t('share') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: onClose, children: t('close') })] }), _jsx("button", { type: "button", className: "button", onClick: () => void createShareLink(targetType, targetId).then(({ url }) => navigator.clipboard.writeText(url).then(() => {
                    push(t('linkCopied'), 'success');
                    /* Copy must NOT count as a share — only DM send does */
                })), children: t('copyLink') }), _jsx("input", { className: "share-search-input", value: q, onChange: (e) => setQ(e.target.value), placeholder: t('searchPeopleHint'), dir: "auto" }), _jsx("ul", { className: "reel-share-people", children: people.map((u) => {
                    const selected = selectedId === u.id;
                    const sent = sentIds.has(u.id);
                    return (_jsxs("li", { className: `share-person-row ${selected ? 'is-selected' : ''} ${sent ? 'is-sent' : ''}`, children: [_jsxs("button", { type: "button", className: "reel-share-person", onClick: () => setSelectedId((cur) => (cur === u.id ? null : u.id)), children: [_jsx(UserAvatar, { size: "md", name: u.displayName || u.username, username: u.username, avatarUrl: u.avatarUrl }), _jsxs("span", { className: "share-person-meta", children: [_jsx("strong", { children: u.displayName || u.username }), _jsxs("span", { className: "muted", children: ["@", u.username] })] })] }), selected ? (_jsxs("div", { className: "share-row-actions", children: [_jsxs("button", { type: "button", className: "share-send-btn", disabled: busyId === u.id, onClick: () => void sendTo(u.id), children: [_jsx(IconSend, { size: 16 }), _jsx("span", { children: t('send') })] }), _jsx("button", { type: "button", className: "share-cancel-btn", onClick: () => setSelectedId(null), children: t('cancel') })] })) : sent ? (_jsx("span", { className: "share-sent-badge muted tiny", children: t('sent') })) : null] }, u.id));
                }) })] }));
}
