import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { searchAll } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
export function UserPicker({ onPick, disabled }) {
    const { t } = useI18n();
    const [q, setQ] = useState('');
    const [hits, setHits] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const abortRef = useRef(null);
    useEffect(() => {
        const trimmed = q.trim();
        if (trimmed.length < 1) {
            abortRef.current?.abort();
            setHits([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError('');
        const timer = window.setTimeout(() => {
            abortRef.current?.abort();
            const ac = new AbortController();
            abortRef.current = ac;
            void searchAll(trimmed, ac.signal)
                .then((res) => setHits((res.users ?? []).slice(0, 8)))
                .catch((err) => {
                if (err?.name === 'AbortError')
                    return;
                setError(err instanceof Error ? err.message : t('errorGeneric'));
            })
                .finally(() => setLoading(false));
        }, 280);
        return () => window.clearTimeout(timer);
    }, [q, t]);
    return (_jsxs("div", { className: "user-picker", children: [_jsx("input", { className: "search-input", value: q, disabled: disabled, onChange: (e) => setQ(e.target.value), placeholder: t('searchPeople'), autoComplete: "off" }), loading ? _jsx("p", { className: "muted tiny", children: t('loading') }) : null, error ? _jsx("p", { className: "auth-error", children: error }) : null, _jsx("div", { className: "user-picker-list", children: hits.map((u) => (_jsxs("button", { type: "button", className: "user-picker-item", disabled: disabled, onClick: () => void onPick(u), children: [_jsx("span", { className: "avatar-circle sm", children: (u.displayName || u.username).slice(0, 1).toUpperCase() }), _jsxs("span", { children: [_jsxs("strong", { children: ["@", u.username] }), u.displayName ? _jsxs("span", { className: "muted", children: [" \u00B7 ", u.displayName] }) : null] })] }, u.id))) })] }));
}
