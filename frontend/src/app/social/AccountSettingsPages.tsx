import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  addCloseFriend,
  beginTotpSetup,
  changePassword,
  confirmLinkEmail,
  confirmTotpSetup,
  disableTotp,
  fetchAccount,
  fetchBlockedUsers,
  fetchBusinessCategories,
  fetchCloseFriendCandidates,
  fetchCloseFriends,
  fetchMyBusiness,
  fetchVerificationStatus,
  removeCloseFriend,
  requestEmail2faOtp,
  requestLinkEmail,
  revokeSession,
  setAccountCountry,
  setEmail2fa,
  setInterests,
  submitVerification,
  switchToBusiness,
  switchToPersonal
} from '@/api/accounts';
import { unblockUser, uploadMediaFile } from '@/api/social';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/messages';
import type { Locale } from '@/i18n/messages';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { useToast } from '../ui/Toast';
import {
  fetchInferredInterests,
  fetchRecommendationPreferences,
  forgetInferredInterest,
  resetRecommendations,
  saveRecommendationPreferences,
  type FeedMode
} from '@/api/recommendations';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function AccountHubPage() {
  const { t, locale, setLocale } = useI18n();
  const { logout } = useAuth();
  const { push } = useToast();
  const [account, setAccount] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');

  async function reload() {
    setLoading(true);
    try {
      setAccount(await fetchAccount());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  function applyTheme(next: 'dark' | 'light') {
    document.documentElement.dataset.theme = next;
    localStorage.setItem('chat-theme', next);
    setTheme(next);
  }

  if (loading) return <PageLoader />;

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>{t('settings')}</h1>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      <Section title={t('appearance')}>
        <div className="settings-row">
          <span>{t('theme')}</span>
          <div className="inline-actions">
            <button type="button" className={`button button-compact ${theme === 'dark' ? '' : 'button-ghost'}`} onClick={() => applyTheme('dark')}>
              {t('darkMode')}
            </button>
            <button type="button" className={`button button-compact ${theme === 'light' ? '' : 'button-ghost'}`} onClick={() => applyTheme('light')}>
              {t('lightMode')}
            </button>
          </div>
        </div>
        <label className="field-label">
          {t('language')}
          <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </label>
      </Section>

      <Section title={t('accountInformation')}>
        <p className="muted tiny">@{account?.username}</p>
        <p className="muted tiny">
          {t('phone')}: {account?.phoneE164 || t('notLinked')}
        </p>
        <p className="muted tiny">
          {t('email')}: {account?.email || t('notLinked')}
        </p>
        <p className="muted tiny">
          {t('country')}: {account?.countryCode || '—'}
        </p>
        <div className="settings-links">
          <Link to="/settings/security">{t('securitySettings')}</Link>
          <Link to="/settings/privacy">{t('privacySettings')}</Link>
          <Link to="/settings/blocked">{t('blockedUsers')}</Link>
          <Link to="/settings/close-friends">{t('closeFriends')}</Link>
          <Link to="/settings/interests">{t('interests')}</Link>
          <Link to="/settings/business">
            {account?.accountType === 'business' ? t('switchToPersonal') : t('switchToBusiness')}
          </Link>
          {account?.accountType === 'business' ? (
            <Link to="/settings/verification">{t('businessVerification')}</Link>
          ) : null}
          <Link to="/archive">{t('archive')}</Link>
          {account?.role === 'admin' ? (
            <Link to="/settings/admin/verification">{t('adminVerification')}</Link>
          ) : null}
          {account?.role === 'admin' ? (
            <Link to="/settings/admin/recommendations">{t('recommendationAdmin')}</Link>
          ) : null}
          {account?.role === 'admin' || account?.role === 'moderator' ? (
            <Link to="/settings/admin/moderation">سلامة المحتوى</Link>
          ) : null}
          <Link to="/settings/moderation">حالة الحساب والمخالفات</Link>
        </div>
      </Section>

      <Section title={t('account')}>
        <button
          type="button"
          className="button button-ghost"
          onClick={() => void logout().then(() => push(t('loggedOut'), 'success'))}
        >
          {t('logout')}
        </button>
      </Section>
    </div>
  );
}

export function SecuritySettingsPage() {
  const { t } = useI18n();
  const { push } = useToast();
  const [account, setAccount] = useState<any>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [country, setCountry] = useState('IQ');
  const [error, setError] = useState('');
  const [debug, setDebug] = useState('');
  const [totpPassword, setTotpPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpSetup, setTotpSetup] = useState<{
    secretBase32: string;
    qrDataUrl: string;
  } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  useEffect(() => {
    void fetchAccount().then((a) => {
      setAccount(a);
      setCountry(a.countryCode || 'IQ');
      setEmail(a.email || '');
    });
  }, []);

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>{t('securitySettings')}</h1>
        <Link to="/settings" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {debug ? <p className="muted tiny">dev: {debug}</p> : null}

      <Section title={t('authenticatorApp')}>
        <p className="muted tiny">
          {account?.totpEnabled ? t('totpOn') : t('totpOff')}
        </p>
        {!account?.totpEnabled ? (
          <>
            <form
              className="create-form"
              onSubmit={(e) => {
                e.preventDefault();
                void beginTotpSetup(totpPassword)
                  .then((r) => {
                    setTotpSetup({ secretBase32: r.secretBase32, qrDataUrl: r.qrDataUrl });
                    setRecoveryCodes(null);
                    push(t('totpScanQr'), 'success');
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
              }}
            >
              <input
                type="password"
                placeholder={t('currentPassword')}
                value={totpPassword}
                onChange={(e) => setTotpPassword(e.target.value)}
                required
              />
              <button className="button" type="submit">
                {t('totpBegin')}
              </button>
            </form>
            {totpSetup ? (
              <div className="totp-setup">
                <img
                  src={totpSetup.qrDataUrl}
                  alt="TOTP QR"
                  width={240}
                  height={240}
                  style={{ background: '#fff', borderRadius: 8 }}
                />
                <p className="muted tiny" style={{ wordBreak: 'break-all' }}>
                  {totpSetup.secretBase32}
                </p>
                <form
                  className="create-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirmTotpSetup(totpCode)
                      .then((r) => {
                        setRecoveryCodes(r.recoveryCodes);
                        setTotpSetup(null);
                        setTotpCode('');
                        setTotpPassword('');
                        setAccount((a: any) => ({ ...a, totpEnabled: true }));
                        push(t('totpOn'), 'success');
                      })
                      .catch((err) =>
                        setError(err instanceof Error ? err.message : t('errorGeneric'))
                      );
                  }}
                >
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder={t('authenticatorCode')}
                    required
                  />
                  <button className="button" type="submit">
                    {t('totpConfirm')}
                  </button>
                </form>
              </div>
            ) : null}
            {recoveryCodes?.length ? (
              <div className="recovery-codes">
                <p className="muted tiny">{t('recoveryCodesOnce')}</p>
                <ul>
                  {recoveryCodes.map((c) => (
                    <li key={c}>
                      <code>{c}</code>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="button button-ghost button-compact"
                  onClick={() => setRecoveryCodes(null)}
                >
                  {t('confirm')}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <form
            className="create-form"
            onSubmit={(e) => {
              e.preventDefault();
              void disableTotp(disablePassword, disableCode)
                .then(() => {
                  setAccount((a: any) => ({ ...a, totpEnabled: false }));
                  setDisablePassword('');
                  setDisableCode('');
                  push(t('totpOff'), 'success');
                })
                .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
            }}
          >
            <input
              type="password"
              placeholder={t('currentPassword')}
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              required
            />
            <input
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              placeholder={t('authenticatorOrRecovery')}
              required
            />
            <button className="button button-ghost" type="submit">
              {t('totpDisable')}
            </button>
          </form>
        )}
      </Section>

      <Section title={t('changePassword')}>
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void changePassword(currentPassword, newPassword)
              .then(() => {
                push(t('passwordChanged'), 'success');
                setCurrentPassword('');
                setNewPassword('');
              })
              .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
          }}
        >
          <input type="password" placeholder={t('currentPassword')} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          <input type="password" placeholder={t('newPassword')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required />
          <button className="button" type="submit">
            {t('save')}
          </button>
        </form>
      </Section>

      <Section title={t('linkEmail')}>
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void requestLinkEmail(email)
              .then((r) => {
                if (r.debugCode) setDebug(r.debugCode);
                push(t('codeSent'), 'success');
              })
              .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
          }}
        >
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email')} required />
          <button className="button button-ghost" type="submit">
            {t('sendCode')}
          </button>
        </form>
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmLinkEmail(email, emailCode)
              .then(() => {
                push(t('emailLinked'), 'success');
                setEmailCode('');
              })
              .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
          }}
        >
          <input value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder={t('verificationCode')} required />
          <button className="button" type="submit">
            {t('confirm')}
          </button>
        </form>
      </Section>

      <Section title={t('twoFactorEmail')}>
        <p className="muted tiny">
          {account?.twoFactorEmailEnabled ? t('twoFactorOn') : t('twoFactorOff')}
        </p>
        <button
          type="button"
          className="button button-ghost button-compact"
          onClick={() =>
            void requestEmail2faOtp()
              .then((r) => {
                if (r.debugCode) setDebug(r.debugCode);
                push(t('codeSent'), 'success');
              })
              .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
          }
        >
          {t('sendCode')}
        </button>
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void setEmail2fa(true, twoFaCode)
              .then(() => {
                push(t('twoFactorOn'), 'success');
                setAccount((a: any) => ({ ...a, twoFactorEmailEnabled: true }));
              })
              .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
          }}
        >
          <input value={twoFaCode} onChange={(e) => setTwoFaCode(e.target.value)} placeholder={t('verificationCode')} />
          <button className="button" type="submit">
            {t('enable2fa')}
          </button>
        </form>
        {account?.twoFactorEmailEnabled ? (
          <button
            type="button"
            className="button button-ghost"
            onClick={() =>
              void setEmail2fa(false).then(() => {
                setAccount((a: any) => ({ ...a, twoFactorEmailEnabled: false }));
                push(t('twoFactorOff'), 'success');
              })
            }
          >
            {t('disable2fa')}
          </button>
        ) : null}
      </Section>

      <Section title={t('country')}>
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void setAccountCountry(country)
              .then(() => push(t('changesSaved'), 'success'))
              .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
          }}
        >
          <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} minLength={2} />
          <button className="button" type="submit">
            {t('save')}
          </button>
        </form>
      </Section>

      <Section title={t('sessions')}>
        {(account?.sessions || []).map((s: any) => (
          <div key={s.id} className="list-row">
            <span className="muted tiny">
              {s.deviceId} · {new Date(s.createdAt).toLocaleString()}
            </span>
            <button
              type="button"
              className="button button-ghost button-compact"
              onClick={() =>
                void revokeSession(s.id)
                  .then(() => fetchAccount().then(setAccount))
                  .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
              }
            >
              {t('revoke')}
            </button>
          </div>
        ))}
        {!account?.sessions?.length ? <p className="muted">{t('noSessions')}</p> : null}
      </Section>
    </div>
  );
}

export function PrivacySettingsPage() {
  const { t } = useI18n();
  const { push } = useToast();
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void import('@/api/social').then(({ fetchMyProfile }) =>
      fetchMyProfile().then((p) => setIsPrivate(Boolean(p.isPrivate)))
    );
  }, []);

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>{t('privacySettings')}</h1>
        <Link to="/settings" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <Section title={t('accountPrivacy')}>
        <label className="check-row">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => {
              const next = e.target.checked;
              setIsPrivate(next);
              void import('@/api/social')
                .then(({ updateMyProfile }) => updateMyProfile({ isPrivate: next }))
                .then(() => push(t('changesSaved'), 'success'))
                .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
            }}
          />
          {t('privateAccount')}
        </label>
        <p className="muted tiny">{t('privateAccountHint')}</p>
      </Section>
    </div>
  );
}

export function BlockedUsersPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      setItems(await fetchBlockedUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (loading) return <PageLoader />;

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>{t('blockedUsers')}</h1>
        <Link to="/settings" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {!items.length ? <EmptyState title={t('emptyBlocked')} /> : null}
      {items.map((u) => (
        <div key={u.id} className="list-row">
          <Link to={`/u/${u.username}`}>@{u.username}</Link>
          <button
            type="button"
            className="button button-compact"
            onClick={() => {
              if (!window.confirm(t('confirmUnblock'))) return;
              void unblockUser(u.id).then(() => reload());
            }}
          >
            {t('unblock')}
          </button>
        </div>
      ))}
    </div>
  );
}

export function CloseFriendsPage() {
  const { t } = useI18n();
  const [friends, setFriends] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function reload() {
    try {
      setFriends(await fetchCloseFriends());
      setCandidates(await fetchCloseFriendCandidates());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>{t('closeFriends')}</h1>
        <Link to="/settings" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      <p className="muted tiny">{t('closeFriendsHint')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      <Section title={t('closeFriends')}>
        {!friends.length ? <EmptyState title={t('emptyCloseFriends')} /> : null}
        {friends.map((u) => (
          <div key={u.id} className="list-row">
            <Link to={`/u/${u.username}`}>@{u.username}</Link>
            <button type="button" className="button button-ghost button-compact" onClick={() => void removeCloseFriend(u.id).then(reload)}>
              {t('remove')}
            </button>
          </div>
        ))}
      </Section>
      <Section title={t('addCloseFriend')}>
        {candidates.map((u) => (
          <div key={u.id} className="list-row">
            <span>@{u.username}</span>
            <button type="button" className="button button-compact" onClick={() => void addCloseFriend(u.id).then(reload)}>
              {t('add')}
            </button>
          </div>
        ))}
        {!candidates.length ? <p className="muted">{t('noCandidates')}</p> : null}
      </Section>
    </div>
  );
}

export function InterestsSettingsPage() {
  const { t } = useI18n();
  const { push } = useToast();
  const [keys, setKeys] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [feedMode, setFeedMode] = useState<FeedMode>('personalized');
  const [personalization, setPersonalization] = useState(true);
  const [inferred, setInferred] = useState<Array<{ key: string; strength: number; polarity: string }>>([]);
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

  function toggle(k: string) {
    setKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>{t('interests')}</h1>
        <Link to="/settings" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="interest-chips">
        {catalog.map((k) => (
          <button key={k} type="button" className={`chip ${keys.includes(k) ? 'active' : ''}`} onClick={() => toggle(k)}>
            {t(`interest_${k}` as any) || k}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="button"
        onClick={() =>
          void setInterests(keys)
            .then(() => push(t('changesSaved'), 'success'))
            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
        }
      >
        {t('save')}
      </button>
      <section className="panel-block">
        <h2>{t('feedMode')}</h2>
        <label className="list-row">
          <input
            type="checkbox"
            checked={personalization}
            onChange={() => {
              const next = !personalization;
              setPersonalization(next);
              void saveRecommendationPreferences(feedMode, next).catch((err) =>
                setError(err instanceof Error ? err.message : t('errorGeneric'))
              );
            }}
          />
          <span>{t('personalizationOn')}</span>
        </label>
        <label className="list-row">
          <input
            type="radio"
            name="feedMode"
            checked={feedMode === 'personalized'}
            onChange={() => {
              setFeedMode('personalized');
              void saveRecommendationPreferences('personalized').catch((err) =>
                setError(err instanceof Error ? err.message : t('errorGeneric'))
              );
            }}
          />
          <span>{t('feedPersonalized')}</span>
        </label>
        <label className="list-row">
          <input
            type="radio"
            name="feedMode"
            checked={feedMode === 'following_chronological'}
            onChange={() => {
              setFeedMode('following_chronological');
              void saveRecommendationPreferences('following_chronological').catch((err) =>
                setError(err instanceof Error ? err.message : t('errorGeneric'))
              );
            }}
          />
          <span>{t('feedChronological')}</span>
        </label>
        <button
          type="button"
          className="button button-ghost"
          onClick={() =>
            void resetRecommendations()
              .then(() => push(t('recommendationsCleared'), 'success'))
              .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
          }
        >
          {t('resetRecommendations')}
        </button>
        <h2>{t('inferredInterests')}</h2>
        {!inferred.length ? <p className="muted">{t('optional')}</p> : null}
        {inferred.map((row) => (
          <div className="list-row" key={`${row.polarity}-${row.key}`}>
            <span>
              {t(`interest_${row.key}` as MessageKey)} · {row.strength}
            </span>
            <button
              type="button"
              className="button button-ghost button-compact"
              onClick={() =>
                void forgetInferredInterest(row.key)
                  .then(() => loadInferred())
                  .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
              }
            >
              {t('removeInterest')}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

export function BusinessSettingsPage() {
  const { t, locale } = useI18n();
  const { push } = useToast();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<any[]>([]);
  const [biz, setBiz] = useState<any>(null);
  const [categoryKey, setCategoryKey] = useState('retail');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmPersonal, setConfirmPersonal] = useState(false);

  useEffect(() => {
    void fetchBusinessCategories().then(setCategories);
    void fetchMyBusiness()
      .then((b) => {
        setBiz(b);
        if (b.businessProfile?.categoryKey) setCategoryKey(b.businessProfile.categoryKey);
      })
      .catch(() => undefined);
  }, []);

  async function onSwitch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await switchToBusiness({ categoryKey });
      push(t('switchedToBusiness'), 'success');
      navigate('/settings', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
      setConfirmPersonal(false);
    }
  }

  const isBusiness = biz?.accountType === 'business';

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>{isBusiness ? t('switchToPersonal') : t('switchToBusiness')}</h1>
        <Link to="/settings" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      {isBusiness ? (
        <Section title={t('switchToPersonal')}>
          <p className="muted">{t('switchToPersonalHint')}</p>
          {!confirmPersonal ? (
            <button type="button" className="button" disabled={busy} onClick={() => setConfirmPersonal(true)}>
              {t('switchToPersonal')}
            </button>
          ) : (
            <div className="confirm-box">
              <p>{t('confirmSwitchToPersonal')}</p>
              <div className="inline-actions">
                <button type="button" className="button" disabled={busy} onClick={() => void onSwitchPersonal()}>
                  {t('confirm')}
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={busy}
                  onClick={() => setConfirmPersonal(false)}
                >
                  {t('cancel')}
                </button>
              </div>
            </div>
          )}
        </Section>
      ) : (
        <form className="create-form" onSubmit={(e) => void onSwitch(e)}>
          <p className="muted">{t('businessPickCategory')}</p>
          <label className="field-label">
            {t('businessCategory')}
            <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} required>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label?.[locale] || c.label?.en || c.key}
                </option>
              ))}
            </select>
          </label>
          <button className="button" type="submit" disabled={busy || !categoryKey}>
            {t('switchToBusiness')}
          </button>
        </form>
      )}
    </div>
  );
}

export function VerificationSettingsPage() {
  const { t } = useI18n();
  const { push } = useToast();
  const [status, setStatus] = useState<any>(null);
  const [track, setTrack] = useState<'licensed_business' | 'individual_seller'>('individual_seller');
  const [regNo, setRegNo] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [docs, setDocs] = useState<Array<{ docType: string; mediaId: string; contentHash: string }>>([]);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingDocType = useRef('license');

  useEffect(() => {
    void fetchVerificationStatus().then(setStatus);
  }, []);

  async function addDoc(docType: string, file: File) {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    const contentHash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const mediaId = await uploadMediaFile(file, 'verification');
    setDocs((prev) => [...prev.filter((d) => d.docType !== docType), { docType, mediaId, contentHash }]);
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>{t('businessVerification')}</h1>
        <Link to="/settings" className="button button-ghost button-compact">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <p className="muted">
        {t('verificationStatus')}:{' '}
        {status?.isVerified ? 'approved' : status?.request?.status || 'not_submitted'}
      </p>
      {status?.isVerified ? <p className="verified-badge">✓ {t('verified')}</p> : null}
      {status?.request?.adminNote ? <p className="auth-error">{status.request.adminNote}</p> : null}

      {!status?.isVerified ? (
        <form
          className="create-form"
          onSubmit={(e) => {
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
                setStatus((s: any) => ({ ...s, request: r }));
              })
              .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
          }}
        >
          <select
            value={track}
            onChange={(e) => setTrack(e.target.value as 'licensed_business' | 'individual_seller')}
          >
            <option value="licensed_business">{t('trackLicensed')}</option>
            <option value="individual_seller">{t('trackIndividual')}</option>
          </select>
          <input value={applicantName} onChange={(e) => setApplicantName(e.target.value)} placeholder={t('applicantName')} />
          {track === 'licensed_business' ? (
            <input value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder={t('registrationNumber')} required />
          ) : (
            <input value={nationalId} onChange={(e) => setNationalId(e.target.value)} placeholder={t('nationalId')} required />
          )}
          <div className="create-media-actions">
            {(track === 'licensed_business' ? ['license'] : ['national_id', 'residency', 'selfie']).map((docType) => (
              <button
                key={docType}
                type="button"
                className="button button-ghost button-compact"
                onClick={() => {
                  pendingDocType.current = docType;
                  fileRef.current?.click();
                }}
              >
                {docType}
                {docs.some((d) => d.docType === docType) ? ' ✓' : ''}
              </button>
            ))}
          </div>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void addDoc(pendingDocType.current, f);
              e.target.value = '';
            }}
          />
          <label className="check-row">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            {t('attestAccuracy')}
          </label>
          <button className="button" type="submit" disabled={!attested || !docs.length}>
            {t('submitVerification')}
          </button>
        </form>
      ) : null}
    </div>
  );
}
