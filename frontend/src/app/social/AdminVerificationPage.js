import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminGetVerification, adminListVerifications, adminReviewVerification, fetchAccount } from '@/api/accounts';
import { useI18n } from '@/i18n/I18nProvider';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { useToast } from '../ui/Toast';
export function AdminVerificationPage() {
    const { t } = useI18n();
    const { push } = useToast();
    const [allowed, setAllowed] = useState(null);
    const [items, setItems] = useState([]);
    const [selected, setSelected] = useState(null);
    const [statusFilter, setStatusFilter] = useState('pending_review');
    const [note, setNote] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        void fetchAccount()
            .then((a) => setAllowed(a?.role === 'admin'))
            .catch(() => setAllowed(false));
    }, []);
    useEffect(() => {
        if (!allowed)
            return;
        setBusy(true);
        void adminListVerifications(statusFilter || undefined)
            .then(setItems)
            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
            .finally(() => setBusy(false));
    }, [allowed, statusFilter, t]);
    async function openDetail(id) {
        setBusy(true);
        setError('');
        try {
            setSelected(await adminGetVerification(id));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function review(status) {
        if (!selected)
            return;
        setBusy(true);
        try {
            await adminReviewVerification(selected.id, {
                status,
                ...(note.trim() ? { adminNote: note.trim() } : {})
            });
            push(t('reviewSaved'), 'success');
            setSelected(null);
            setNote('');
            setItems(await adminListVerifications(statusFilter || undefined));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    if (allowed === null)
        return _jsx(PageLoader, {});
    if (!allowed) {
        return (_jsxs("div", { children: [_jsx(ErrorBanner, { message: t('adminOnly') }), _jsx(Link, { className: "button button-ghost", to: "/settings", children: t('back') })] }));
    }
    return (_jsxs("div", { className: "settings-page", children: [_jsxs("div", { className: "page-header", children: [_jsx(Link, { className: "button button-ghost button-compact", to: "/settings", children: t('back') }), _jsx("h1", { children: t('adminVerification') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsx("div", { className: "inline-actions", children: ['pending_review', 'more_info_required', 'approved', 'rejected', ''].map((s) => (_jsx("button", { type: "button", className: `button button-compact ${statusFilter === s ? '' : 'button-ghost'}`, onClick: () => setStatusFilter(s), children: s || t('all') }, s || 'all'))) }), busy && !selected ? _jsx("p", { className: "muted", children: t('loading') }) : null, !busy && items.length === 0 ? _jsx(EmptyState, { title: t('emptyVerificationQueue') }) : null, _jsx("div", { className: "admin-verif-list", children: items.map((row) => (_jsxs("button", { type: "button", className: "list-row", onClick: () => void openDetail(row.id), children: [_jsxs("strong", { children: ["@", row.user?.username] }), _jsxs("span", { className: "muted", children: [row.track, " \u00B7 ", row.status, " \u00B7 ", row.businessName || row.applicantName || '—'] })] }, row.id))) }), selected ? (_jsxs("div", { className: "settings-card", children: [_jsxs("h2", { children: ["@", selected.user?.username, " \u2014 ", selected.status] }), _jsxs("p", { className: "muted", children: [selected.track, " \u00B7 ", selected.businessName || selected.applicantName || '—'] }), _jsxs("p", { className: "muted tiny", children: ["hashes: reg=", selected.hasRegistrationHash ? 'yes' : 'no', " id=", selected.hasIdentityHash ? 'yes' : 'no'] }), _jsx("div", { className: "doc-grid", children: (selected.documents || []).map((d) => (_jsxs("div", { className: "doc-card", children: [_jsx("strong", { children: d.docType }), d.secureUrl ? (_jsx("a", { href: d.secureUrl, target: "_blank", rel: "noopener noreferrer", children: t('viewDocument') })) : (_jsx("span", { className: "muted", children: t('mediaMissing') }))] }, d.id))) }), _jsx("textarea", { value: note, onChange: (e) => setNote(e.target.value), placeholder: t('adminNote'), rows: 3 }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: "button", disabled: busy, onClick: () => void review('approved'), children: t('approve') }), _jsx("button", { type: "button", className: "button button-ghost", disabled: busy, onClick: () => void review('more_info_required'), children: t('moreInfo') }), _jsx("button", { type: "button", className: "button button-ghost", disabled: busy, onClick: () => void review('rejected'), children: t('reject') }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => setSelected(null), children: t('close') })] })] })) : null] }));
}
