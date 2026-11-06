import { useEffect, useState } from 'react';
import { fetchFollowing, searchAll } from '@/api/social';
import { createShareLink, shareContentToDm } from '@/api/content';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { IconSend } from './Icons';
import { UserAvatar } from './UserAvatar';
import { useToast } from './Toast';

type Props = {
  targetType: 'post' | 'reel' | 'story';
  targetId: string;
  onClose: () => void;
  onShared?: (shareCount?: number) => void;
  className?: string;
};

export function SharePeoplePanel({ targetType, targetId, onClose, onShared, className = '' }: Props) {
  const { t } = useI18n();
  const { push } = useToast();
  const me = getSessionSnapshot()?.user?.id;
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set());

  async function loadPeople(query: string) {
    try {
      if (!query.trim()) {
        const uname = getSessionSnapshot()?.user?.username;
        if (uname) {
          const following = await fetchFollowing(uname);
          const rows = (Array.isArray(following) ? following : []).map(
            (f: any) => f.following || f.user || f
          );
          setPeople(rows.filter((u: any) => u?.id && u.id !== me).slice(0, 40));
          return;
        }
      }
      const res = await searchAll(query.trim());
      setPeople((res.users || []).filter((u: any) => u.id !== me).slice(0, 24));
    } catch {
      setPeople([]);
    }
  }

  useEffect(() => {
    void loadPeople('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  useEffect(() => {
    const handle = window.setTimeout(() => void loadPeople(q), 280);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function sendTo(userId: string) {
    setBusyId(userId);
    try {
      const res = await shareContentToDm({ targetType, targetId, receiverIds: [userId] });
      setSentIds((prev) => new Set(prev).add(userId));
      setSelectedId(null);
      onShared?.(typeof res?.shareCount === 'number' ? res.shareCount : undefined);
      push(t('sharedToChat'), 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : t('errorGeneric'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={`share-panel share-people-panel ${className}`.trim()}>
      <div className="reel-sheet-head">
        <strong>{t('share')}</strong>
        <button type="button" className="button button-ghost button-compact" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      <button
        type="button"
        className="button"
        onClick={() =>
          void createShareLink(targetType, targetId).then(({ url }) =>
            navigator.clipboard.writeText(url).then(() => {
              push(t('linkCopied'), 'success');
              /* Copy must NOT count as a share — only DM send does */
            })
          )
        }
      >
        {t('copyLink')}
      </button>
      <input
        className="share-search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('searchPeopleHint')}
        dir="auto"
      />
      <ul className="reel-share-people">
        {people.map((u) => {
          const selected = selectedId === u.id;
          const sent = sentIds.has(u.id);
          return (
            <li key={u.id} className={`share-person-row ${selected ? 'is-selected' : ''} ${sent ? 'is-sent' : ''}`}>
              <button
                type="button"
                className="reel-share-person"
                onClick={() => setSelectedId((cur) => (cur === u.id ? null : u.id))}
              >
                <UserAvatar
                  size="md"
                  name={u.displayName || u.username}
                  username={u.username}
                  avatarUrl={u.avatarUrl}
                />
                <span className="share-person-meta">
                  <strong>{u.displayName || u.username}</strong>
                  <span className="muted">@{u.username}</span>
                </span>
              </button>
              {selected ? (
                <div className="share-row-actions">
                  <button
                    type="button"
                    className="share-send-btn"
                    disabled={busyId === u.id}
                    onClick={() => void sendTo(u.id)}
                  >
                    <IconSend size={16} />
                    <span>{t('send')}</span>
                  </button>
                  <button
                    type="button"
                    className="share-cancel-btn"
                    onClick={() => setSelectedId(null)}
                  >
                    {t('cancel')}
                  </button>
                </div>
              ) : sent ? (
                <span className="share-sent-badge muted tiny">{t('sent')}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
