import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  createChannel,
  createGroup,
  fetchMediaUrl,
  updateChannel,
  updateGroup,
  uploadMediaFile
} from '@/api/social';
import { fetchFocusContacts, type FocusContact } from '@/api/focus';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { AvatarCrop } from '../ui/AvatarCrop';
import { IconSearch } from '../ui/Icons';
import { FocusBackBar } from './FocusBackBar';

type Step = 'name' | 'members';

export function FocusCreateWizard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { kind = 'group' } = useParams();
  const [params] = useSearchParams();
  const spaceKind: 'group' | 'channel' =
    kind === 'channel' || params.get('type') === 'channel' ? 'channel' : 'group';

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    spaceKind === 'channel' ? 'public' : 'private'
  );
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<FocusContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  useEffect(() => {
    if (step !== 'members') return;
    let cancelled = false;
    setLoadingPeople(true);
    const handle = window.setTimeout(() => {
      void fetchFocusContacts(q)
        .then((rows) => {
          if (!cancelled) setContacts(rows);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : t('errorGeneric'));
        })
        .finally(() => {
          if (!cancelled) setLoadingPeople(false);
        });
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [step, q, t]);

  const filtered = useMemo(() => contacts, [contacts]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onNameContinue(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError(t('nameTooShort'));
      return;
    }
    setError('');
    setStep('members');
  }

  function onCropConfirm(blob: Blob) {
    setCropFile(null);
    setAvatarBlob(blob);
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(URL.createObjectURL(blob));
  }

  async function persistAvatar(spaceId: string) {
    if (!avatarBlob) return;
    const file = new File([avatarBlob], 'avatar.jpg', { type: 'image/jpeg' });
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
    if (spaceKind === 'group') await updateGroup(spaceId, { avatarUrl: persist || null });
    else await updateChannel(spaceId, { avatarUrl: persist || null });
  }

  async function finish(skipMembers: boolean) {
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
        } catch {
          /* photo optional after create */
        }
        navigate(`/focus/chats/group/${g.id}`, { replace: true });
      } else {
        const c = await createChannel(name.trim(), 'focus', {
          visibility,
          memberIds
        });
        try {
          await persistAvatar(c.id);
        } catch {
          /* photo optional after create */
        }
        navigate(`/focus/chats/channel/${c.id}`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  const title =
    spaceKind === 'channel'
      ? step === 'name'
        ? t('newChannel')
        : t('addSubscribers')
      : step === 'name'
        ? t('newGroup')
        : t('addMembers');

  return (
    <div className="focus-wizard">
      <FocusBackBar
        title={title}
        fallbackTo="/focus/chats"
        onBack={() => {
          if (step === 'members') setStep('name');
          else navigate('/focus/chats');
        }}
      />

      {error ? <ErrorBanner message={error} /> : null}

      {step === 'name' ? (
        <form className="focus-wizard-body" onSubmit={onNameContinue}>
          <button
            type="button"
            className="focus-space-photo-btn focus-wizard-photo"
            onClick={() => fileRef.current?.click()}
          >
            <UserAvatar size="xl" name={name || '?'} avatarUrl={avatarPreview} />
            <span className="tg-change-photo">{t('changePhoto')}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = '';
              if (f) setCropFile(f);
            }}
          />

          <label className="focus-wizard-label">
            {spaceKind === 'channel' ? t('channelName') : t('groupName')}
          </label>
          <input
            className="focus-wizard-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={spaceKind === 'channel' ? t('channelName') : t('groupName')}
            maxLength={120}
            autoFocus
            dir="auto"
          />

          <p className="focus-wizard-label">{t('visibility')}</p>
          <div className="focus-visibility-cards">
            <button
              type="button"
              className={`focus-visibility-card${visibility === 'public' ? ' is-active' : ''}`}
              onClick={() => setVisibility('public')}
            >
              <strong>
                {spaceKind === 'channel' ? t('publicChannel') : t('publicGroup')}
              </strong>
              <span className="muted tiny">
                {spaceKind === 'channel' ? t('publicChannelHint') : t('publicGroupHint')}
              </span>
            </button>
            <button
              type="button"
              className={`focus-visibility-card${visibility === 'private' ? ' is-active' : ''}`}
              onClick={() => setVisibility('private')}
            >
              <strong>
                {spaceKind === 'channel' ? t('privateChannel') : t('privateGroup')}
              </strong>
              <span className="muted tiny">
                {spaceKind === 'channel' ? t('privateChannelHint') : t('privateGroupHint')}
              </span>
            </button>
          </div>

          <button type="submit" className="button focus-wizard-primary" disabled={name.trim().length < 2}>
            {t('continue')}
          </button>
        </form>
      ) : (
        <div className="focus-wizard-body">
          <div className="focus-search">
            <IconSearch size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchContacts')}
              aria-label={t('search')}
            />
          </div>

          {loadingPeople ? <PageLoader /> : null}

          <ul className="focus-pick-list">
            {filtered.map((c) => {
              const on = selected.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`focus-pick-row${on ? ' is-selected' : ''}`}
                    onClick={() => toggle(c.id)}
                  >
                    <UserAvatar
                      size="md"
                      name={c.displayName || c.username}
                      username={c.username}
                      avatarUrl={c.avatarUrl}
                    />
                    <span className="focus-contact-body">
                      <strong>{c.displayName || c.username}</strong>
                      <span className="muted">@{c.username}</span>
                    </span>
                    <span className={`focus-check${on ? ' on' : ''}`} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="focus-wizard-footer">
            <button
              type="button"
              className="button button-ghost"
              disabled={busy}
              onClick={() => void finish(true)}
            >
              {t('skipAndCreate')}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void finish(false)}
            >
              {t('finishCreate')}
              {selected.size ? ` (${selected.size})` : ''}
            </button>
          </div>
        </div>
      )}

      {cropFile ? (
        <AvatarCrop file={cropFile} onCancel={() => setCropFile(null)} onConfirm={onCropConfirm} />
      ) : null}
    </div>
  );
}
