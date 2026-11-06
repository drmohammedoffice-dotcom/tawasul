import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { login, register } from '@/api/client';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { PushBridge } from './PushBridge';
import { useI18n } from '@/i18n/I18nProvider';
import { AppModeProvider, useAppMode } from './focus/AppModeContext';
import { ModeToggle } from './focus/ModeToggle';
import { FocusShell } from './focus/FocusShell';
import { FocusChatsPage } from './focus/FocusChatsPage';
import { FocusCallsPage } from './focus/FocusCallsPage';
import { FocusContactsPage } from './focus/FocusContactsPage';
import { FocusSettingsPage } from './focus/FocusSettingsPage';
import { FocusNotificationsPage } from './focus/FocusNotificationsPage';
import { FocusStoragePage } from './focus/FocusStoragePage';
import { FocusAppearancePage } from './focus/FocusAppearancePage';
import { FocusDmPage } from './focus/FocusDmPage';
import { FocusCreateWizard } from './focus/FocusCreateWizard';
import { FocusChannelPage, FocusJoinChannelPage } from './focus/FocusChannelPage';
import { FocusGroupPage } from './focus/FocusGroupPage';
import { getOrCreateDeviceId } from '@/lib/session';
import { SessionExpiredError } from '@/lib/apiError';
import { FeedPage } from './social/FeedPage';
import { ExplorePage } from './social/ExplorePage';
import { CreatePostPage, NotificationsPage, SettingsPage } from './social/MiscPages';
import { PostDetailPage } from './social/PostDetailPage';
import { BlockedUsersPage, BusinessSettingsPage, CloseFriendsPage, InterestsSettingsPage, PrivacySettingsPage, SecuritySettingsPage, VerificationSettingsPage } from './social/AccountSettingsPages';
import { EditProfilePage } from './social/EditProfilePage';
import { HighlightCreatePage } from './social/HighlightCreatePage';
import { FollowListPage, MyProfilePage, UserProfilePage } from './social/ProfilePages';
import { BusinessCatalogPage, BusinessCatalogManagePage, BusinessCheckoutPage, BusinessInsightsPage, BusinessLinksPage, BusinessOrdersPage } from './social/BusinessStorePages';
import { PhoneAuthPanel } from './social/PhoneAuthPanel';
import { AdminVerificationPage } from './social/AdminVerificationPage';
import { AdminRecommendationsPage } from './social/AdminRecommendationsPage';
import { ArchivePage } from './social/ArchivePage';
import { ChannelDetailPage, ChannelsPage, GroupDetailPage, GroupsPage } from './social/GroupsChannels';
import { ReelsPage } from './social/ReelsPage';
import { SavedPage } from './social/SavedPage';
import { PageLoader } from './ui/States';
import { ToastProvider } from './ui/Toast';
import { IconArchive, IconBell, IconBookmark, IconChat, IconCompass, IconHome, IconLogout, IconMegaphone, IconMore, IconPlus, IconReels, IconSearch, IconSend, IconSettings, IconUser, IconUsers } from './ui/Icons';
import { UserAvatar } from './ui/UserAvatar';
import { fetchMyProfile, fetchNotifications } from '@/api/social';
import { listVaultAccounts, patchVaultProfile, saveLoginCredentials, upsertVaultAccount, vaultToSession } from '@/lib/accountVault';
import './styles.css';
import './social.css';
const ChatApp = lazy(() => import('./App').then((m) => ({ default: m.App })));
function isActive(path, to, match) {
    if (match)
        return match(path);
    return path === to || path.startsWith(`${to}/`);
}
function Shell({ children, onSwitchAccount }) {
    const location = useLocation();
    const { t, dir } = useI18n();
    const { session, logout } = useAuth();
    const [moreOpen, setMoreOpen] = useState(false);
    const [accountOpen, setAccountOpen] = useState(false);
    const [meAvatar, setMeAvatar] = useState(null);
    const [meName, setMeName] = useState(null);
    const [hasAlerts, setHasAlerts] = useState(false);
    const moreRef = useRef(null);
    const accountRef = useRef(null);
    const primary = [
        { to: '/feed', label: t('home'), icon: _jsx(IconHome, {}), match: (p) => p === '/' || p.startsWith('/feed') },
        {
            to: '/explore',
            label: t('explore'),
            icon: _jsx(IconCompass, {}),
            match: (p) => p.startsWith('/explore') || p.startsWith('/search')
        },
        { to: '/reels', label: t('reels'), icon: _jsx(IconReels, {}) },
        { to: '/messages', label: t('messages'), icon: _jsx(IconChat, {}) },
        { to: '/notifications', label: t('alerts'), icon: _jsx(IconBell, {}) },
        { to: '/profile', label: t('profile'), icon: _jsx(IconUser, {}) }
    ];
    const secondary = [
        { to: '/explore', label: t('explore'), icon: _jsx(IconCompass, {}) },
        { to: '/create', label: t('create'), icon: _jsx(IconPlus, {}) },
        { to: '/saved', label: t('saved'), icon: _jsx(IconBookmark, {}) },
        { to: '/archive', label: t('archive'), icon: _jsx(IconArchive, {}) },
        { to: '/notifications', label: t('alerts'), icon: _jsx(IconBell, {}) },
        { to: '/groups', label: t('groups'), icon: _jsx(IconUsers, {}) },
        { to: '/channels', label: t('channels'), icon: _jsx(IconMegaphone, {}) },
        { to: '/settings', label: t('settings'), icon: _jsx(IconSettings, {}) }
    ];
    // Floating glass dock: Home · Reels · DM · Search/Explore · Profile avatar
    const mobileTabs = [
        { ...primary[0], icon: _jsx(IconHome, { size: 22 }) },
        { ...primary[2], icon: _jsx(IconReels, { size: 22 }) },
        { to: '/messages', label: t('messages'), icon: _jsx(IconSend, { size: 22 }) },
        {
            to: '/explore',
            label: t('search'),
            icon: _jsx(IconSearch, { size: 22 }),
            match: (p) => p.startsWith('/explore') || p.startsWith('/search')
        },
        {
            to: '/profile',
            label: t('profile'),
            icon: (_jsx("span", { className: `dock-avatar${hasAlerts ? ' has-badge' : ''}`, children: _jsx(UserAvatar, { size: "sm", username: session?.user?.username, name: meName || session?.user?.username, avatarUrl: meAvatar }) })),
            match: (p) => p === '/profile' || p.startsWith('/profile/')
        }
    ];
    useEffect(() => {
        let cancelled = false;
        const onFocusRoute = location.pathname.startsWith('/focus');
        // Focus Mode: no social notification polling / badges.
        if (onFocusRoute) {
            setHasAlerts(false);
            void fetchMyProfile()
                .then((profile) => {
                if (cancelled)
                    return;
                setMeAvatar(profile?.avatarUrl ?? null);
                setMeName(profile?.displayName ?? null);
            })
                .catch(() => undefined);
            return () => {
                cancelled = true;
            };
        }
        void (async () => {
            try {
                const [profile, notes] = await Promise.all([fetchMyProfile(), fetchNotifications()]);
                if (cancelled)
                    return;
                setMeAvatar(profile?.avatarUrl ?? null);
                setMeName(profile?.displayName ?? null);
                setHasAlerts(Array.isArray(notes) && notes.some((n) => !n.readAt));
            }
            catch {
                /* ignore — dock still works with initials */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [location.pathname]);
    useEffect(() => {
        setMoreOpen(false);
        setAccountOpen(false);
    }, [location.pathname]);
    useEffect(() => {
        function onDoc(e) {
            const target = e.target;
            if (moreRef.current && !moreRef.current.contains(target))
                setMoreOpen(false);
            if (accountRef.current && !accountRef.current.contains(target))
                setAccountOpen(false);
        }
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);
    async function handleLogout() {
        setAccountOpen(false);
        await logout();
    }
    const { mode, isFocus } = useAppMode();
    const immersiveMode = location.pathname.startsWith('/reels')
        ? 'reels'
        : location.pathname.startsWith('/messages')
            ? 'messages'
            : location.pathname.startsWith('/explore')
                ? 'explore'
                : null;
    const isHome = location.pathname === '/feed' || location.pathname === '/';
    const isProfile = location.pathname === '/profile' ||
        location.pathname.startsWith('/u/') ||
        location.pathname.startsWith('/settings');
    const onFocusRoute = location.pathname.startsWith('/focus');
    const shellClass = [
        immersiveMode ? `social-shell immersive-${immersiveMode}` : 'social-shell',
        isFocus || onFocusRoute ? 'mode-focus' : 'mode-browse',
        onFocusRoute ? 'focus-route' : ''
    ]
        .filter(Boolean)
        .join(' ');
    return (_jsxs("div", { className: shellClass, dir: dir, children: [_jsxs("aside", { className: "social-sidebar", "aria-label": "Main", children: [_jsxs("div", { className: "sidebar-brand", children: [_jsx("span", { className: "brand-mark", children: t('brand') }), _jsx(ModeToggle, {})] }), _jsxs("nav", { className: "sidebar-nav", children: [primary.map((item) => (_jsxs(Link, { to: item.to, className: isActive(location.pathname, item.to, item.match) ? 'nav-item active' : 'nav-item', children: [_jsx("span", { className: "nav-icon", children: item.icon }), _jsx("span", { className: "nav-label", children: item.label })] }, item.to))), _jsx("div", { className: "nav-divider" }), secondary.map((item) => (_jsxs(Link, { to: item.to, className: isActive(location.pathname, item.to, item.match) ? 'nav-item active' : 'nav-item', children: [_jsx("span", { className: "nav-icon", children: item.icon }), _jsx("span", { className: "nav-label", children: item.label })] }, item.to)))] }), _jsxs("div", { className: "sidebar-account", ref: accountRef, children: [_jsxs("button", { type: "button", className: "account-trigger", "aria-expanded": accountOpen, onClick: () => setAccountOpen((v) => !v), children: [_jsx("span", { className: "avatar-circle", children: (session?.user?.username || '?').slice(0, 1).toUpperCase() }), _jsxs("span", { className: "account-meta", children: [_jsxs("strong", { children: ["@", session?.user?.username || 'user'] }), _jsx("span", { className: "muted", children: t('accountMenu') })] })] }), accountOpen ? (_jsxs("div", { className: "account-menu", role: "menu", children: [_jsxs(Link, { to: "/profile", className: "account-menu-item", role: "menuitem", children: [_jsx(IconUser, { size: 18 }), t('profile')] }), _jsxs(Link, { to: "/settings", className: "account-menu-item", role: "menuitem", children: [_jsx(IconSettings, { size: 18 }), t('settings')] }), onSwitchAccount ? (_jsxs("button", { type: "button", className: "account-menu-item", role: "menuitem", onClick: () => {
                                            setAccountOpen(false);
                                            onSwitchAccount();
                                        }, children: [_jsx(IconUsers, { size: 18 }), t('switchAccount')] })) : null, _jsxs("button", { type: "button", className: "account-menu-item danger", role: "menuitem", onClick: () => void handleLogout(), children: [_jsx(IconLogout, { size: 18 }), t('logout')] })] })) : null] })] }), _jsxs("div", { className: "social-column", children: [_jsxs("header", { className: "mobile-topbar", children: [_jsx("span", { className: "brand-mark", children: t('brand') }), _jsx(ModeToggle, {}), _jsxs("div", { className: "mobile-top-actions", children: [isHome || mode === 'browse' ? (_jsxs(_Fragment, { children: [_jsx(Link, { to: "/search", className: "icon-btn", "aria-label": t('search'), children: _jsx(IconSearch, { size: 20 }) }), _jsx(Link, { to: "/notifications", className: "icon-btn", "aria-label": t('alerts'), children: _jsx(IconBell, { size: 20 }) })] })) : null, isProfile ? (_jsxs("div", { className: "more-wrap", ref: moreRef, children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": t('more'), "aria-expanded": moreOpen, onClick: () => setMoreOpen((v) => !v), children: _jsx(IconMore, { size: 20 }) }), moreOpen ? (_jsxs("div", { className: "more-menu", role: "menu", children: [secondary.map((item) => (_jsxs(Link, { to: item.to, className: "more-menu-item", role: "menuitem", children: [item.icon, item.label] }, item.to))), onSwitchAccount ? (_jsxs("button", { type: "button", className: "more-menu-item", role: "menuitem", onClick: () => {
                                                            setMoreOpen(false);
                                                            onSwitchAccount();
                                                        }, children: [_jsx(IconUsers, { size: 18 }), t('switchAccount')] })) : null, _jsxs("button", { type: "button", className: "more-menu-item danger", role: "menuitem", onClick: () => void handleLogout(), children: [_jsx(IconLogout, { size: 18 }), t('logout')] })] })) : null] })) : null] })] }), _jsx("main", { className: "social-main page-enter", children: children }), _jsx("nav", { className: "bottom-nav", "aria-label": "Mobile", children: mobileTabs.map((item) => (_jsx(Link, { to: item.to, "aria-label": item.label, className: isActive(location.pathname, item.to, item.match)
                                ? 'bottom-nav-item active'
                                : 'bottom-nav-item', children: item.icon }, item.to))) })] })] }));
}
function AuthGate({ onAuthed, initialMode = 'login' }) {
    const { t, dir, locale, setLocale } = useI18n();
    const { authNotice, clearAuthNotice } = useAuth();
    const deviceId = useMemo(() => getOrCreateDeviceId(), []);
    const [mode, setMode] = useState(initialMode);
    const [authMethod, setAuthMethod] = useState('phone');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        setMode(initialMode);
    }, [initialMode]);
    useEffect(() => {
        if (authNotice === 'sessionExpired') {
            setError(t('sessionExpired'));
        }
    }, [authNotice, t]);
    async function submit(e) {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const username = String(form.get('username') ?? '').trim();
        const password = String(form.get('password') ?? '');
        setError('');
        clearAuthNotice();
        setBusy(true);
        try {
            const payload = mode === 'register'
                ? await register({ username, password, deviceId })
                : await login({ identifier: username, password, deviceId });
            const save = window.confirm(t('saveLoginPrompt'));
            if (save)
                saveLoginCredentials(username, password);
            onAuthed(payload);
        }
        catch (err) {
            if (err instanceof SessionExpiredError) {
                setError(t('sessionExpired'));
            }
            else {
                const msg = err instanceof Error ? err.message : t('errorGeneric');
                const network = /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
                setError(network ? t('networkError') : msg);
            }
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx("div", { className: "auth-wrap", dir: dir, lang: locale, children: _jsxs("div", { className: "auth-card", children: [_jsxs("div", { className: "auth-lang-bar", role: "group", "aria-label": t('language'), children: [_jsx("button", { type: "button", className: `button button-compact ${locale === 'ar' ? '' : 'button-ghost'}`, onClick: () => setLocale('ar'), children: t('arabic') }), _jsx("button", { type: "button", className: `button button-compact ${locale === 'en' ? '' : 'button-ghost'}`, onClick: () => setLocale('en'), children: "English" })] }), _jsx("span", { className: "brand-mark", children: t('brand') }), _jsx("h2", { children: mode === 'login' ? t('welcomeBack') : t('createAccount') }), _jsxs("div", { className: "inline-actions auth-method-tabs", children: [_jsx("button", { type: "button", className: `button button-compact ${authMethod === 'phone' ? '' : 'button-ghost'}`, onClick: () => setAuthMethod('phone'), children: t('continueWithPhone') }), _jsx("button", { type: "button", className: `button button-compact ${authMethod === 'password' ? '' : 'button-ghost'}`, onClick: () => setAuthMethod('password'), children: t('continueWithPassword') })] }), authMethod === 'phone' ? (_jsx(PhoneAuthPanel, { mode: mode, onAuthed: onAuthed, onToggleMode: () => setMode(mode === 'login' ? 'register' : 'login') })) : (_jsxs("form", { onSubmit: (e) => void submit(e), children: [_jsx("p", { className: "muted", children: mode === 'login' ? t('loginHint') : t('registerHint') }), _jsxs("label", { className: "field", children: [_jsx("span", { children: t('username') }), _jsx("input", { name: "username", autoComplete: "username", required: true, minLength: 1, maxLength: 30, pattern: "[A-Za-z0-9._]+", disabled: busy })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: t('password') }), _jsx("input", { name: "password", type: "password", autoComplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minLength: 8, disabled: busy })] }), error ? _jsx("p", { className: "auth-error", children: error }) : null, _jsx("button", { className: "button", type: "submit", disabled: busy, children: busy ? t('loading') : mode === 'login' ? t('login') : t('register') }), _jsx("button", { className: "button button-ghost", type: "button", disabled: busy, onClick: () => {
                                setMode(mode === 'login' ? 'register' : 'login');
                                setError('');
                            }, children: mode === 'login' ? t('needAccount') : t('haveAccount') })] }))] }) }));
}
function SocialApp() {
    const { session, setSession, bootstrapping } = useAuth();
    const { t } = useI18n();
    const [authOverlay, setAuthOverlay] = useState(null);
    const [switchOpen, setSwitchOpen] = useState(false);
    const [vault, setVault] = useState(() => listVaultAccounts());
    useEffect(() => {
        function onAuthIntent(e) {
            const mode = e.detail?.mode;
            if (session)
                upsertVaultAccount(session);
            setVault(listVaultAccounts());
            setAuthOverlay(mode === 'register' ? 'register' : 'login');
            setSession(null);
            setSwitchOpen(false);
        }
        window.addEventListener('securechat:auth-intent', onAuthIntent);
        return () => window.removeEventListener('securechat:auth-intent', onAuthIntent);
    }, [session, setSession]);
    function rememberSession(payload) {
        upsertVaultAccount(payload);
        setVault(listVaultAccounts());
        setSession(payload);
        setAuthOverlay(null);
        setSwitchOpen(false);
        void fetchMyProfile()
            .then((p) => {
            patchVaultProfile(payload.user.id, {
                avatarUrl: p.avatarUrl,
                displayName: p.displayName,
                username: p.username
            });
            setVault(listVaultAccounts());
        })
            .catch(() => undefined);
    }
    if (bootstrapping) {
        return _jsx(PageLoader, {});
    }
    if (!session || authOverlay) {
        return (_jsx(AuthGate, { initialMode: authOverlay === 'register' ? 'register' : 'login', onAuthed: rememberSession }));
    }
    return (_jsxs(Shell, { onSwitchAccount: () => {
            setVault(listVaultAccounts());
            setSwitchOpen(true);
        }, children: [switchOpen ? (_jsx("div", { className: "sheet-backdrop", onClick: () => setSwitchOpen(false), children: _jsxs("div", { className: "sheet wa-share-sheet account-switch-sheet", onClick: (e) => e.stopPropagation(), children: [_jsx("h3", { children: t('switchAccount') }), _jsx("ul", { className: "account-switch-list", children: vault.map((a) => (_jsx("li", { children: _jsxs("button", { type: "button", className: `list-row account-switch-row ${a.userId === session.user.id ? 'is-active' : ''}`, onClick: () => {
                                        if (a.userId === session.user.id) {
                                            setSwitchOpen(false);
                                            return;
                                        }
                                        upsertVaultAccount(session);
                                        setSession(vaultToSession(a));
                                        setVault(listVaultAccounts());
                                        setSwitchOpen(false);
                                    }, children: [_jsx(UserAvatar, { size: "md", name: a.displayName || a.username, username: a.username, avatarUrl: a.avatarUrl }), _jsxs("span", { className: "account-switch-meta", children: [_jsx("strong", { children: a.displayName || a.username }), _jsxs("span", { className: "muted", children: ["@", a.username] }), a.userId === session.user.id ? (_jsx("span", { className: "muted tiny", children: t('currentAccount') })) : null] })] }) }, a.userId))) }), _jsx("button", { type: "button", className: "button", onClick: () => {
                                setSwitchOpen(false);
                                setAuthOverlay('login');
                                setSession(null);
                            }, children: t('loginExistingAccount') }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => {
                                setSwitchOpen(false);
                                setAuthOverlay('register');
                                setSession(null);
                            }, children: t('createNewAccount') }), _jsx("button", { type: "button", className: "button button-ghost", onClick: () => setSwitchOpen(false), children: t('cancel') })] }) })) : null, _jsx(Suspense, { fallback: _jsx(PageLoader, {}), children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: "/feed", replace: true }) }), _jsx(Route, { path: "/feed", element: _jsx(FeedPage, {}) }), _jsx(Route, { path: "/explore", element: _jsx(ExplorePage, {}) }), _jsx(Route, { path: "/reels", element: _jsx(ReelsPage, {}) }), _jsx(Route, { path: "/search", element: _jsx(Navigate, { to: "/explore", replace: true }) }), _jsx(Route, { path: "/saved", element: _jsx(SavedPage, {}) }), _jsx(Route, { path: "/messages/*", element: _jsx(ChatApp, {}) }), _jsxs(Route, { path: "/focus", element: _jsx(FocusShell, {}), children: [_jsx(Route, { index: true, element: _jsx(Navigate, { to: "chats", replace: true }) }), _jsx(Route, { path: "chats", element: _jsx(FocusChatsPage, {}) }), _jsx(Route, { path: "chats/dm/:peerId", element: _jsx(FocusDmPage, {}) }), _jsx(Route, { path: "chats/group/:groupId", element: _jsx(FocusGroupPage, {}) }), _jsx(Route, { path: "chats/channel/:channelId", element: _jsx(FocusChannelPage, {}) }), _jsx(Route, { path: "create/:kind", element: _jsx(FocusCreateWizard, {}) }), _jsx(Route, { path: "join/:inviteSlug", element: _jsx(FocusJoinChannelPage, {}) }), _jsx(Route, { path: "contacts", element: _jsx(FocusContactsPage, {}) }), _jsx(Route, { path: "calls", element: _jsx(FocusCallsPage, {}) }), _jsx(Route, { path: "settings", element: _jsx(FocusSettingsPage, {}) }), _jsx(Route, { path: "settings/notifications", element: _jsx(FocusNotificationsPage, {}) }), _jsx(Route, { path: "settings/storage", element: _jsx(FocusStoragePage, {}) }), _jsx(Route, { path: "settings/appearance", element: _jsx(FocusAppearancePage, {}) })] }), _jsx(Route, { path: "/groups", element: _jsx(GroupsPage, {}) }), _jsx(Route, { path: "/groups/:groupId", element: _jsx(GroupDetailPage, {}) }), _jsx(Route, { path: "/channels", element: _jsx(ChannelsPage, {}) }), _jsx(Route, { path: "/channels/:channelId", element: _jsx(ChannelDetailPage, {}) }), _jsx(Route, { path: "/notifications", element: _jsx(NotificationsPage, {}) }), _jsx(Route, { path: "/create", element: _jsx(CreatePostPage, {}) }), _jsx(Route, { path: "/p/:postId", element: _jsx(PostDetailPage, {}) }), _jsx(Route, { path: "/profile", element: _jsx(MyProfilePage, {}) }), _jsx(Route, { path: "/profile/edit", element: _jsx(EditProfilePage, {}) }), _jsx(Route, { path: "/profile/highlights/new", element: _jsx(HighlightCreatePage, {}) }), _jsx(Route, { path: "/profile/orders", element: _jsx(BusinessOrdersPage, {}) }), _jsx(Route, { path: "/profile/catalog", element: _jsx(BusinessCatalogManagePage, {}) }), _jsx(Route, { path: "/profile/insights", element: _jsx(BusinessInsightsPage, {}) }), _jsx(Route, { path: "/profile/links", element: _jsx(BusinessLinksPage, {}) }), _jsx(Route, { path: "/u/:idOrUsername", element: _jsx(UserProfilePage, {}) }), _jsx(Route, { path: "/u/:idOrUsername/store", element: _jsx(BusinessCatalogPage, {}) }), _jsx(Route, { path: "/u/:idOrUsername/store/checkout", element: _jsx(BusinessCheckoutPage, {}) }), _jsx(Route, { path: "/u/:idOrUsername/links", element: _jsx(BusinessLinksPage, {}) }), _jsx(Route, { path: "/u/:idOrUsername/followers", element: _jsx(FollowListPage, { mode: "followers" }) }), _jsx(Route, { path: "/u/:idOrUsername/following", element: _jsx(FollowListPage, { mode: "following" }) }), _jsx(Route, { path: "/settings", element: _jsx(SettingsPage, {}) }), _jsx(Route, { path: "/settings/security", element: _jsx(SecuritySettingsPage, {}) }), _jsx(Route, { path: "/settings/privacy", element: _jsx(PrivacySettingsPage, {}) }), _jsx(Route, { path: "/settings/blocked", element: _jsx(BlockedUsersPage, {}) }), _jsx(Route, { path: "/settings/close-friends", element: _jsx(CloseFriendsPage, {}) }), _jsx(Route, { path: "/settings/interests", element: _jsx(InterestsSettingsPage, {}) }), _jsx(Route, { path: "/settings/business", element: _jsx(BusinessSettingsPage, {}) }), _jsx(Route, { path: "/settings/verification", element: _jsx(VerificationSettingsPage, {}) }), _jsx(Route, { path: "/settings/admin/verification", element: _jsx(AdminVerificationPage, {}) }), _jsx(Route, { path: "/settings/admin/recommendations", element: _jsx(AdminRecommendationsPage, {}) }), _jsx(Route, { path: "/archive", element: _jsx(ArchivePage, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/feed", replace: true }) })] }) })] }));
}
export function SocialRoot() {
    return (_jsxs(AuthProvider, { children: [_jsx(PushBridge, {}), _jsx(ToastProvider, { children: _jsx(AppModeProvider, { children: _jsx(SocialApp, {}) }) })] }));
}
