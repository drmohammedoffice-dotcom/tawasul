import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { messages } from './messages';
/** v2 ignores old `securechat.locale=en` left from earlier builds. */
const STORAGE_KEY = 'securechat.locale.v2';
const LEGACY_KEY = 'securechat.locale';
const I18nContext = createContext(null);
function readInitialLocale() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === 'ar' || raw === 'en')
            return raw;
    }
    catch {
        /* ignore */
    }
    // Product default is Arabic (RTL). English only after explicit user choice.
    try {
        localStorage.removeItem(LEGACY_KEY);
        localStorage.setItem(STORAGE_KEY, 'ar');
    }
    catch {
        /* ignore */
    }
    return 'ar';
}
function applyDocumentLocale(locale, dir) {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = dir;
    root.setAttribute('data-locale', locale);
    try {
        document.body.lang = locale;
        document.body.dir = dir;
    }
    catch {
        /* ignore */
    }
}
export function I18nProvider({ children }) {
    const [locale, setLocaleState] = useState(readInitialLocale);
    function setLocale(next) {
        setLocaleState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
            localStorage.removeItem(LEGACY_KEY);
        }
        catch {
            /* ignore */
        }
    }
    const dir = locale === 'ar' ? 'rtl' : 'ltr';
    useEffect(() => {
        applyDocumentLocale(locale, dir);
    }, [locale, dir]);
    const value = useMemo(() => ({
        locale,
        setLocale,
        dir,
        t: (key) => messages[locale][key] ?? messages.en[key] ?? key
    }), [locale, dir]);
    return _jsx(I18nContext.Provider, { value: value, children: children });
}
export function useI18n() {
    const ctx = useContext(I18nContext);
    if (!ctx)
        throw new Error('useI18n requires I18nProvider');
    return ctx;
}
