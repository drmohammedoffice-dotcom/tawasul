import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { checkUsernameAvailable, fetchMyBusiness, updateBusiness } from '@/api/accounts';
import { fetchMyProfile, updateMyProfile, uploadMediaFile } from '@/api/social';
import { resolveMediaUrl } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { AvatarCrop } from '../ui/AvatarCrop';
import { ErrorBanner, PageLoader } from '../ui/States';
import { useToast } from '../ui/Toast';
export function EditProfilePage() {
    const { t } = useI18n();
    const { push } = useToast();
    const navigate = useNavigate();
    const cameraRef = useRef(null);
    const galleryRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [username, setUsername] = useState('');
    const [originalUsername, setOriginalUsername] = useState('');
    const [usernameStatus, setUsernameStatus] = useState('idle');
    const [bio, setBio] = useState('');
    const [avatarUrl, setAvatarUrl] = useState(null);
    const [cropFile, setCropFile] = useState(null);
    const [confirmUsername, setConfirmUsername] = useState(false);
    const [isBusiness, setIsBusiness] = useState(false);
    const [businessName, setBusinessName] = useState('');
    const [addressText, setAddressText] = useState('');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    useEffect(() => {
        void Promise.all([fetchMyProfile(), fetchMyBusiness().catch(() => null)])
            .then(([p, biz]) => {
            setDisplayName(p.displayName || '');
            setUsername(p.username || '');
            setOriginalUsername(p.username || '');
            setBio(String(p.bio || '').slice(0, 150));
            setAvatarUrl(p.avatarUrl || null);
            const bp = biz?.businessProfile || p.businessProfile;
            const business = (biz?.accountType || p.accountType) === 'business';
            setIsBusiness(business);
            if (bp) {
                setBusinessName(bp.businessName || '');
                setAddressText(bp.addressText || '');
                setLatitude(bp.latitude != null ? String(bp.latitude) : '');
                setLongitude(bp.longitude != null ? String(bp.longitude) : '');
            }
        })
            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
            .finally(() => setLoading(false));
    }, [t]);
    useEffect(() => {
        const next = username.trim().toLowerCase();
        if (!next || next === originalUsername.toLowerCase()) {
            setUsernameStatus('idle');
            return;
        }
        if (!/^[a-zA-Z0-9._]{1,30}$/.test(next)) {
            setUsernameStatus('invalid');
            return;
        }
        setUsernameStatus('checking');
        const handle = window.setTimeout(() => {
            void checkUsernameAvailable(next)
                .then((r) => setUsernameStatus(r.available ? 'available' : 'taken'))
                .catch(() => setUsernameStatus('invalid'));
        }, 350);
        return () => window.clearTimeout(handle);
    }, [username, originalUsername]);
    async function persistProfile(includeUsername) {
        setBusy(true);
        setError('');
        try {
            const patch = { bio: bio.slice(0, 150) };
            const name = displayName.trim();
            if (name)
                patch.displayName = name;
            if (avatarUrl)
                patch.avatarUrl = avatarUrl;
            if (includeUsername) {
                const next = username.trim().toLowerCase();
                if (next && next !== originalUsername.toLowerCase())
                    patch.username = next;
            }
            await updateMyProfile(patch);
            if (isBusiness) {
                const lat = latitude.trim() === '' ? null : Number(latitude);
                const lng = longitude.trim() === '' ? null : Number(longitude);
                await updateBusiness({
                    ...(businessName.trim() ? { businessName: businessName.trim() } : {}),
                    addressText: addressText.trim() || null,
                    latitude: lat != null && Number.isFinite(lat) ? lat : null,
                    longitude: lng != null && Number.isFinite(lng) ? lng : null
                });
            }
            push(t('profileSaved'), 'success');
            navigate('/profile');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
            setConfirmUsername(false);
        }
    }
    async function onSave(e) {
        e.preventDefault();
        const next = username.trim().toLowerCase();
        const changing = next && next !== originalUsername.toLowerCase();
        if (changing) {
            if (usernameStatus === 'taken' || usernameStatus === 'invalid' || usernameStatus === 'checking') {
                setError(t('usernameUnavailable'));
                return;
            }
            setConfirmUsername(true);
            return;
        }
        await persistProfile(false);
    }
    async function applyCrop(blob) {
        setCropFile(null);
        setBusy(true);
        setError('');
        try {
            const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
            const mediaId = await uploadMediaFile(file, 'avatar');
            const { secureUrl } = await (await import('@/api/social')).fetchMediaUrl(mediaId);
            let persist = secureUrl || '';
            try {
                if (/^https?:\/\//i.test(persist)) {
                    const u = new URL(persist);
                    persist = `${u.pathname}${u.search}`;
                }
            }
            catch {
                /* keep as-is */
            }
            const resolved = resolveMediaUrl(persist);
            setAvatarUrl(resolved);
            if (persist)
                await updateMyProfile({ avatarUrl: persist });
            push(t('avatarUpdated'), 'success');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function clearAvatar() {
        setBusy(true);
        try {
            await updateMyProfile({ avatarUrl: '' });
            setAvatarUrl(null);
            push(t('avatarRemoved'), 'success');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    if (loading)
        return _jsx(PageLoader, {});
    return (_jsxs("div", { className: "edit-profile-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('editProfile') }), _jsx(Link, { className: "button button-ghost button-compact", to: "/profile", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsxs("div", { className: "avatar-edit-block", children: [_jsx("div", { className: "avatar-circle xl", children: avatarUrl ? _jsx("img", { src: avatarUrl, alt: "" }) : (displayName || '?').slice(0, 1).toUpperCase() }), _jsxs("div", { className: "create-media-actions", children: [_jsx("button", { type: "button", className: "button button-compact", onClick: () => cameraRef.current?.click(), children: t('takePhoto') }), _jsx("button", { type: "button", className: "button button-compact button-ghost", onClick: () => galleryRef.current?.click(), children: t('chooseFromGallery') }), avatarUrl ? (_jsx("button", { type: "button", className: "button button-compact button-ghost", onClick: () => void clearAvatar(), children: t('removePhoto') })) : null] }), _jsx("input", { ref: cameraRef, className: "sr-only", type: "file", accept: "image/*", capture: "user", onChange: (e) => {
                            const f = e.target.files?.[0];
                            if (f)
                                setCropFile(f);
                            e.target.value = '';
                        } }), _jsx("input", { ref: galleryRef, className: "sr-only", type: "file", accept: "image/*", onChange: (e) => {
                            const f = e.target.files?.[0];
                            if (f)
                                setCropFile(f);
                            e.target.value = '';
                        } })] }), _jsxs("form", { className: "create-form", onSubmit: (e) => void onSave(e), children: [_jsxs("label", { className: "field-label", children: [t('displayName'), _jsx("input", { value: displayName, onChange: (e) => setDisplayName(e.target.value), maxLength: 80, disabled: busy })] }), _jsxs("label", { className: "field-label", children: [t('username'), _jsx("input", { value: username, onChange: (e) => setUsername(e.target.value.replace(/\s/g, '')), maxLength: 30, disabled: busy, dir: "ltr", autoCapitalize: "off", autoCorrect: "off" }), usernameStatus === 'checking' ? _jsx("span", { className: "muted tiny", children: t('checkingUsername') }) : null, usernameStatus === 'available' ? _jsx("span", { className: "username-ok", children: t('usernameAvailable') }) : null, usernameStatus === 'taken' ? _jsx("span", { className: "username-bad", children: t('usernameTaken') }) : null, usernameStatus === 'invalid' && username.trim() ? (_jsx("span", { className: "username-bad", children: t('usernameInvalid') })) : null] }), _jsxs("label", { className: "field-label", children: [t('bio'), _jsx("textarea", { value: bio, onChange: (e) => setBio(e.target.value.slice(0, 150)), rows: 4, maxLength: 150, disabled: busy, dir: "auto" }), _jsx("span", { className: "muted tiny bio-char-count", children: t('bioLimit').replace('{n}', String(bio.length)) })] }), isBusiness ? (_jsxs("fieldset", { className: "biz-location-fields", children: [_jsx("legend", { children: t('businessLocation') }), _jsxs("label", { className: "field-label", children: [t('businessName'), _jsx("input", { value: businessName, onChange: (e) => setBusinessName(e.target.value), maxLength: 120, disabled: busy, dir: "auto" })] }), _jsxs("label", { className: "field-label", children: [t('businessAddress'), _jsx("textarea", { value: addressText, onChange: (e) => setAddressText(e.target.value), rows: 2, maxLength: 280, disabled: busy, dir: "auto", placeholder: t('businessAddress') })] }), _jsxs("div", { className: "inline-actions", style: { alignItems: 'stretch' }, children: [_jsxs("label", { className: "field-label", style: { flex: 1 }, children: ["Latitude", _jsx("input", { value: latitude, onChange: (e) => setLatitude(e.target.value), inputMode: "decimal", disabled: busy, dir: "ltr", placeholder: "33.3152" })] }), _jsxs("label", { className: "field-label", style: { flex: 1 }, children: ["Longitude", _jsx("input", { value: longitude, onChange: (e) => setLongitude(e.target.value), inputMode: "decimal", disabled: busy, dir: "ltr", placeholder: "44.3661" })] })] }), _jsx("button", { type: "button", className: "button button-ghost button-compact", disabled: busy || !navigator.geolocation, onClick: () => {
                                    navigator.geolocation.getCurrentPosition((pos) => {
                                        setLatitude(String(pos.coords.latitude));
                                        setLongitude(String(pos.coords.longitude));
                                    }, () => setError(t('errorGeneric')));
                                }, children: t('useCurrentLocation') })] })) : null, _jsx("button", { className: "button", type: "submit", disabled: busy, children: t('save') })] }), confirmUsername ? (_jsx("div", { className: "sheet-backdrop", role: "dialog", "aria-modal": "true", children: _jsxs("div", { className: "sheet wa-share-sheet", children: [_jsx("h3", { children: t('usernameChangeTitle') }), _jsx("p", { children: t('usernameChangeHint') }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: "button", disabled: busy, onClick: () => void persistProfile(true), children: t('confirm') }), _jsx("button", { type: "button", className: "button button-ghost", disabled: busy, onClick: () => setConfirmUsername(false), children: t('cancel') })] })] }) })) : null, cropFile ? (_jsx(AvatarCrop, { file: cropFile, onCancel: () => setCropFile(null), onConfirm: (b) => void applyCrop(b) })) : null] }));
}
