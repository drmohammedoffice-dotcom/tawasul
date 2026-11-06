import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addCloseFriend, changePassword, confirmLinkEmail, fetchAccount, fetchBlockedUsers, fetchBusinessCategories, fetchCloseFriendCandidates, fetchCloseFriends, fetchMyBusiness, fetchVerificationStatus, removeCloseFriend, requestEmail2faOtp, requestLinkEmail, revokeSession, setAccountCountry, setEmail2fa, setInterests, submitVerification, switchToBusiness, switchToPersonal } from '@/api/accounts';
import { unblockUser, uploadMediaFile } from '@/api/social';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { useToast } from '../ui/Toast';
import { fetchInferredInterests, fetchRecommendationPreferences, forgetInferredInterest, resetRecommendations, saveRecommendationPreferences } from '@/api/recommendations';
function Section({ title, children }) {
    return (_jsxs("section", { className: "settings-card", children: [_jsx("h2", { children: title }), children] }));
}
export function AccountHubPage() {
    const { t, locale, setLocale } = useI18n();
    const { logout } = useAuth();
    const { push } = useToast();
    const [account, setAccount] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');
    async function reload() {
        setLoading(true);
        try {
            setAccount(await fetchAccount());
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void reload();
    }, []);
    function applyTheme(next) {
        document.documentElement.dataset.theme = next;
        localStorage.setItem('chat-theme', next);
        setTheme(next);
    }
    if (loading)
        return _jsx(PageLoader, {});
    return (_jsxs("div", { className: "settings-page", children: [_jsx("div", { className: "page-header", children: _jsx("h1", { children: t('settings') }) }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsxs(Section, { title: t('appearance'), children: [_jsxs("div", { className: "settings-row", children: [_jsx("span", { children: t('theme') }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: `button button-compact ${theme === 'dark' ? '' : 'button-ghost'}`, onClick: () => applyTheme('dark'), children: t('darkMode') }), _jsx("button", { type: "button", className: `button button-compact ${theme === 'light' ? '' : 'button-ghost'}`, onClick: () => applyTheme('light'), children: t('lightMode') })] })] }), _jsxs("label", { className: "field-label", children: [t('language'), _jsxs("select", { value: locale, onChange: (e) => setLocale(e.target.value), children: [_jsx("option", { value: "en", children: "English" }), _jsx("option", { value: "ar", children: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629" })] })] })] }), _jsxs(Section, { title: t('accountInformation'), children: [_jsxs("p", { className: "muted tiny", children: ["@", account?.username] }), _jsxs("p", { className: "muted tiny", children: [t('phone'), ": ", account?.phoneE164 || t('notLinked')] }), _jsxs("p", { className: "muted tiny", children: [t('email'), ": ", account?.email || t('notLinked')] }), _jsxs("p", { className: "muted tiny", children: [t('country'), ": ", account?.countryCode || '—'] }), _jsxs("div", { className: "settings-links", children: [_jsx(Link, { to: "/settings/security", children: t('securitySettings') }), _jsx(Link, { to: "/settings/privacy", children: t('privacySettings') }), _jsx(Link, { to: "/settings/blocked", children: t('blockedUsers') }), _jsx(Link, { to: "/settings/close-friends", children: t('closeFriends') }), _jsx(Link, { to: "/settings/interests", children: t('interests') }), _jsx(Link, { to: "/settings/business", children: account?.accountType === 'business' ? t('switchToPersonal') : t('switchToBusiness') }), account?.accountType === 'business' ? (_jsx(Link, { to: "/settings/verification", children: t('businessVerification') })) : null, _jsx(Link, { to: "/archive", children: t('archive') }), account?.role === 'admin' ? (_jsx(Link, { to: "/settings/admin/verification", children: t('adminVerification') })) : null, account?.role === 'admin' ? (_jsx(Link, { to: "/settings/admin/recommendations", children: t('recommendationAdmin') })) : null] })] }), _jsx(Section, { title: t('account'), children: _jsx("button", { type: "button", className: "button button-ghost", onClick: () => void logout().then(() => push(t('loggedOut'), 'success')), children: t('logout') }) })] }));
}
export function SecuritySettingsPage() {
    const { t } = useI18n();
    const { push } = useToast();
    const [account, setAccount] = useState(null);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [email, setEmail] = useState('');
    const [emailCode, setEmailCode] = useState('');
    const [twoFaCode, setTwoFaCode] = useState('');
    const [country, setCountry] = useState('IQ');
    const [error, setError] = useState('');
    const [debug, setDebug] = useState('');
    useEffect(() => {
        void fetchAccount().then((a) => {
            setAccount(a);
            setCountry(a.countryCode || 'IQ');
            setEmail(a.email || '');
        });
    }, []);
    return (_jsxs("div", { className: "settings-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('securitySettings') }), _jsx(Link, { to: "/settings", className: "button button-ghost button-compact", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, debug ? _jsxs("p", { className: "muted tiny", children: ["dev: ", debug] }) : null, _jsx(Section, { title: t('changePassword'), children: _jsxs("form", { className: "create-form", onSubmit: (e) => {
                        e.preventDefault();
                        void changePassword(currentPassword, newPassword)
                            .then(() => {
                            push(t('passwordChanged'), 'success');
                            setCurrentPassword('');
                            setNewPassword('');
                        })
                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                    }, children: [_jsx("input", { type: "password", placeholder: t('currentPassword'), value: currentPassword, onChange: (e) => setCurrentPassword(e.target.value), required: true }), _jsx("input", { type: "password", placeholder: t('newPassword'), value: newPassword, onChange: (e) => setNewPassword(e.target.value), minLength: 8, required: true }), _jsx("button", { className: "button", type: "submit", children: t('save') })] }) }), _jsxs(Section, { title: t('linkEmail'), children: [_jsxs("form", { className: "create-form", onSubmit: (e) => {
                            e.preventDefault();
                            void requestLinkEmail(email)
                                .then((r) => {
                                if (r.debugCode)
                                    setDebug(r.debugCode);
                                push(t('codeSent'), 'success');
                            })
                                .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                        }, children: [_jsx("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value), placeholder: t('email'), required: true }), _jsx("button", { className: "button button-ghost", type: "submit", children: t('sendCode') })] }), _jsxs("form", { className: "create-form", onSubmit: (e) => {
                            e.preventDefault();
                            void confirmLinkEmail(email, emailCode)
                                .then(() => {
                                push(t('emailLinked'), 'success');
                                setEmailCode('');
                            })
                                .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                        }, children: [_jsx("input", { value: emailCode, onChange: (e) => setEmailCode(e.target.value), placeholder: t('verificationCode'), required: true }), _jsx("button", { className: "button", type: "submit", children: t('confirm') })] })] }), _jsxs(Section, { title: t('twoFactorEmail'), children: [_jsx("p", { className: "muted tiny", children: account?.twoFactorEmailEnabled ? t('twoFactorOn') : t('twoFactorOff') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => void requestEmail2faOtp()
                            .then((r) => {
                            if (r.debugCode)
                                setDebug(r.debugCode);
                            push(t('codeSent'), 'success');
                        })
                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('sendCode') }), _jsxs("form", { className: "create-form", onSubmit: (e) => {
                            e.preventDefault();
                            void setEmail2fa(true, twoFaCode)
                                .then(() => {
                                push(t('twoFactorOn'), 'success');
                                setAccount((a) => ({ ...a, twoFactorEmailEnabled: true }));
                            })
                                .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                        }, children: [_jsx("input", { value: twoFaCode, onChange: (e) => setTwoFaCode(e.target.value), placeholder: t('verificationCode') }), _jsx("button", { className: "button", type: "submit", children: t('enable2fa') })] }), account?.twoFactorEmailEnabled ? (_jsx("button", { type: "button", className: "button button-ghost", onClick: () => void setEmail2fa(false).then(() => {
                            setAccount((a) => ({ ...a, twoFactorEmailEnabled: false }));
                            push(t('twoFactorOff'), 'success');
                        }), children: t('disable2fa') })) : null] }), _jsx(Section, { title: t('country'), children: _jsxs("form", { className: "create-form", onSubmit: (e) => {
                        e.preventDefault();
                        void setAccountCountry(country)
                            .then(() => push(t('changesSaved'), 'success'))
                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                    }, children: [_jsx("input", { value: country, onChange: (e) => setCountry(e.target.value.toUpperCase()), maxLength: 2, minLength: 2 }), _jsx("button", { className: "button", type: "submit", children: t('save') })] }) }), _jsxs(Section, { title: t('sessions'), children: [(account?.sessions || []).map((s) => (_jsxs("div", { className: "list-row", children: [_jsxs("span", { className: "muted tiny", children: [s.deviceId, " \u00B7 ", new Date(s.createdAt).toLocaleString()] }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => void revokeSession(s.id)
                                    .then(() => fetchAccount().then(setAccount))
                                    .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('revoke') })] }, s.id))), !account?.sessions?.length ? _jsx("p", { className: "muted", children: t('noSessions') }) : null] })] }));
}
export function PrivacySettingsPage() {
    const { t } = useI18n();
    const { push } = useToast();
    const [isPrivate, setIsPrivate] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        void import('@/api/social').then(({ fetchMyProfile }) => fetchMyProfile().then((p) => setIsPrivate(Boolean(p.isPrivate))));
    }, []);
    return (_jsxs("div", { className: "settings-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('privacySettings') }), _jsx(Link, { to: "/settings", className: "button button-ghost button-compact", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsxs(Section, { title: t('accountPrivacy'), children: [_jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: isPrivate, onChange: (e) => {
                                    const next = e.target.checked;
                                    setIsPrivate(next);
                                    void import('@/api/social')
                                        .then(({ updateMyProfile }) => updateMyProfile({ isPrivate: next }))
                                        .then(() => push(t('changesSaved'), 'success'))
                                        .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                                } }), t('privateAccount')] }), _jsx("p", { className: "muted tiny", children: t('privateAccountHint') })] })] }));
}
export function BlockedUsersPage() {
    const { t } = useI18n();
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    async function reload() {
        setLoading(true);
        try {
            setItems(await fetchBlockedUsers());
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void reload();
    }, []);
    if (loading)
        return _jsx(PageLoader, {});
    return (_jsxs("div", { className: "settings-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('blockedUsers') }), _jsx(Link, { to: "/settings", className: "button button-ghost button-compact", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, !items.length ? _jsx(EmptyState, { title: t('emptyBlocked') }) : null, items.map((u) => (_jsxs("div", { className: "list-row", children: [_jsxs(Link, { to: `/u/${u.username}`, children: ["@", u.username] }), _jsx("button", { type: "button", className: "button button-compact", onClick: () => {
                            if (!window.confirm(t('confirmUnblock')))
                                return;
                            void unblockUser(u.id).then(() => reload());
                        }, children: t('unblock') })] }, u.id)))] }));
}
export function CloseFriendsPage() {
    const { t } = useI18n();
    const [friends, setFriends] = useState([]);
    const [candidates, setCandidates] = useState([]);
    const [error, setError] = useState('');
    async function reload() {
        try {
            setFriends(await fetchCloseFriends());
            setCandidates(await fetchCloseFriendCandidates());
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    useEffect(() => {
        void reload();
    }, []);
    return (_jsxs("div", { className: "settings-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('closeFriends') }), _jsx(Link, { to: "/settings", className: "button button-ghost button-compact", children: t('back') })] }), _jsx("p", { className: "muted tiny", children: t('closeFriendsHint') }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsxs(Section, { title: t('closeFriends'), children: [!friends.length ? _jsx(EmptyState, { title: t('emptyCloseFriends') }) : null, friends.map((u) => (_jsxs("div", { className: "list-row", children: [_jsxs(Link, { to: `/u/${u.username}`, children: ["@", u.username] }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => void removeCloseFriend(u.id).then(reload), children: t('remove') })] }, u.id)))] }), _jsxs(Section, { title: t('addCloseFriend'), children: [candidates.map((u) => (_jsxs("div", { className: "list-row", children: [_jsxs("span", { children: ["@", u.username] }), _jsx("button", { type: "button", className: "button button-compact", onClick: () => void addCloseFriend(u.id).then(reload), children: t('add') })] }, u.id))), !candidates.length ? _jsx("p", { className: "muted", children: t('noCandidates') }) : null] })] }));
}
export function InterestsSettingsPage() {
    const { t } = useI18n();
    const { push } = useToast();
    const [keys, setKeys] = useState([]);
    const [catalog, setCatalog] = useState([]);
    const [feedMode, setFeedMode] = useState('personalized');
    const [personalization, setPersonalization] = useState(true);
    const [inferred, setInferred] = useState([]);
    const [error, setError] = useState('');
    function loadInferred() {
        void fetchInferredInterests()
            .then((row) => setInferred(row.inferred || []))
            .catch(() => undefined);
    }
    useEffect(() => {
        void fetchAccount().then((a) => {
            setKeys(a.interests || []);
            setCatalog(a.interestCatalog || []);
        });
        void fetchRecommendationPreferences()
            .then((pref) => {
            setFeedMode(pref.feedMode);
            setPersonalization(pref.personalizationEnabled !== false);
        })
            .catch(() => undefined);
        loadInferred();
    }, []);
    function toggle(k) {
        setKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
    }
    return (_jsxs("div", { className: "settings-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('interests') }), _jsx(Link, { to: "/settings", className: "button button-ghost button-compact", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsx("div", { className: "interest-chips", children: catalog.map((k) => (_jsx("button", { type: "button", className: `chip ${keys.includes(k) ? 'active' : ''}`, onClick: () => toggle(k), children: t(`interest_${k}`) || k }, k))) }), _jsx("button", { type: "button", className: "button", onClick: () => void setInterests(keys)
                    .then(() => push(t('changesSaved'), 'success'))
                    .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('save') }), _jsxs("section", { className: "panel-block", children: [_jsx("h2", { children: t('feedMode') }), _jsxs("label", { className: "list-row", children: [_jsx("input", { type: "checkbox", checked: personalization, onChange: () => {
                                    const next = !personalization;
                                    setPersonalization(next);
                                    void saveRecommendationPreferences(feedMode, next).catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                                } }), _jsx("span", { children: t('personalizationOn') })] }), _jsxs("label", { className: "list-row", children: [_jsx("input", { type: "radio", name: "feedMode", checked: feedMode === 'personalized', onChange: () => {
                                    setFeedMode('personalized');
                                    void saveRecommendationPreferences('personalized').catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                                } }), _jsx("span", { children: t('feedPersonalized') })] }), _jsxs("label", { className: "list-row", children: [_jsx("input", { type: "radio", name: "feedMode", checked: feedMode === 'following_chronological', onChange: () => {
                                    setFeedMode('following_chronological');
                                    void saveRecommendationPreferences('following_chronological').catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                                } }), _jsx("span", { children: t('feedChronological') })] }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => void resetRecommendations()
                            .then(() => push(t('recommendationsCleared'), 'success'))
                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('resetRecommendations') }), _jsx("h2", { children: t('inferredInterests') }), !inferred.length ? _jsx("p", { className: "muted", children: t('optional') }) : null, inferred.map((row) => (_jsxs("div", { className: "list-row", children: [_jsxs("span", { children: [t(`interest_${row.key}`), " \u00B7 ", row.strength] }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => void forgetInferredInterest(row.key)
                                    .then(() => loadInferred())
                                    .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('removeInterest') })] }, `${row.polarity}-${row.key}`)))] })] }));
}
export function BusinessSettingsPage() {
    const { t, locale } = useI18n();
    const { push } = useToast();
    const navigate = useNavigate();
    const [categories, setCategories] = useState([]);
    const [biz, setBiz] = useState(null);
    const [categoryKey, setCategoryKey] = useState('retail');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [confirmPersonal, setConfirmPersonal] = useState(false);
    useEffect(() => {
        void fetchBusinessCategories().then(setCategories);
        void fetchMyBusiness()
            .then((b) => {
            setBiz(b);
            if (b.businessProfile?.categoryKey)
                setCategoryKey(b.businessProfile.categoryKey);
        })
            .catch(() => undefined);
    }, []);
    async function onSwitch(e) {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await switchToBusiness({ categoryKey });
            push(t('switchedToBusiness'), 'success');
            navigate('/settings', { replace: true });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function onSwitchPersonal() {
        setBusy(true);
        setError('');
        try {
            await switchToPersonal();
            push(t('switchedToPersonal'), 'success');
            navigate('/settings', { replace: true });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
            setConfirmPersonal(false);
        }
    }
    const isBusiness = biz?.accountType === 'business';
    return (_jsxs("div", { className: "settings-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: isBusiness ? t('switchToPersonal') : t('switchToBusiness') }), _jsx(Link, { to: "/settings", className: "button button-ghost button-compact", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, isBusiness ? (_jsxs(Section, { title: t('switchToPersonal'), children: [_jsx("p", { className: "muted", children: t('switchToPersonalHint') }), !confirmPersonal ? (_jsx("button", { type: "button", className: "button", disabled: busy, onClick: () => setConfirmPersonal(true), children: t('switchToPersonal') })) : (_jsxs("div", { className: "confirm-box", children: [_jsx("p", { children: t('confirmSwitchToPersonal') }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: "button", disabled: busy, onClick: () => void onSwitchPersonal(), children: t('confirm') }), _jsx("button", { type: "button", className: "button button-ghost", disabled: busy, onClick: () => setConfirmPersonal(false), children: t('cancel') })] })] }))] })) : (_jsxs("form", { className: "create-form", onSubmit: (e) => void onSwitch(e), children: [_jsx("p", { className: "muted", children: t('businessPickCategory') }), _jsxs("label", { className: "field-label", children: [t('businessCategory'), _jsx("select", { value: categoryKey, onChange: (e) => setCategoryKey(e.target.value), required: true, children: categories.map((c) => (_jsx("option", { value: c.key, children: c.label?.[locale] || c.label?.en || c.key }, c.key))) })] }), _jsx("button", { className: "button", type: "submit", disabled: busy || !categoryKey, children: t('switchToBusiness') })] }))] }));
}
export function VerificationSettingsPage() {
    const { t } = useI18n();
    const { push } = useToast();
    const [status, setStatus] = useState(null);
    const [track, setTrack] = useState('individual_seller');
    const [regNo, setRegNo] = useState('');
    const [nationalId, setNationalId] = useState('');
    const [applicantName, setApplicantName] = useState('');
    const [docs, setDocs] = useState([]);
    const [attested, setAttested] = useState(false);
    const [error, setError] = useState('');
    const fileRef = useRef(null);
    const pendingDocType = useRef('license');
    useEffect(() => {
        void fetchVerificationStatus().then(setStatus);
    }, []);
    async function addDoc(docType, file) {
        const buf = await file.arrayBuffer();
        const hashBuf = await crypto.subtle.digest('SHA-256', buf);
        const contentHash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
        const mediaId = await uploadMediaFile(file, 'verification');
        setDocs((prev) => [...prev.filter((d) => d.docType !== docType), { docType, mediaId, contentHash }]);
    }
    return (_jsxs("div", { className: "settings-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('businessVerification') }), _jsx(Link, { to: "/settings", className: "button button-ghost button-compact", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsxs("p", { className: "muted", children: [t('verificationStatus'), ":", ' ', status?.isVerified ? 'approved' : status?.request?.status || 'not_submitted'] }), status?.isVerified ? _jsxs("p", { className: "verified-badge", children: ["\u2713 ", t('verified')] }) : null, status?.request?.adminNote ? _jsx("p", { className: "auth-error", children: status.request.adminNote }) : null, !status?.isVerified ? (_jsxs("form", { className: "create-form", onSubmit: (e) => {
                    e.preventDefault();
                    void submitVerification({
                        track,
                        registrationNumber: track === 'licensed_business' ? regNo : undefined,
                        nationalId: track === 'individual_seller' ? nationalId : undefined,
                        applicantName,
                        documents: docs,
                        attested,
                        categoryKey: status?.categoryKey
                    })
                        .then((r) => {
                        push(t('verificationSubmitted'), 'success');
                        setStatus((s) => ({ ...s, request: r }));
                    })
                        .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                }, children: [_jsxs("select", { value: track, onChange: (e) => setTrack(e.target.value), children: [_jsx("option", { value: "licensed_business", children: t('trackLicensed') }), _jsx("option", { value: "individual_seller", children: t('trackIndividual') })] }), _jsx("input", { value: applicantName, onChange: (e) => setApplicantName(e.target.value), placeholder: t('applicantName') }), track === 'licensed_business' ? (_jsx("input", { value: regNo, onChange: (e) => setRegNo(e.target.value), placeholder: t('registrationNumber'), required: true })) : (_jsx("input", { value: nationalId, onChange: (e) => setNationalId(e.target.value), placeholder: t('nationalId'), required: true })), _jsx("div", { className: "create-media-actions", children: (track === 'licensed_business' ? ['license'] : ['national_id', 'residency', 'selfie']).map((docType) => (_jsxs("button", { type: "button", className: "button button-ghost button-compact", onClick: () => {
                                pendingDocType.current = docType;
                                fileRef.current?.click();
                            }, children: [docType, docs.some((d) => d.docType === docType) ? ' ✓' : ''] }, docType))) }), _jsx("input", { ref: fileRef, className: "sr-only", type: "file", accept: "image/*,application/pdf", capture: "environment", onChange: (e) => {
                            const f = e.target.files?.[0];
                            if (f)
                                void addDoc(pendingDocType.current, f);
                            e.target.value = '';
                        } }), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: attested, onChange: (e) => setAttested(e.target.checked) }), t('attestAccuracy')] }), _jsx("button", { className: "button", type: "submit", disabled: !attested || !docs.length, children: t('submitVerification') })] })) : null] }));
}
