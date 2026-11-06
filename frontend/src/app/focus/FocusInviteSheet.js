import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
export function FocusInviteSheet({ open, onClose, url, title, shareText }) {
    const { t } = useI18n();
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');
    const displayUrl = useMemo(() => url, [url]);
    if (!open)
        return null;
    async function copy() {
        setError('');
        try {
            await navigator.clipboard.writeText(displayUrl);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        }
        catch {
            try {
                const ta = document.createElement('textarea');
                ta.value = displayUrl;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
            }
            catch {
                setError(t('errorGeneric'));
            }
        }
    }
    async function share() {
        setError('');
        const text = shareText || t('inviteFriendsShare');
        try {
            if (navigator.share) {
                await navigator.share({ title: title || 'SecureChat', text, url: displayUrl });
                return;
            }
            await copy();
        }
        catch (err) {
            // User cancelled share sheet — ignore AbortError
            if (err instanceof DOMException && err.name === 'AbortError')
                return;
            await copy();
        }
    }
    return (_jsx("div", { className: "focus-sheet-backdrop", role: "presentation", onClick: onClose, children: _jsxs("div", { className: "focus-sheet", role: "dialog", "aria-modal": "true", "aria-label": t('inviteFriends'), onClick: (e) => e.stopPropagation(), children: [_jsx("div", { className: "focus-sheet-handle" }), _jsx("h2", { children: t('inviteFriends') }), _jsx("p", { className: "muted tiny", children: t('inviteLinkHint') }), _jsx("div", { className: "focus-invite-link-box", children: _jsx("span", { className: "focus-invite-url", children: displayUrl }) }), error ? _jsx("p", { className: "error-text", children: error }) : null, copied ? _jsx("p", { className: "success-text", children: t('inviteLinkCopied') }) : null, _jsxs("div", { className: "focus-sheet-actions", children: [_jsx("button", { type: "button", className: "button", onClick: () => void copy(), children: t('copyInviteLink') }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => void share(), children: t('shareOutsideApp') }), _jsx("button", { type: "button", className: "button button-ghost", onClick: onClose, children: t('close') })] })] }) }));
}
