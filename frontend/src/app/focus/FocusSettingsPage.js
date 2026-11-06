import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchMediaUrl, resolveMediaUrl, uploadMediaFile } from '@/api/social';
import { fetchFocusProfile, updateFocusProfile } from '@/api/focus';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAppMode } from './AppModeContext';
import { UserAvatar } from '../ui/UserAvatar';
import { AvatarCrop } from '../ui/AvatarCrop';
import { IconArchive, IconBell, IconPhone, IconSettings, IconUser, IconUsers } from '../ui/Icons';
import { ErrorBanner } from '../ui/States';
import { FocusNavRow } from './FocusSettingsShared';
export function FocusSettingsPage() {
    const { t, locale, setLocale } = useI18n();
    const { session, logout } = useAuth();
    const { setMode } = useAppMode();
    const navigate = useNavigate();
    const fileRef = useRef(null);
    const [profile, setProfile] = useState(null);
    const [editing, setEditing] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [bio, setBio] = useState('');
    const [avatarBusy, setAvatarBusy] = useState(false);
    const [saveBusy, setSaveBusy] = useState(false);
    const [hideBusy, setHideBusy] = useState(false);
    const [error, setError] = useState('');
    const [cropFile, setCropFile] = useState(null);
    const [hideBrowseProfile, setHideBrowseProfile] = useState(false);
    async function reload() {
        try {
            const p = await fetchFocusProfile();
            setProfile({
                ...p,
                avatarUrl: resolveMediaUrl(p.avatarUrl) || p.avatarUrl || null
            });
            setDisplayName(p.displayName || '');
            setBio(p.bio || '');
            setHideBrowseProfile(Boolean(p.hideBrowseProfile));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    useEffect(() => {
        void reload();
    }, []);
    async function onSave(e) {
        e.preventDefault();
        setSaveBusy(true);
        setError('');
        try {
            const p = await updateFocusProfile({
                displayName: displayName.trim(),
                bio: bio.trim()
            });
            setProfile({
                ...p,
                avatarUrl: resolveMediaUrl(p.avatarUrl) || p.avatarUrl || null
            });
            setEditing(false);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setSaveBusy(false);
        }
    }
    async function applyCrop(blob) {
        setCropFile(null);
        setAvatarBusy(true);
        setError('');
        try {
            const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
            const mediaId = await uploadMediaFile(file, 'avatar');
            const { secureUrl } = await fetchMediaUrl(mediaId);
            let persist = secureUrl || '';
            try {
                if (/^https?:\/\//i.test(persist)) {
                    const u = new URL(persist);
                    persist = `${u.pathname}${u.search}`;
                }
            }
            catch {
                /* keep */
            }
            const p = await updateFocusProfile({ avatarUrl: persist || null });
            setProfile({
                ...p,
                avatarUrl: resolveMediaUrl(p.avatarUrl) || p.avatarUrl || null
            });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setAvatarBusy(false);
        }
    }
    const name = profile?.displayName || session?.user?.username || '';
    const username = session?.user?.username || '';
    return (_jsxs("div", { className: "focus-settings", children: [_jsxs("div", { className: "focus-chats-header", children: [_jsx("button", { type: "button", className: "focus-back-btn compact", onClick: () => navigate('/focus/chats'), children: "\u2190" }), _jsx("h1", { children: t('settings') }), _jsx("span", {})] }), _jsxs("div", { className: "focus-settings-profile", children: [_jsxs("button", { type: "button", className: "focus-avatar-edit", disabled: avatarBusy, onClick: () => fileRef.current?.click(), children: [_jsx(UserAvatar, { size: "xl", name: name, username: username, avatarUrl: profile?.avatarUrl }), _jsx("span", { className: "muted tiny", children: avatarBusy ? '…' : t('changeProfilePhoto') })] }), _jsx("input", { ref: fileRef, type: "file", accept: "image/*", hidden: true, disabled: avatarBusy, onChange: (e) => {
                            const f = e.target.files?.[0] ?? null;
                            e.target.value = '';
                            if (f)
                                setCropFile(f);
                        } }), _jsx("h1", { children: name }), _jsxs("p", { className: "muted", children: ["@", username] }), profile?.bio ? _jsx("p", { className: "focus-bio", children: profile.bio }) : null, _jsx("button", { type: "button", className: "focus-text-btn", onClick: () => setEditing((v) => !v), children: editing ? t('cancel') : t('edit') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, editing ? (_jsxs("form", { className: "focus-create-panel", onSubmit: (e) => void onSave(e), children: [_jsx("input", { value: displayName, onChange: (e) => setDisplayName(e.target.value), placeholder: t('displayName'), maxLength: 80 }), _jsx("textarea", { value: bio, onChange: (e) => setBio(e.target.value), placeholder: t('bio'), maxLength: 150, rows: 3 }), _jsx("button", { type: "submit", className: "button", disabled: saveBusy, children: t('saveProfile') })] })) : null, _jsxs("section", { className: "focus-settings-block", children: [_jsxs("div", { className: "focus-settings-row focus-settings-row-static", children: [_jsx("span", { className: "focus-settings-icon purple", children: _jsx(IconUser, { size: 18 }) }), _jsxs("span", { className: "focus-settings-toggle-copy", children: [_jsx("strong", { className: "block", children: t('hideBrowseProfile') }), _jsx("span", { className: "muted tiny", children: t('hideBrowseProfileHint') })] }), _jsxs("label", { className: "focus-switch", children: [_jsx("input", { type: "checkbox", checked: hideBrowseProfile, disabled: hideBusy, onChange: (e) => {
                                            const next = e.target.checked;
                                            setHideBrowseProfile(next);
                                            setHideBusy(true);
                                            setError('');
                                            void updateFocusProfile({ hideBrowseProfile: next })
                                                .then((p) => {
                                                setProfile({
                                                    ...p,
                                                    avatarUrl: resolveMediaUrl(p.avatarUrl) || p.avatarUrl || null
                                                });
                                                setHideBrowseProfile(Boolean(p.hideBrowseProfile));
                                            })
                                                .catch((err) => {
                                                setHideBrowseProfile(!next);
                                                setError(err instanceof Error ? err.message : t('errorGeneric'));
                                            })
                                                .finally(() => setHideBusy(false));
                                        } }), _jsx("span", { className: "focus-switch-slider" })] })] }), _jsxs(Link, { to: "/focus/calls", className: "focus-settings-row", children: [_jsx("span", { className: "focus-settings-icon green", children: _jsx(IconPhone, { size: 18 }) }), _jsx("span", { children: t('recentCalls') }), _jsx("span", { className: "focus-settings-chevron", "aria-hidden": true, children: "\u203A" })] }), _jsxs(Link, { to: "/focus/chats", className: "focus-settings-row", children: [_jsx("span", { className: "focus-settings-icon cyan", children: _jsx(IconUsers, { size: 18 }) }), _jsx("span", { children: t('focusChats') }), _jsx("span", { className: "focus-settings-chevron", "aria-hidden": true, children: "\u203A" })] })] }), _jsxs("section", { className: "focus-settings-block", children: [_jsx(FocusNavRow, { to: "/focus/settings/notifications", label: t('notificationsAndSounds'), icon: _jsx(IconBell, { size: 18 }), iconClass: "red" }), _jsx(FocusNavRow, { to: "/focus/settings/storage", label: t('dataAndStorage'), icon: _jsx(IconArchive, { size: 18 }), iconClass: "green" }), _jsx(FocusNavRow, { to: "/focus/settings/appearance", label: t('appearance'), icon: _jsx(IconSettings, { size: 18 }), iconClass: "blue" }), _jsxs(Link, { to: "/settings/privacy", className: "focus-settings-row", onClick: () => setMode('browse'), children: [_jsx("span", { className: "focus-settings-icon gray", children: _jsx(IconSettings, { size: 18 }) }), _jsx("span", { children: t('privacySecurity') }), _jsx("span", { className: "focus-settings-chevron", "aria-hidden": true, children: "\u203A" })] }), _jsxs("div", { className: "focus-settings-row", children: [_jsx("span", { className: "focus-settings-icon purple", children: _jsx(IconSettings, { size: 18 }) }), _jsx("span", { children: t('language') }), _jsxs("select", { className: "focus-lang-select", value: locale, onChange: (e) => setLocale(e.target.value), "aria-label": t('language'), children: [_jsx("option", { value: "ar", children: t('arabic') }), _jsx("option", { value: "en", children: t('english') })] })] })] }), _jsxs("section", { className: "focus-settings-block", children: [_jsx("button", { type: "button", className: "focus-settings-row", onClick: () => setMode('browse'), children: _jsx("span", { children: t('switchToBrowse') }) }), _jsx("button", { type: "button", className: "focus-settings-row danger", onClick: () => void logout(), children: _jsx("span", { children: t('logout') }) })] }), cropFile ? (_jsx(AvatarCrop, { file: cropFile, onCancel: () => setCropFile(null), onConfirm: (b) => void applyCrop(b) })) : null] }));
}
