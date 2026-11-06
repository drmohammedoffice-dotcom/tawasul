import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n/I18nProvider';
export function FocusSettingsHeader({ title }) {
    const navigate = useNavigate();
    const { t } = useI18n();
    return (_jsxs("div", { className: "focus-chats-header", children: [_jsx("button", { type: "button", className: "focus-back-btn compact", "aria-label": t('back'), onClick: () => navigate('/focus/settings'), children: "\u2190" }), _jsx("h1", { children: title }), _jsx("span", {})] }));
}
export function FocusSettingsSection({ title, children, hint }) {
    return (_jsxs("section", { className: "focus-settings-block", children: [title ? _jsx("h2", { className: "focus-settings-section-title", children: title }) : null, children, hint ? _jsx("p", { className: "focus-settings-hint muted tiny", children: hint }) : null] }));
}
export function FocusToggleRow({ label, hint, checked, onChange, icon, iconClass }) {
    return (_jsxs("div", { className: "focus-settings-row focus-settings-row-static", children: [icon ? _jsx("span", { className: `focus-settings-icon ${iconClass || 'gray'}`, children: icon }) : null, _jsxs("span", { className: "focus-settings-toggle-copy", children: [_jsx("strong", { className: "block", children: label }), hint ? _jsx("span", { className: "muted tiny", children: hint }) : null] }), _jsxs("label", { className: "focus-switch", children: [_jsx("input", { type: "checkbox", checked: checked, onChange: (e) => onChange(e.target.checked) }), _jsx("span", { className: "focus-switch-slider" })] })] }));
}
export function FocusNavRow({ to, label, status, icon, iconClass, onClick }) {
    const navigate = useNavigate();
    return (_jsxs("button", { type: "button", className: "focus-settings-row", onClick: () => {
            if (onClick)
                onClick();
            else if (to)
                navigate(to);
        }, children: [_jsx("span", { className: `focus-settings-icon ${iconClass || 'gray'}`, children: icon }), _jsxs("span", { className: "focus-settings-toggle-copy", children: [_jsx("strong", { className: "block", children: label }), status ? _jsx("span", { className: "muted tiny", children: status }) : null] }), _jsx("span", { className: "focus-settings-chevron", "aria-hidden": true, children: "\u203A" })] }));
}
