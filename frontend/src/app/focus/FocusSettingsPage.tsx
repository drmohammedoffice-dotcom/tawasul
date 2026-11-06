import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchMediaUrl, resolveMediaUrl, uploadMediaFile } from '@/api/social';
import { fetchFocusProfile, updateFocusProfile, type FocusProfile } from '@/api/focus';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAppMode } from './AppModeContext';
import { UserAvatar } from '../ui/UserAvatar';
import { AvatarCrop } from '../ui/AvatarCrop';
import {
  IconArchive,
  IconBell,
  IconPhone,
  IconSettings,
  IconUser,
  IconUsers
} from '../ui/Icons';
import { ErrorBanner } from '../ui/States';
import { FocusNavRow } from './FocusSettingsShared';

export function FocusSettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { session, logout } = useAuth();
  const { setMode } = useAppMode();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [profile, setProfile] = useState<FocusProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [hideBusy, setHideBusy] = useState(false);
  const [error, setError] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onSave(e: FormEvent) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setSaveBusy(false);
    }
  }

  async function applyCrop(blob: Blob) {
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
      } catch {
        /* keep */
      }
      const p = await updateFocusProfile({ avatarUrl: persist || null });
      setProfile({
        ...p,
        avatarUrl: resolveMediaUrl(p.avatarUrl) || p.avatarUrl || null
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setAvatarBusy(false);
    }
  }

  const name = profile?.displayName || session?.user?.username || '';
  const username = session?.user?.username || '';

  return (
    <div className="focus-settings">
      <div className="focus-chats-header">
        <button type="button" className="focus-back-btn compact" onClick={() => navigate('/focus/chats')}>
          ←
        </button>
        <h1>{t('settings')}</h1>
        <span />
      </div>
      <div className="focus-settings-profile">
        <button
          type="button"
          className="focus-avatar-edit"
          disabled={avatarBusy}
          onClick={() => fileRef.current?.click()}
        >
          <UserAvatar size="xl" name={name} username={username} avatarUrl={profile?.avatarUrl} />
          <span className="muted tiny">{avatarBusy ? '…' : t('changeProfilePhoto')}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          disabled={avatarBusy}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (f) setCropFile(f);
          }}
        />
        <h1>{name}</h1>
        <p className="muted">@{username}</p>
        {profile?.bio ? <p className="focus-bio">{profile.bio}</p> : null}
        <button type="button" className="focus-text-btn" onClick={() => setEditing((v) => !v)}>
          {editing ? t('cancel') : t('edit')}
        </button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {editing ? (
        <form className="focus-create-panel" onSubmit={(e) => void onSave(e)}>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('displayName')}
            maxLength={80}
          />
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={t('bio')}
            maxLength={150}
            rows={3}
          />
          <button type="submit" className="button" disabled={saveBusy}>
            {t('saveProfile')}
          </button>
        </form>
      ) : null}

      <section className="focus-settings-block">
        <div className="focus-settings-row focus-settings-row-static">
          <span className="focus-settings-icon purple">
            <IconUser size={18} />
          </span>
          <span className="focus-settings-toggle-copy">
            <strong className="block">{t('hideBrowseProfile')}</strong>
            <span className="muted tiny">{t('hideBrowseProfileHint')}</span>
          </span>
          <label className="focus-switch">
            <input
              type="checkbox"
              checked={hideBrowseProfile}
              disabled={hideBusy}
              onChange={(e) => {
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
              }}
            />
            <span className="focus-switch-slider" />
          </label>
        </div>
        <Link to="/focus/calls" className="focus-settings-row">
          <span className="focus-settings-icon green">
            <IconPhone size={18} />
          </span>
          <span>{t('recentCalls')}</span>
          <span className="focus-settings-chevron" aria-hidden>
            ›
          </span>
        </Link>
        <Link to="/focus/chats" className="focus-settings-row">
          <span className="focus-settings-icon cyan">
            <IconUsers size={18} />
          </span>
          <span>{t('focusChats')}</span>
          <span className="focus-settings-chevron" aria-hidden>
            ›
          </span>
        </Link>
      </section>

      <section className="focus-settings-block">
        <FocusNavRow
          to="/focus/settings/notifications"
          label={t('notificationsAndSounds')}
          icon={<IconBell size={18} />}
          iconClass="red"
        />
        <FocusNavRow
          to="/focus/settings/storage"
          label={t('dataAndStorage')}
          icon={<IconArchive size={18} />}
          iconClass="green"
        />
        <FocusNavRow
          to="/focus/settings/appearance"
          label={t('appearance')}
          icon={<IconSettings size={18} />}
          iconClass="blue"
        />
        <Link
          to="/settings/privacy"
          className="focus-settings-row"
          onClick={() => setMode('browse')}
        >
          <span className="focus-settings-icon gray">
            <IconSettings size={18} />
          </span>
          <span>{t('privacySecurity')}</span>
          <span className="focus-settings-chevron" aria-hidden>
            ›
          </span>
        </Link>
        <div className="focus-settings-row">
          <span className="focus-settings-icon purple">
            <IconSettings size={18} />
          </span>
          <span>{t('language')}</span>
          <select
            className="focus-lang-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as 'ar' | 'en')}
            aria-label={t('language')}
          >
            <option value="ar">{t('arabic')}</option>
            <option value="en">{t('english')}</option>
          </select>
        </div>
      </section>

      <section className="focus-settings-block">
        <button type="button" className="focus-settings-row" onClick={() => setMode('browse')}>
          <span>{t('switchToBrowse')}</span>
        </button>
        <button type="button" className="focus-settings-row danger" onClick={() => void logout()}>
          <span>{t('logout')}</span>
        </button>
      </section>

      {cropFile ? (
        <AvatarCrop file={cropFile} onCancel={() => setCropFile(null)} onConfirm={(b) => void applyCrop(b)} />
      ) : null}
    </div>
  );
}
