import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchNotifications } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { formatDateDMY } from '@/lib/formatDate';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
export { CreatePostPage } from './CreateStudio';
export function NotificationsPage() {
    const { t } = useI18n();
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        void fetchNotifications()
            .then(setItems)
            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
            .finally(() => setLoading(false));
    }, [t]);
    if (loading)
        return _jsx(PageLoader, {});
    if (error)
        return _jsx(ErrorBanner, { message: error });
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsxs("button", { type: "button", className: "button button-ghost button-compact", onClick: () => {
                            if (window.history.length > 1)
                                navigate(-1);
                            else
                                navigate('/feed');
                        }, children: ["\u2190 ", t('back')] }), _jsx("h1", { children: t('alerts') }), _jsx("span", {})] }), items.length === 0 ? _jsx(EmptyState, { title: t('emptyNotifications') }) : null, items.map((n) => (_jsx("article", { className: "post-card notification-card", children: _jsx("header", { className: "post-header", children: _jsxs("div", { className: "post-author", children: [_jsx("span", { className: "avatar-circle sm", children: (n.actor?.username || 'S').slice(0, 1).toUpperCase() }), _jsxs("span", { className: "post-author-text", children: [_jsx("strong", { children: n.type?.replace(/_/g, ' ') || t('alerts') }), _jsxs("span", { className: "muted", children: [n.actor?.username ? (_jsxs(Link, { to: `/u/${n.actor.username}`, children: ["@", n.actor.username] })) : ('system'), n.createdAt ? ` · ${formatDateDMY(n.createdAt)}` : ''] })] })] }) }) }, n.id)))] }));
}
export { AccountHubPage as SettingsPage } from './AccountSettingsPages';
