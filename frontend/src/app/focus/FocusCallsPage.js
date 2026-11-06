import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchCallHistory } from '@/api/focus';
import { startDmCallRest } from '@/api/messagingExtras';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { IconPhone, IconVideo } from '../ui/Icons';
export function FocusCallsPage() {
    const { t, locale } = useI18n();
    const navigate = useNavigate();
    const [filter, setFilter] = useState('all');
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        void fetchCallHistory(filter)
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
        return () => {
            cancelled = true;
        };
    }, [filter, t]);
    async function recall(item) {
        if (item.scope === 'dm' && item.peer?.id) {
            try {
                await startDmCallRest(item.peer.id, item.kind);
                navigate(`/focus/chats/dm/${item.peer.id}`);
            }
            catch (err) {
                setError(err instanceof Error ? err.message : t('errorGeneric'));
            }
        }
    }
    return (_jsxs("div", { className: "focus-calls", children: [_jsxs("div", { className: "focus-chats-header", children: [_jsx("button", { type: "button", className: "focus-back-btn compact", onClick: () => navigate('/focus/chats'), children: "\u2190" }), _jsx("h1", { children: t('focusCalls') }), _jsx("span", {})] }), _jsxs("div", { className: "focus-segmented", role: "tablist", children: [_jsx("button", { type: "button", role: "tab", "aria-selected": filter === 'all', className: filter === 'all' ? 'is-active' : '', onClick: () => setFilter('all'), children: t('callsAll') }), _jsx("button", { type: "button", role: "tab", "aria-selected": filter === 'missed', className: filter === 'missed' ? 'is-active' : '', onClick: () => setFilter('missed'), children: t('callsMissed') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, loading ? _jsx(PageLoader, {}) : null, !loading && items.length === 0 ? (_jsxs("div", { className: "focus-calls-empty", children: [_jsx("p", { className: "focus-empty-inline muted", children: t('emptyCalls') }), _jsx("p", { className: "muted center", children: t('emptyCallsHint') }), _jsxs("button", { type: "button", className: "focus-link-btn", onClick: () => setPickerOpen(true), children: [_jsx(IconPhone, { size: 18 }), " ", t('startNewCall')] })] })) : null, _jsx("ul", { className: "focus-call-list", children: items.map((item) => {
                    const title = item.peer?.displayName ||
                        item.peer?.username ||
                        item.spaceName ||
                        t('unknown');
                    const when = new Date(item.createdAt).toLocaleString(locale === 'ar' ? 'ar' : 'en', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                    });
                    return (_jsx("li", { children: _jsxs("button", { type: "button", className: "focus-call-row", onClick: () => void recall(item), children: [_jsx(UserAvatar, { size: "md", name: title, username: item.peer?.username || title, avatarUrl: item.peer?.avatarUrl }), _jsxs("span", { className: "focus-call-body", children: [_jsx("strong", { className: item.missed ? 'is-missed' : '', children: title }), _jsxs("span", { className: "muted", children: [item.kind === 'video' ? _jsx(IconVideo, { size: 14 }) : _jsx(IconPhone, { size: 14 }), ' ', item.direction === 'outgoing' ? t('outgoingCall') : t('incomingCall'), item.missed ? ` · ${t('missedCall')}` : '', " \u00B7 ", when] })] })] }) }, item.id));
                }) }), pickerOpen ? (_jsx("div", { className: "focus-modal-backdrop", onClick: () => setPickerOpen(false), children: _jsxs("div", { className: "focus-modal", onClick: (e) => e.stopPropagation(), children: [_jsx("h2", { children: t('startNewCall') }), _jsx("p", { className: "muted", children: t('startCallHint') }), _jsx(Link, { className: "button", to: "/focus/contacts", onClick: () => setPickerOpen(false), children: t('focusContacts') }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => setPickerOpen(false), children: t('cancel') })] }) })) : null] }));
}
