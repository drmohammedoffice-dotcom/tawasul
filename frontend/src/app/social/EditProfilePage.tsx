import { FormEvent, useEffect, useRef, useState } from 'react';
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
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [originalUsername, setOriginalUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>(
    'idle'
  );
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
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

  async function persistProfile(includeUsername: boolean) {
    setBusy(true);
    setError('');
    try {
      const patch: {
        displayName?: string;
        bio?: string;
        avatarUrl?: string;
        username?: string;
      } = { bio: bio.slice(0, 150) };
      const name = displayName.trim();
      if (name) patch.displayName = name;
      if (avatarUrl) patch.avatarUrl = avatarUrl;
      if (includeUsername) {
        const next = username.trim().toLowerCase();
        if (next && next !== originalUsername.toLowerCase()) patch.username = next;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
      setConfirmUsername(false);
    }
  }

  async function onSave(e: FormEvent) {
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

  async function applyCrop(blob: Blob) {
    setCropFile(null);
    setBusy(true);
    setError('');
    try {
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      const mediaId = await uploadMediaFile(file, 'avatar');
      const { secureUrl } = await (await import('@/api/social')).fetchMediaUrl(mediaId);
      // Persist a stable media ref — never store short-lived signed/local-file URLs.
      const persist = `media:${mediaId}`;
      setAvatarUrl(resolveMediaUrl(secureUrl));
      await updateMyProfile({ avatarUrl: persist });
      push(t('avatarUpdated'), 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function clearAvatar() {
    setBusy(true);
    try {
      await updateMyProfile({ avatarUrl: '' });
      setAvatarUrl(null);
      push(t('avatarRemoved'), 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div className="edit-profile-page">
      <div className="page-header">
        <h1>{t('editProfile')}</h1>
        <Link className="button button-ghost button-compact" to="/profile">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      <div className="avatar-edit-block">
        <div className="avatar-circle xl">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : (displayName || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="create-media-actions">
          <button type="button" className="button button-compact" onClick={() => cameraRef.current?.click()}>
            {t('takePhoto')}
          </button>
          <button type="button" className="button button-compact button-ghost" onClick={() => galleryRef.current?.click()}>
            {t('chooseFromGallery')}
          </button>
          {avatarUrl ? (
            <button type="button" className="button button-compact button-ghost" onClick={() => void clearAvatar()}>
              {t('removePhoto')}
            </button>
          ) : null}
        </div>
        <input
          ref={cameraRef}
          className="sr-only"
          type="file"
          accept="image/*"
          capture="user"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setCropFile(f);
            e.target.value = '';
          }}
        />
        <input
          ref={galleryRef}
          className="sr-only"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setCropFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <form className="create-form" onSubmit={(e) => void onSave(e)}>
        <label className="field-label">
          {t('displayName')}
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} disabled={busy} />
        </label>
        <label className="field-label">
          {t('username')}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
            maxLength={30}
            disabled={busy}
            dir="ltr"
            autoCapitalize="off"
            autoCorrect="off"
          />
          {usernameStatus === 'checking' ? <span className="muted tiny">{t('checkingUsername')}</span> : null}
          {usernameStatus === 'available' ? <span className="username-ok">{t('usernameAvailable')}</span> : null}
          {usernameStatus === 'taken' ? <span className="username-bad">{t('usernameTaken')}</span> : null}
          {usernameStatus === 'invalid' && username.trim() ? (
            <span className="username-bad">{t('usernameInvalid')}</span>
          ) : null}
        </label>
        <label className="field-label">
          {t('bio')}
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 150))}
            rows={4}
            maxLength={150}
            disabled={busy}
            dir="auto"
          />
          <span className="muted tiny bio-char-count">{t('bioLimit').replace('{n}', String(bio.length))}</span>
        </label>
        {isBusiness ? (
          <fieldset className="biz-location-fields">
            <legend>{t('businessLocation')}</legend>
            <label className="field-label">
              {t('businessName')}
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                maxLength={120}
                disabled={busy}
                dir="auto"
              />
            </label>
            <label className="field-label">
              {t('businessAddress')}
              <textarea
                value={addressText}
                onChange={(e) => setAddressText(e.target.value)}
                rows={2}
                maxLength={280}
                disabled={busy}
                dir="auto"
                placeholder={t('businessAddress')}
              />
            </label>
            <div className="inline-actions" style={{ alignItems: 'stretch' }}>
              <label className="field-label" style={{ flex: 1 }}>
                Latitude
                <input
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  inputMode="decimal"
                  disabled={busy}
                  dir="ltr"
                  placeholder="33.3152"
                />
              </label>
              <label className="field-label" style={{ flex: 1 }}>
                Longitude
                <input
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  inputMode="decimal"
                  disabled={busy}
                  dir="ltr"
                  placeholder="44.3661"
                />
              </label>
            </div>
            <button
              type="button"
              className="button button-ghost button-compact"
              disabled={busy || !navigator.geolocation}
              onClick={() => {
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    setLatitude(String(pos.coords.latitude));
                    setLongitude(String(pos.coords.longitude));
                  },
                  () => setError(t('errorGeneric'))
                );
              }}
            >
              {t('useCurrentLocation')}
            </button>
          </fieldset>
        ) : null}
        <button className="button" type="submit" disabled={busy}>
          {t('save')}
        </button>
      </form>

      {confirmUsername ? (
        <div className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet wa-share-sheet">
            <h3>{t('usernameChangeTitle')}</h3>
            <p>{t('usernameChangeHint')}</p>
            <div className="inline-actions">
              <button type="button" className="button" disabled={busy} onClick={() => void persistProfile(true)}>
                {t('confirm')}
              </button>
              <button
                type="button"
                className="button button-ghost"
                disabled={busy}
                onClick={() => setConfirmUsername(false)}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cropFile ? (
        <AvatarCrop file={cropFile} onCancel={() => setCropFile(null)} onConfirm={(b) => void applyCrop(b)} />
      ) : null}
    </div>
  );
}
