import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useI18n } from '@/i18n/I18nProvider';
export function SkeletonFeed({ count = 3 }) {
    return (_jsx("div", { className: "skeleton-stack", "aria-hidden": true, children: Array.from({ length: count }).map((_, i) => (_jsxs("div", { className: "skeleton-card", children: [_jsxs("div", { className: "skeleton-row", children: [_jsx("div", { className: "skeleton-avatar shimmer" }), _jsxs("div", { className: "skeleton-lines", children: [_jsx("div", { className: "skeleton-line shimmer" }), _jsx("div", { className: "skeleton-line short shimmer" })] })] }), _jsx("div", { className: "skeleton-media shimmer" }), _jsx("div", { className: "skeleton-line shimmer" })] }, i))) }));
}
export function EmptyState({ title, description, action }) {
    return (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-visual", "aria-hidden": true }), _jsx("h2", { children: title }), description ? _jsx("p", { className: "muted", children: description }) : null, action ? _jsx("div", { className: "empty-state-action", children: action }) : null] }));
}
export function ErrorBanner({ message, onRetry }) {
    const { t } = useI18n();
    return (_jsxs("div", { className: "error-banner", role: "alert", children: [_jsx("p", { children: message }), onRetry ? (_jsx("button", { className: "button button-compact", type: "button", onClick: onRetry, children: t('retry') })) : null] }));
}
export function PageLoader() {
    const { t } = useI18n();
    return (_jsxs("div", { className: "page-loader", role: "status", "aria-live": "polite", children: [_jsx("div", { className: "spinner" }), _jsx("span", { className: "muted", children: t('loading') })] }));
}
