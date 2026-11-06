import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createChannel, createGroup, fetchMediaUrl, updateChannel, updateGroup, uploadMediaFile } from '@/api/social';
import { fetchFocusContacts } from '@/api/focus';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { AvatarCrop } from '../ui/AvatarCrop';
import { IconSearch } from '../ui/Icons';
import { FocusBackBar } from './FocusBackBar';
export function FocusCreateWizard() {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { kind = 'group' } = useParams();
    const [params] = useSearchParams();
    const spaceKind = kind === 'channel' || params.get('type') === 'channel' ? 'channel' : 'group';
    const fileRef = useRef(null);
    const [step, setStep] = useState('name');
    const [name, setName] = useState('');
    const [visibility, setVisibility] = useState(spaceKind === 'channel' ? 'public' : 'private');
    const [q, setQ] = useState('');
    const [contacts, setContacts] = useState([]);
    const [selected, setSelected] = useState(new Set());
    const [loadingPeople, setLoadingPeople] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [cropFile, setCropFile] = useState(null);
    const [avatarPreview, setAvatarPreview] = useState(null);
    const [avatarBlob, setAvatarBlob] = useState(null);
    useEffect(() => {
        return () => {
            if (avatarPreview)
                URL.revokeObjectURL(avatarPreview);
        };
    }, [avatarPreview]);
    useEffect(() => {
        if (step !== 'members')
            return;
        let cancelled = false;
        setLoadingPeople(true);
        const handle = window.setTimeout(() => {
            void fetchFocusContacts(q)
                .then((rows) => {
                if (!cancelled)
                    setContacts(rows);
            })
                .catch((err) => {
                if (!cancelled)
                    setError(err instanceof Error ? err.message : t('errorGeneric'));
            })
                .finally(() => {
                if (!cancelled)
                    setLoadingPeople(false);
            });
        }, q ? 250 : 0);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [step, q, t]);
    const filtered = useMemo(() => contacts, [contacts]);
    function toggle(id) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    }
    function onNameContinue(e) {
        e.preventDefault();
        if (name.trim().length < 2) {
            setError(t('nameTooShort'));
            return;
        }
        setError('');
        setStep('members');
    }
    function onCropConfirm(blob) {
        setCropFile(null);
        setAvatarBlob(blob);
        if (avatarPreview)
            URL.revokeObjectURL(avatarPreview);
        setAvatarPreview(URL.createObjectURL(blob));
    }
    async function persistAvatar(spaceId) {
        if (!avatarBlob)
            return;
        const file = new File([avatarBlob], 'avatar.jpg', { type: 'image/jpeg' });
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
        if (spaceKind === 'group')
            await updateGroup(spaceId, { avatarUrl: persist || null });
        else
            await updateChannel(spaceId, { avatarUrl: persist || null });
    }
    async function finish(skipMembers) {
        setBusy(true);
        setError('');
        try {
            const memberIds = skipMembers ? [] : [...selected];
            if (spaceKind === 'group') {
                const g = await createGroup(name.trim(), 'focus', {
                    visibility,
                    memberIds
                });
                try {
                    await persistAvatar(g.id);
                }
                catch {
                    /* photo optional after create */
                }
                navigate(`/focus/chats/group/${g.id}`, { replace: true });
            }
            else {
                const c = await createChannel(name.trim(), 'focus', {
                    visibility,
                    memberIds
                });
                try {
                    await persistAvatar(c.id);
                }
                catch {
                    /* photo optional after create */
                }
                navigate(`/focus/chats/channel/${c.id}`, { replace: true });
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    const title = spaceKind === 'channel'
        ? step === 'name'
            ? t('newChannel')
            : t('addSubscribers')
        : step === 'name'
            ? t('newGroup')
            : t('addMembers');
    return (_jsxs("div", { className: "focus-wizard", children: [_jsx(FocusBackBar, { title: title, fallbackTo: "/focus/chats", onBack: () => {
                    if (step === 'members')
                        setStep('name');
                    else
                        navigate('/focus/chats');
                } }), error ? _jsx(ErrorBanner, { message: error }) : null, step === 'name' ? (_jsxs("form", { className: "focus-wizard-body", onSubmit: onNameContinue, children: [_jsxs("button", { type: "button", className: "focus-space-photo-btn focus-wizard-photo", onClick: () => fileRef.current?.click(), children: [_jsx(UserAvatar, { size: "xl", name: name || '?', avatarUrl: avatarPreview }), _jsx("span", { className: "tg-change-photo", children: t('changePhoto') })] }), _jsx("input", { ref: fileRef, type: "file", accept: "image/*", hidden: true, onChange: (e) => {
                            const f = e.target.files?.[0] ?? null;
                            e.target.value = '';
                            if (f)
                                setCropFile(f);
                        } }), _jsx("label", { className: "focus-wizard-label", children: spaceKind === 'channel' ? t('channelName') : t('groupName') }), _jsx("input", { className: "focus-wizard-input", value: name, onChange: (e) => setName(e.target.value), placeholder: spaceKind === 'channel' ? t('channelName') : t('groupName'), maxLength: 120, autoFocus: true, dir: "auto" }), _jsx("p", { className: "focus-wizard-label", children: t('visibility') }), _jsxs("div", { className: "focus-visibility-cards", children: [_jsxs("button", { type: "button", className: `focus-visibility-card${visibility === 'public' ? ' is-active' : ''}`, onClick: () => setVisibility('public'), children: [_jsx("strong", { children: spaceKind === 'channel' ? t('publicChannel') : t('publicGroup') }), _jsx("span", { className: "muted tiny", children: spaceKind === 'channel' ? t('publicChannelHint') : t('publicGroupHint') })] }), _jsxs("button", { type: "button", className: `focus-visibility-card${visibility === 'private' ? ' is-active' : ''}`, onClick: () => setVisibility('private'), children: [_jsx("strong", { children: spaceKind === 'channel' ? t('privateChannel') : t('privateGroup') }), _jsx("span", { className: "muted tiny", children: spaceKind === 'channel' ? t('privateChannelHint') : t('privateGroupHint') })] })] }), _jsx("button", { type: "submit", className: "button focus-wizard-primary", disabled: name.trim().length < 2, children: t('continue') })] })) : (_jsxs("div", { className: "focus-wizard-body", children: [_jsxs("div", { className: "focus-search", children: [_jsx(IconSearch, { size: 16 }), _jsx("input", { value: q, onChange: (e) => setQ(e.target.value), placeholder: t('searchContacts'), "aria-label": t('search') })] }), loadingPeople ? _jsx(PageLoader, {}) : null, _jsx("ul", { className: "focus-pick-list", children: filtered.map((c) => {
                            const on = selected.has(c.id);
                            return (_jsx("li", { children: _jsxs("button", { type: "button", className: `focus-pick-row${on ? ' is-selected' : ''}`, onClick: () => toggle(c.id), children: [_jsx(UserAvatar, { size: "md", name: c.displayName || c.username, username: c.username, avatarUrl: c.avatarUrl }), _jsxs("span", { className: "focus-contact-body", children: [_jsx("strong", { children: c.displayName || c.username }), _jsxs("span", { className: "muted", children: ["@", c.username] })] }), _jsx("span", { className: `focus-check${on ? ' on' : ''}`, "aria-hidden": true })] }) }, c.id));
                        }) }), _jsxs("div", { className: "focus-wizard-footer", children: [_jsx("button", { type: "button", className: "button button-ghost", disabled: busy, onClick: () => void finish(true), children: t('skipAndCreate') }), _jsxs("button", { type: "button", className: "button", disabled: busy, onClick: () => void finish(false), children: [t('finishCreate'), selected.size ? ` (${selected.size})` : ''] })] })] })), cropFile ? (_jsx(AvatarCrop, { file: cropFile, onCancel: () => setCropFile(null), onConfirm: onCropConfirm })) : null] }));
}
