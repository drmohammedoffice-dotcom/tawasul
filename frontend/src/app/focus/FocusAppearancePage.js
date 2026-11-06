import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { IconCheck } from '../ui/Icons';
import { FocusSettingsHeader, FocusSettingsSection, FocusToggleRow } from './FocusSettingsShared';
import { applyAppearanceToDocument, CHAT_THEME_VARS, loadAppearancePrefs, saveAppearancePrefs } from './focusPrefs';
const THEMES = ['classic', 'sunset', 'frost', 'rose'];
const ACCENTS = ['#2aabee', '#34c759', '#ff9f0a', '#af52de', '#ff2d55', '#64d2ff'];
const BACKGROUNDS = [
    { id: 'doodle-dark', labelKey: 'chatBgDoodle' },
    { id: 'solid-dark', labelKey: 'chatBgSolid' },
    { id: 'gradient-blue', labelKey: 'chatBgGradient' }
];
export function FocusAppearancePage() {
    const { t } = useI18n();
    const { session } = useAuth();
    const uid = session?.user?.id;
    const [prefs, setPrefs] = useState(() => loadAppearancePrefs(uid));
    useEffect(() => {
        const next = loadAppearancePrefs(uid);
        setPrefs(next);
        applyAppearanceToDocument(next);
    }, [uid]);
    function patch(partial) {
        setPrefs((prev) => {
            const next = { ...prev, ...partial };
            saveAppearancePrefs(uid, next);
            applyAppearanceToDocument(next);
            return next;
        });
    }
    const theme = CHAT_THEME_VARS[prefs.chatTheme];
    return (_jsxs("div", { className: "focus-settings", children: [_jsx(FocusSettingsHeader, { title: t('appearance') }), _jsxs("section", { className: "focus-settings-block focus-appear-preview", "data-focus-bg": prefs.chatBackground, style: { ['--focus-bubble-out']: theme.bubbleOut }, children: [_jsxs("div", { className: "focus-appear-bubble in", children: [_jsx("span", { className: "focus-appear-name", children: "Ayman" }), _jsx("p", { children: t('appearPreviewIn') }), _jsx("span", { className: "focus-appear-time", children: "9:20" })] }), _jsxs("div", { className: "focus-appear-bubble out", style: {
                            background: theme.bubbleOut,
                            color: theme.bubbleOutText,
                            borderRadius: prefs.bubbleRadius === 'sm' ? 10 : prefs.bubbleRadius === 'lg' ? 22 : 16
                        }, children: [_jsx("p", { children: t('appearPreviewOut') }), _jsxs("span", { className: "focus-appear-time", children: ["9:20 ", _jsx("span", { className: "wa-ticks is-read", "aria-hidden": true, children: "\u2713\u2713" })] })] })] }), _jsx(FocusSettingsSection, { title: t('chatThemes'), children: _jsx("div", { className: "focus-theme-carousel", children: THEMES.map((id) => {
                        const v = CHAT_THEME_VARS[id];
                        const selected = prefs.chatTheme === id;
                        return (_jsxs("button", { type: "button", className: `focus-theme-tile${selected ? ' is-selected' : ''}`, onClick: () => patch({ chatTheme: id }), "aria-pressed": selected, children: [_jsx("span", { className: "focus-theme-tile-bg", "data-focus-bg": prefs.chatBackground }), _jsx("span", { className: "focus-theme-tile-bubble", style: { background: v.bubbleOut } }), selected ? (_jsx("span", { className: "focus-theme-check", children: _jsx(IconCheck, { size: 14 }) })) : null] }, id));
                    }) }) }), _jsxs(FocusSettingsSection, { children: [_jsx("div", { className: "focus-settings-row focus-settings-row-static", children: _jsx("span", { className: "focus-settings-toggle-copy", children: _jsx("strong", { className: "block", children: t('chatBackground') }) }) }), _jsx("div", { className: "focus-bg-options", children: BACKGROUNDS.map((bg) => (_jsx("button", { type: "button", className: `button button-compact ${prefs.chatBackground === bg.id ? '' : 'button-ghost'}`, onClick: () => patch({ chatBackground: bg.id }), children: t(bg.labelKey) }, bg.id))) }), _jsx("div", { className: "focus-settings-row focus-settings-row-static", children: _jsx("span", { className: "focus-settings-toggle-copy", children: _jsx("strong", { className: "block", children: t('yourColor') }) }) }), _jsx("div", { className: "focus-accent-row", children: ACCENTS.map((c) => (_jsx("button", { type: "button", className: `focus-accent-swatch${prefs.accentColor === c ? ' is-selected' : ''}`, style: { background: c }, "aria-label": c, onClick: () => patch({ accentColor: c }) }, c))) })] }), _jsxs(FocusSettingsSection, { children: [_jsx(FocusToggleRow, { label: t('nightMode'), checked: prefs.nightMode, onChange: (v) => patch({ nightMode: v, nightModeAuto: 'off' }) }), _jsxs("div", { className: "focus-settings-row", children: [_jsx("span", { className: "focus-settings-toggle-copy", children: _jsx("strong", { className: "block", children: t('autoNightMode') }) }), _jsxs("select", { className: "focus-lang-select", value: prefs.nightModeAuto, onChange: (e) => patch({ nightModeAuto: e.target.value }), children: [_jsx("option", { value: "off", children: t('notifStatusOff') }), _jsx("option", { value: "system", children: t('systemDefault') })] })] })] }), _jsxs(FocusSettingsSection, { children: [_jsxs("div", { className: "focus-settings-row", children: [_jsx("span", { className: "focus-settings-toggle-copy", children: _jsx("strong", { className: "block", children: t('fontSize') }) }), _jsxs("select", { className: "focus-lang-select", value: prefs.fontSize, onChange: (e) => patch({ fontSize: e.target.value }), children: [_jsx("option", { value: "system", children: t('systemDefault') }), _jsx("option", { value: "sm", children: t('fontSmall') }), _jsx("option", { value: "md", children: t('fontMedium') }), _jsx("option", { value: "lg", children: t('fontLarge') })] })] }), _jsxs("div", { className: "focus-settings-row", children: [_jsx("span", { className: "focus-settings-toggle-copy", children: _jsx("strong", { className: "block", children: t('messageCorners') }) }), _jsxs("select", { className: "focus-lang-select", value: prefs.bubbleRadius, onChange: (e) => patch({ bubbleRadius: e.target.value }), children: [_jsx("option", { value: "sm", children: t('fontSmall') }), _jsx("option", { value: "md", children: t('fontMedium') }), _jsx("option", { value: "lg", children: t('fontLarge') })] })] }), _jsx(FocusToggleRow, { label: t('motionEffects'), checked: prefs.motionEffects, onChange: (v) => patch({ motionEffects: v }) }), _jsx(FocusToggleRow, { label: t('stickersAndEmoji'), checked: prefs.stickersEnabled, onChange: (v) => patch({ stickersEnabled: v }) })] })] }));
}
