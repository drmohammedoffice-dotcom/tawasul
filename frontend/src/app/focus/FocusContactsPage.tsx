import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchFocusContacts,
  matchPhoneContacts,
  type FocusContact
} from '@/api/focus';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { IconPhone, IconSearch, IconUserPlus } from '../ui/Icons';
import { FocusInviteSheet } from './FocusInviteSheet';

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function tryLoadDeviceContactHashes(): Promise<string[]> {
  try {
    const cap = (
      window as Window & {
        Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, any> };
      }
    ).Capacitor;
    if (!cap?.isNativePlatform?.()) return [];
    const Contacts = cap.Plugins?.Contacts;
    if (!Contacts?.getContacts) return [];
    const result = await Contacts.getContacts({
      projection: { phones: true }
    });
    const phones: string[] = [];
    for (const c of result?.contacts || []) {
      for (const p of c.phones || []) {
        const raw = String(p.number || '').replace(/[^\d+]/g, '');
        if (raw.length >= 8) phones.push(raw);
      }
    }
    const unique = [...new Set(phones)];
    return Promise.all(unique.map((p) => sha256Hex(p)));
  } catch {
    return [];
  }
}

export function FocusContactsPage() {
  const { t } = useI18n();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<FocusContact[]>([]);
  const [phoneMatches, setPhoneMatches] = useState<FocusContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const inviteUrl = `${window.location.origin}/register?ref=${encodeURIComponent(session?.user?.username || '')}`;

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      void fetchFocusContacts(q)
        .then((rows) => {
          if (!cancelled) setItems(rows);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : t('errorGeneric'));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [q, t]);

  async function syncPhone() {
    setSyncing(true);
    setError('');
    try {
      const hashes = await tryLoadDeviceContactHashes();
      if (!hashes.length) {
        setError(t('phoneSyncUnavailable'));
        return;
      }
      const matched = await matchPhoneContacts(hashes);
      setPhoneMatches(matched);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setSyncing(false);
    }
  }

  const merged = [...phoneMatches, ...items].filter(
    (row, idx, arr) => arr.findIndex((r) => r.id === row.id) === idx
  );

  function statusLine(c: FocusContact) {
    if (c.online) return t('online');
    if (c.source === 'phone') return t('fromPhoneContacts');
    return t('tapToMessage');
  }

  return (
    <div className="focus-contacts">
      <div className="focus-chats-header">
        <button type="button" className="focus-back-btn compact" onClick={() => navigate('/focus/chats')}>
          ←
        </button>
        <h1>{t('focusContacts')}</h1>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('inviteFriends')}
          onClick={() => setInviteOpen(true)}
        >
          <IconUserPlus size={20} />
        </button>
      </div>

      <div className="focus-search">
        <IconSearch size={16} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
        />
      </div>

      <button type="button" className="focus-invite-row" onClick={() => setInviteOpen(true)}>
        <IconUserPlus size={20} />
        <span>{t('inviteFriends')}</span>
      </button>

      <button
        type="button"
        className="focus-invite-row secondary"
        disabled={syncing}
        onClick={() => void syncPhone()}
      >
        <IconPhone size={20} />
        <span>{syncing ? t('syncingPhone') : t('syncPhoneContacts')}</span>
      </button>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <PageLoader /> : null}

      {!loading && merged.length === 0 ? (
        <p className="focus-empty-inline muted">{t('emptyContacts')}</p>
      ) : null}

      <ul className="focus-contact-list">
        {merged.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="focus-contact-row"
              onClick={() =>
                navigate(`/focus/chats/dm/${c.id}`, {
                  state: {
                    peer: {
                      id: c.id,
                      username: c.username,
                      displayName: c.displayName,
                      avatarUrl: c.avatarUrl
                    }
                  }
                })
              }
            >
              <UserAvatar
                size="md"
                name={c.displayName || c.username}
                username={c.username}
                avatarUrl={c.avatarUrl}
              />
              <span className="focus-contact-body">
                <strong>{c.displayName || c.username}</strong>
                <span className={c.online ? 'is-online' : 'muted'}>{statusLine(c)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <FocusInviteSheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        url={inviteUrl}
        shareText={t('inviteFriendsShare')}
      />
    </div>
  );
}
