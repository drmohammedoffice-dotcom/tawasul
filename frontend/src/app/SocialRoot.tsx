import { FormEvent, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { login, register, verifyMfaLogin } from '@/api/client';
import type { AuthPayload } from '@/types/api';
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
import {
  BlockedUsersPage,
  BusinessSettingsPage,
  CloseFriendsPage,
  InterestsSettingsPage,
  PrivacySettingsPage,
  SecuritySettingsPage,
  VerificationSettingsPage
} from './social/AccountSettingsPages';
import { EditProfilePage } from './social/EditProfilePage';
import { HighlightCreatePage } from './social/HighlightCreatePage';
import { FollowListPage, MyProfilePage, UserProfilePage } from './social/ProfilePages';
import {
  BusinessCatalogPage,
  BusinessCatalogManagePage,
  BusinessCheckoutPage,
  BusinessInsightsPage,
  BusinessLinksPage,
  BusinessOrdersPage
} from './social/BusinessStorePages';
import { PhoneAuthPanel } from './social/PhoneAuthPanel';
import { AdminVerificationPage } from './social/AdminVerificationPage';
import { AdminRecommendationsPage } from './social/AdminRecommendationsPage';
import { AdminModerationPage } from './social/AdminModerationPage';
import { AccountModerationPage } from './social/AccountModerationPage';
import { ArchivePage } from './social/ArchivePage';
import {
  ChannelDetailPage,
  ChannelsPage,
  GroupDetailPage,
  GroupsPage
} from './social/GroupsChannels';
import { ReelsPage } from './social/ReelsPage';
import { SavedPage } from './social/SavedPage';
import { PageLoader } from './ui/States';
import { ToastProvider } from './ui/Toast';
import {
  IconArchive,
  IconBell,
  IconBookmark,
  IconChat,
  IconCompass,
  IconHome,
  IconLogout,
  IconMegaphone,
  IconMore,
  IconPlus,
  IconReels,
  IconSearch,
  IconSend,
  IconSettings,
  IconUser,
  IconUsers
} from './ui/Icons';
import { UserAvatar } from './ui/UserAvatar';
import { fetchMyProfile, fetchNotifications } from '@/api/social';
import {
  listVaultAccounts,
  patchVaultProfile,
  saveLoginCredentials,
  upsertVaultAccount,
  vaultToSession,
  type VaultAccount
} from '@/lib/accountVault';
import './styles.css';
import './social.css';

const ChatApp = lazy(() => import('./App').then((m) => ({ default: m.App })));

type NavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  match?: (path: string) => boolean;
};

function isActive(path: string, to: string, match?: (path: string) => boolean) {
  if (match) return match(path);
  return path === to || path.startsWith(`${to}/`);
}

function Shell({
  children,
  onSwitchAccount
}: {
  children: React.ReactNode;
  onSwitchAccount?: () => void;
}) {
  const location = useLocation();
  const { t, dir } = useI18n();
  const { session, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [meAvatar, setMeAvatar] = useState<string | null>(null);
  const [meName, setMeName] = useState<string | null>(null);
  const [hasAlerts, setHasAlerts] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const primary: NavItem[] = [
    { to: '/feed', label: t('home'), icon: <IconHome />, match: (p) => p === '/' || p.startsWith('/feed') },
    {
      to: '/explore',
      label: t('explore'),
      icon: <IconCompass />,
      match: (p) => p.startsWith('/explore') || p.startsWith('/search')
    },
    { to: '/reels', label: t('reels'), icon: <IconReels /> },
    { to: '/messages', label: t('messages'), icon: <IconChat /> },
    { to: '/notifications', label: t('alerts'), icon: <IconBell /> },
    { to: '/profile', label: t('profile'), icon: <IconUser /> }
  ];

  const secondary: NavItem[] = [
    { to: '/explore', label: t('explore'), icon: <IconCompass /> },
    { to: '/create', label: t('create'), icon: <IconPlus /> },
    { to: '/saved', label: t('saved'), icon: <IconBookmark /> },
    { to: '/archive', label: t('archive'), icon: <IconArchive /> },
    { to: '/notifications', label: t('alerts'), icon: <IconBell /> },
    { to: '/groups', label: t('groups'), icon: <IconUsers /> },
    { to: '/channels', label: t('channels'), icon: <IconMegaphone /> },
    { to: '/settings', label: t('settings'), icon: <IconSettings /> }
  ];

  // Floating glass dock: Home · Reels · DM · Search/Explore · Profile avatar
  const mobileTabs: NavItem[] = [
    { ...primary[0]!, icon: <IconHome size={22} /> },
    { ...primary[2]!, icon: <IconReels size={22} /> },
    { to: '/messages', label: t('messages'), icon: <IconSend size={22} /> },
    {
      to: '/explore',
      label: t('search'),
      icon: <IconSearch size={22} />,
      match: (p) => p.startsWith('/explore') || p.startsWith('/search')
    },
    {
      to: '/profile',
      label: t('profile'),
      icon: (
        <span className={`dock-avatar${hasAlerts ? ' has-badge' : ''}`}>
          <UserAvatar
            size="sm"
            username={session?.user?.username}
            name={meName || session?.user?.username}
            avatarUrl={meAvatar}
          />
        </span>
      ),
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
          if (cancelled) return;
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
        if (cancelled) return;
        setMeAvatar(profile?.avatarUrl ?? null);
        setMeName(profile?.displayName ?? null);
        setHasAlerts(Array.isArray(notes) && notes.some((n: { readAt?: string | null }) => !n.readAt));
      } catch {
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
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (moreRef.current && !moreRef.current.contains(target)) setMoreOpen(false);
      if (accountRef.current && !accountRef.current.contains(target)) setAccountOpen(false);
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
  const isProfile =
    location.pathname === '/profile' ||
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

  return (
    <div className={shellClass} dir={dir}>
      <aside className="social-sidebar" aria-label="Main">
        <div className="sidebar-brand">
          <span className="brand-mark">{t('brand')}</span>
          <ModeToggle />
        </div>
        <nav className="sidebar-nav">
          {primary.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={
                isActive(location.pathname, item.to, item.match) ? 'nav-item active' : 'nav-item'
              }
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
          <div className="nav-divider" />
          {secondary.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={
                isActive(location.pathname, item.to, item.match) ? 'nav-item active' : 'nav-item'
              }
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-account" ref={accountRef}>
          <button
            type="button"
            className="account-trigger"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((v) => !v)}
          >
            <span className="avatar-circle">
              {(session?.user?.username || '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="account-meta">
              <strong>@{session?.user?.username || 'user'}</strong>
              <span className="muted">{t('accountMenu')}</span>
            </span>
          </button>
          {accountOpen ? (
            <div className="account-menu" role="menu">
              <Link to="/profile" className="account-menu-item" role="menuitem">
                <IconUser size={18} />
                {t('profile')}
              </Link>
              <Link to="/settings" className="account-menu-item" role="menuitem">
                <IconSettings size={18} />
                {t('settings')}
              </Link>
              {onSwitchAccount ? (
                <button
                  type="button"
                  className="account-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false);
                    onSwitchAccount();
                  }}
                >
                  <IconUsers size={18} />
                  {t('switchAccount')}
                </button>
              ) : null}
              <button
                type="button"
                className="account-menu-item danger"
                role="menuitem"
                onClick={() => void handleLogout()}
              >
                <IconLogout size={18} />
                {t('logout')}
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="social-column">
        <header className="mobile-topbar">
          <span className="brand-mark">{t('brand')}</span>
          <ModeToggle />
          <div className="mobile-top-actions">
            {isHome || mode === 'browse' ? (
              <>
                <Link to="/search" className="icon-btn" aria-label={t('search')}>
                  <IconSearch size={20} />
                </Link>
                <Link to="/notifications" className="icon-btn" aria-label={t('alerts')}>
                  <IconBell size={20} />
                </Link>
              </>
            ) : null}
            {isProfile ? (
              <div className="more-wrap" ref={moreRef}>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('more')}
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  <IconMore size={20} />
                </button>
                {moreOpen ? (
                  <div className="more-menu" role="menu">
                    {secondary.map((item) => (
                      <Link key={item.to} to={item.to} className="more-menu-item" role="menuitem">
                        {item.icon}
                        {item.label}
                      </Link>
                    ))}
                    {onSwitchAccount ? (
                      <button
                        type="button"
                        className="more-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false);
                          onSwitchAccount();
                        }}
                      >
                        <IconUsers size={18} />
                        {t('switchAccount')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="more-menu-item danger"
                      role="menuitem"
                      onClick={() => void handleLogout()}
                    >
                      <IconLogout size={18} />
                      {t('logout')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        <main className="social-main page-enter">{children}</main>

        <nav className="bottom-nav" aria-label="Mobile">
          {mobileTabs.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={
                isActive(location.pathname, item.to, item.match)
                  ? 'bottom-nav-item active'
                  : 'bottom-nav-item'
              }
            >
              {item.icon}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function AuthGate({
  onAuthed,
  initialMode = 'login'
}: {
  onAuthed: (s: AuthPayload) => void;
  initialMode?: 'login' | 'register';
}) {
  const { t, dir, locale, setLocale } = useI18n();
  const { authNotice, clearAuthNotice } = useAuth();
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [authMethod, setAuthMethod] = useState<'password' | 'phone'>('phone');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (authNotice === 'sessionExpired') {
      setError(t('sessionExpired'));
    }
  }, [authNotice, t]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError('');
    clearAuthNotice();
    setBusy(true);
    try {
      if (mfaToken) {
        const code = String(form.get('mfaCode') ?? '').trim();
        const payload = await verifyMfaLogin({ mfaToken, code, deviceId });
        setMfaToken(null);
        onAuthed(payload);
        return;
      }
      const username = String(form.get('username') ?? '').trim();
      const password = String(form.get('password') ?? '');
      if (mode === 'register') {
        const payload = await register({ username, password, deviceId });
        const save = window.confirm(t('saveLoginPrompt'));
        if (save) saveLoginCredentials(username, password);
        onAuthed(payload);
        return;
      }
      const result = await login({ identifier: username, password, deviceId });
      if ('requiresMfa' in result && result.requiresMfa) {
        setMfaToken(result.mfaToken);
        setError(t('mfaRequired'));
        return;
      }
      const save = window.confirm(t('saveLoginPrompt'));
      if (save) saveLoginCredentials(username, password);
      onAuthed(result);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setError(t('sessionExpired'));
      } else {
        const msg = err instanceof Error ? err.message : t('errorGeneric');
        const network =
          /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
        setError(network ? t('networkError') : msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap" dir={dir} lang={locale}>
      <div className="auth-card">
        <div className="auth-lang-bar" role="group" aria-label={t('language')}>
          <button
            type="button"
            className={`button button-compact ${locale === 'ar' ? '' : 'button-ghost'}`}
            onClick={() => setLocale('ar')}
          >
            {t('arabic')}
          </button>
          <button
            type="button"
            className={`button button-compact ${locale === 'en' ? '' : 'button-ghost'}`}
            onClick={() => setLocale('en')}
          >
            English
          </button>
        </div>
        <span className="brand-mark">{t('brand')}</span>
        <h2>{mode === 'login' ? t('welcomeBack') : t('createAccount')}</h2>
        <div className="inline-actions auth-method-tabs">
          <button
            type="button"
            className={`button button-compact ${authMethod === 'phone' ? '' : 'button-ghost'}`}
            onClick={() => setAuthMethod('phone')}
          >
            {t('continueWithPhone')}
          </button>
          <button
            type="button"
            className={`button button-compact ${authMethod === 'password' ? '' : 'button-ghost'}`}
            onClick={() => setAuthMethod('password')}
          >
            {t('continueWithPassword')}
          </button>
        </div>
        {authMethod === 'phone' ? (
          <PhoneAuthPanel
            mode={mode}
            onAuthed={onAuthed}
            onToggleMode={() => setMode(mode === 'login' ? 'register' : 'login')}
          />
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            {mfaToken ? (
              <>
                <p className="muted">{t('mfaRequired')}</p>
                <label className="field">
                  <span>{t('authenticatorCode')}</span>
                  <input
                    name="mfaCode"
                    autoComplete="one-time-code"
                    required
                    minLength={6}
                    maxLength={64}
                    disabled={busy}
                  />
                </label>
              </>
            ) : (
              <>
                <p className="muted">{mode === 'login' ? t('loginHint') : t('registerHint')}</p>
                <label className="field">
                  <span>{t('username')}</span>
                  <input
                    name="username"
                    autoComplete="username"
                    required
                    minLength={1}
                    maxLength={30}
                    pattern="[A-Za-z0-9._]+"
                    disabled={busy}
                  />
                </label>
                <label className="field">
                  <span>{t('password')}</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    minLength={8}
                    disabled={busy}
                  />
                </label>
              </>
            )}
            {error ? <p className="auth-error">{error}</p> : null}
            <button className="button" type="submit" disabled={busy}>
              {busy ? t('loading') : mfaToken ? t('confirm') : mode === 'login' ? t('login') : t('register')}
            </button>
            <button
              className="button button-ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                if (mfaToken) {
                  setMfaToken(null);
                  setError('');
                  return;
                }
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
              }}
            >
              {mfaToken ? t('back') : mode === 'login' ? t('needAccount') : t('haveAccount')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function SocialApp() {
  const { session, setSession, bootstrapping } = useAuth();
  const { t } = useI18n();
  const [authOverlay, setAuthOverlay] = useState<'login' | 'register' | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [vault, setVault] = useState<VaultAccount[]>(() => listVaultAccounts());

  useEffect(() => {
    function onAuthIntent(e: Event) {
      const mode = (e as CustomEvent<{ mode?: 'login' | 'register' }>).detail?.mode;
      if (session) upsertVaultAccount(session);
      setVault(listVaultAccounts());
      setAuthOverlay(mode === 'register' ? 'register' : 'login');
      setSession(null);
      setSwitchOpen(false);
    }
    window.addEventListener('securechat:auth-intent', onAuthIntent as EventListener);
    return () => window.removeEventListener('securechat:auth-intent', onAuthIntent as EventListener);
  }, [session, setSession]);

  function rememberSession(payload: AuthPayload) {
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
    return <PageLoader />;
  }

  if (!session || authOverlay) {
    return (
      <AuthGate
        initialMode={authOverlay === 'register' ? 'register' : 'login'}
        onAuthed={rememberSession}
      />
    );
  }

  return (
    <Shell
      onSwitchAccount={() => {
        setVault(listVaultAccounts());
        setSwitchOpen(true);
      }}
    >
      {switchOpen ? (
        <div className="sheet-backdrop" onClick={() => setSwitchOpen(false)}>
          <div className="sheet wa-share-sheet account-switch-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{t('switchAccount')}</h3>
            <ul className="account-switch-list">
              {vault.map((a) => (
                <li key={a.userId}>
                  <button
                    type="button"
                    className={`list-row account-switch-row ${a.userId === session.user.id ? 'is-active' : ''}`}
                    onClick={() => {
                      if (a.userId === session.user.id) {
                        setSwitchOpen(false);
                        return;
                      }
                      upsertVaultAccount(session);
                      setSession(vaultToSession(a));
                      setVault(listVaultAccounts());
                      setSwitchOpen(false);
                    }}
                  >
                    <UserAvatar
                      size="md"
                      name={a.displayName || a.username}
                      username={a.username}
                      avatarUrl={a.avatarUrl}
                    />
                    <span className="account-switch-meta">
                      <strong>{a.displayName || a.username}</strong>
                      <span className="muted">@{a.username}</span>
                      {a.userId === session.user.id ? (
                        <span className="muted tiny">{t('currentAccount')}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="button"
              onClick={() => {
                setSwitchOpen(false);
                setAuthOverlay('login');
                setSession(null);
              }}
            >
              {t('loginExistingAccount')}
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setSwitchOpen(false);
                setAuthOverlay('register');
                setSession(null);
              }}
            >
              {t('createNewAccount')}
            </button>
            <button type="button" className="button button-ghost" onClick={() => setSwitchOpen(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : null}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Navigate to="/feed" replace />} />
          <Route path="/feed" element={<FeedPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/reels" element={<ReelsPage />} />
          <Route path="/search" element={<Navigate to="/explore" replace />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/messages/*" element={<ChatApp />} />
          <Route path="/focus" element={<FocusShell />}>
            <Route index element={<Navigate to="chats" replace />} />
            <Route path="chats" element={<FocusChatsPage />} />
            <Route path="chats/dm/:peerId" element={<FocusDmPage />} />
            <Route path="chats/group/:groupId" element={<FocusGroupPage />} />
            <Route path="chats/channel/:channelId" element={<FocusChannelPage />} />
            <Route path="create/:kind" element={<FocusCreateWizard />} />
            <Route path="join/:inviteSlug" element={<FocusJoinChannelPage />} />
            <Route path="contacts" element={<FocusContactsPage />} />
            <Route path="calls" element={<FocusCallsPage />} />
            <Route path="settings" element={<FocusSettingsPage />} />
            <Route path="settings/notifications" element={<FocusNotificationsPage />} />
            <Route path="settings/storage" element={<FocusStoragePage />} />
            <Route path="settings/appearance" element={<FocusAppearancePage />} />
          </Route>
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/:groupId" element={<GroupDetailPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/create" element={<CreatePostPage />} />
          <Route path="/p/:postId" element={<PostDetailPage />} />
          <Route path="/profile" element={<MyProfilePage />} />
          <Route path="/profile/edit" element={<EditProfilePage />} />
          <Route path="/profile/highlights/new" element={<HighlightCreatePage />} />
          <Route path="/profile/orders" element={<BusinessOrdersPage />} />
          <Route path="/profile/catalog" element={<BusinessCatalogManagePage />} />
          <Route path="/profile/insights" element={<BusinessInsightsPage />} />
          <Route path="/profile/links" element={<BusinessLinksPage />} />
          <Route path="/u/:idOrUsername" element={<UserProfilePage />} />
          <Route path="/u/:idOrUsername/store" element={<BusinessCatalogPage />} />
          <Route path="/u/:idOrUsername/store/checkout" element={<BusinessCheckoutPage />} />
          <Route path="/u/:idOrUsername/links" element={<BusinessLinksPage />} />
          <Route path="/u/:idOrUsername/followers" element={<FollowListPage mode="followers" />} />
          <Route path="/u/:idOrUsername/following" element={<FollowListPage mode="following" />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/security" element={<SecuritySettingsPage />} />
          <Route path="/settings/privacy" element={<PrivacySettingsPage />} />
          <Route path="/settings/blocked" element={<BlockedUsersPage />} />
          <Route path="/settings/close-friends" element={<CloseFriendsPage />} />
          <Route path="/settings/interests" element={<InterestsSettingsPage />} />
          <Route path="/settings/business" element={<BusinessSettingsPage />} />
          <Route path="/settings/verification" element={<VerificationSettingsPage />} />
          <Route path="/settings/admin/verification" element={<AdminVerificationPage />} />
          <Route path="/settings/admin/recommendations" element={<AdminRecommendationsPage />} />
          <Route path="/settings/admin/moderation" element={<AdminModerationPage />} />
          <Route path="/settings/moderation" element={<AccountModerationPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="*" element={<Navigate to="/feed" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}

export function SocialRoot() {
  return (
    <AuthProvider>
      <PushBridge />
      <ToastProvider>
        <AppModeProvider>
          <SocialApp />
        </AppModeProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
