import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAccount } from '@/api/accounts';
import { fetchRecommendationAdmin, rollbackRecommendation, saveRecommendationFeature } from '@/api/recommendations';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';
export function AdminRecommendationsPage() {
    const { t } = useI18n();
    const [allowed, setAllowed] = useState(null);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        void fetchAccount()
            .then((account) => setAllowed(account?.role === 'admin'))
            .catch(() => setAllowed(false));
    }, []);
    useEffect(() => {
        if (!allowed)
            return;
        void fetchRecommendationAdmin()
            .then(setData)
            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
    }, [allowed, t]);
    if (allowed === null)
        return _jsx(PageLoader, {});
    if (!allowed) {
        return (_jsxs("div", { className: "settings-page", children: [_jsx(ErrorBanner, { message: t('adminOnly') }), _jsx(Link, { className: "button button-ghost", to: "/settings", children: t('back') })] }));
    }
    const weights = data?.weights || {};
    return (_jsxs("div", { className: "settings-page", dir: "auto", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('recommendationAdmin') }), _jsx(Link, { to: "/settings", className: "button button-ghost button-compact", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, data ? (_jsxs("section", { className: "panel-block", children: [_jsxs("p", { children: [data.version, " \u00B7 ", data.trainedModel ? 'ML' : 'baseline'] }), _jsx("ul", { children: Object.entries(weights).map(([key, value]) => (_jsxs("li", { children: [key, ": ", String(value)] }, key))) }), _jsx("h2", { children: "Serve" }), _jsx("ul", { children: (data.serve || []).map((row) => (_jsxs("li", { children: [row.surface, ": ", row.requests, " \u00B7 ", row.avgMs, " ms"] }, row.surface))) }), _jsx("h2", { children: "Today" }), _jsx("ul", { children: (data.today || []).map((row) => (_jsxs("li", { children: [row.eventType, " ", row.outcome, row.reason ? ` (${row.reason})` : '', ": ", row.count] }, `${row.eventType}-${row.outcome}-${row.reason || ''}`))) }), _jsxs("p", { children: [t('analysisStatus'), ": ", JSON.stringify(data.analysis || {})] }), _jsxs("p", { children: [data.participantsToday ?? 0, " \u00B7 ", t('conversationSignalsOff')] }), _jsx("h2", { children: t('featureFlags') }), _jsx("ul", { children: (data.features || []).map((row) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "button button-ghost button-compact", onClick: () => void saveRecommendationFeature(row.key, !row.enabled, row.value)
                                    .then(() => fetchRecommendationAdmin().then(setData))
                                    .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: [row.key, ": ", row.enabled ? 'on' : 'off', " \u00B7 ", row.value] }) }, row.key))) }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => void rollbackRecommendation()
                            .then(() => fetchRecommendationAdmin().then(setData))
                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('rollbackBaseline') }), _jsx("p", { children: JSON.stringify(data.exclusions || {}) }), _jsx("p", { children: JSON.stringify(data.distribution || {}) })] })) : (_jsx(PageLoader, {}))] }));
}
