import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useI18n } from '@/i18n/I18nProvider';
import { useAppMode } from './AppModeContext';
export function ModeToggle() {
    const { t } = useI18n();
    const { mode, setMode } = useAppMode();
    return (_jsxs("div", { className: "mode-toggle", role: "tablist", "aria-label": t('appMode'), onClick: (e) => e.stopPropagation(), children: [_jsx("button", { type: "button", role: "tab", "aria-selected": mode === 'browse', className: `mode-toggle-btn${mode === 'browse' ? ' is-active' : ''}`, onClick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMode('browse');
                }, children: t('modeBrowse') }), _jsx("button", { type: "button", role: "tab", "aria-selected": mode === 'focus', className: `mode-toggle-btn${mode === 'focus' ? ' is-active' : ''}`, onClick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMode('focus');
                }, children: t('modeFocus') })] }));
}
