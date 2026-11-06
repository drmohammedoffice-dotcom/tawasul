import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  addGroupMember,
  deleteGroup,
  fetchGroup,
  fetchGroupInvite,
  fetchGroupMembers,
  fetchGroupMessages,
  leaveGroup,
  removeGroupMember,
  updateGroup
} from '@/api/social';
import { FocusSpacePhoto } from './FocusSpacePhoto';
import {
  fetchFocusContacts,
  fetchUnifiedInbox,
  setChatMute,
  type FocusContact
} from '@/api/focus';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { clientRequestId, getRealtimeSocket } from '@/lib/realtime';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import {
  IconBell,
  IconMore,
  IconMute,
  IconPlus,
  IconSearch,
  IconSend,
  IconSettings,
  IconUserPlus,
  IconUsers,
  IconVideo
} from '../ui/Icons';
import { FocusBackBar } from './FocusBackBar';
import { FocusInviteSheet } from './FocusInviteSheet';

type View = 'chat' | 'profile' | 'settings' | 'edit' | 'addMembers';

type GroupMsg = {
  id: string;
  groupId?: string;
  senderId: string;
  encryptedContent: string;
  timestamp: string;
  sender?: {
    id: string;
    username?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
};

type MemberRow = {
  id: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  online?: boolean;
  user?: {
    id: string;
    username?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
};

function formatMsgTime(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleTimeString(locale === 'ar' ? 'ar' : 'en', {
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function roleLabel(role: string, t: (k: any) => string) {
  if (role === 'owner') return t('ownerBadge');
  if (role === 'admin') return t('adminBadge');
  return '';
}

export function FocusGroupPage() {
  const { t, locale } = useI18n();
  const { session } = useAuth();
  const navigate = useNavigate();
  const { groupId = '' } = useParams();

  const [view, setView] = useState<View>('chat');
  const [group, setGroup] = useState<any>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [messages, setMessages] = useState<GroupMsg[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [addQ, setAddQ] = useState('');
  const [contacts, setContacts] = useState<FocusContact[]>([]);

  const canManage = group?.myRole === 'owner' || group?.myRole === 'admin';
  const isOwner = group?.myRole === 'owner';
  const memberCount = group?._count?.members ?? members.length;
  const meId = session?.user?.id;

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const [g, m, msgs] = await Promise.all([
        fetchGroup(groupId),
        fetchGroupMembers(groupId),
        fetchGroupMessages(groupId)
      ]);
      setGroup(g);
      setMembers(m as MemberRow[]);
      setMessages(msgs as GroupMsg[]);
      setEditName(g.name || '');
      setEditDesc(g.description || '');
      try {
        const inbox = await fetchUnifiedInbox(80, 'focus');
        const row = inbox.find((i) => i.type === 'group' && i.id === groupId);
        if (row) setMuted(Boolean(row.muted));
      } catch {
        /* keep mute default */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    const socket = getRealtimeSocket();
    if (!socket) return;
    const onNew = (data: GroupMsg) => {
      if (data?.groupId && data.groupId !== groupId) return;
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
    };
    const join = () => socket.emit('group:join', { groupId });
    socket.on('group:message:new', onNew);
    if (socket.connected) join();
    socket.on('connect', join);
    return () => {
      socket.off('group:message:new', onNew);
      socket.off('connect', join);
      socket.emit('group:leave', { groupId });
    };
  }, [groupId]);

  useEffect(() => {
    if (view !== 'addMembers') return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void fetchFocusContacts(addQ)
        .then((rows) => {
          if (!cancelled) setContacts(rows);
        })
        .catch(() => undefined);
    }, addQ ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [view, addQ]);

  const visibleMessages = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return messages;
    return messages.filter((m) => m.encryptedContent.toLowerCase().includes(needle));
  }, [messages, searchQ]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);

  async function openInvite() {
    try {
      const inv = await fetchGroupInvite(groupId);
      setInviteUrl(`${window.location.origin}/focus/join-group/${inv.inviteSlug}`);
      setInviteOpen(true);
      setMoreOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function toggleMute() {
    try {
      await setChatMute('group', groupId, !muted);
      setMuted((v) => !v);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  function startVideoCall() {
    const socket = getRealtimeSocket();
    socket?.emit('call:invite', { scope: 'group', spaceId: groupId, kind: 'video' });
  }

  function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const socket = getRealtimeSocket();
    if (!socket) {
      setError(t('errorGeneric'));
      return;
    }
    const content = text.trim();
    setText('');
    socket.emit(
      'group:message:send',
      { groupId, encryptedContent: content, clientRequestId: clientRequestId('g') },
      (ack: { success?: boolean; data?: GroupMsg }) => {
        if (ack?.data) {
          setMessages((prev) =>
            prev.some((m) => m.id === ack.data!.id) ? prev : [...prev, ack.data!]
          );
        }
      }
    );
  }

  async function saveEdit() {
    setBusy(true);
    setError('');
    try {
      const g = (await updateGroup(groupId, {
        name: editName.trim(),
        description: editDesc.trim()
      })) as Record<string, unknown>;
      setGroup((prev: any) => ({ ...prev, ...g }));
      setView('settings');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function setVisibility(visibility: 'public' | 'private') {
    try {
      const g = (await updateGroup(groupId, { visibility })) as Record<string, unknown>;
      setGroup((prev: any) => ({ ...prev, ...g }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function setHistory(historyVisibility: 'visible' | 'hidden') {
    try {
      const g = (await updateGroup(groupId, { historyVisibility })) as Record<string, unknown>;
      setGroup((prev: any) => ({ ...prev, ...g }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function onLeave() {
    try {
      await leaveGroup(groupId);
      navigate('/focus/chats', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function onDelete() {
    if (!window.confirm(t('confirmDeleteGroup'))) return;
    try {
      await deleteGroup(groupId);
      navigate('/focus/chats', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function addPerson(userId: string) {
    setBusy(true);
    try {
      await addGroupMember(groupId, userId);
      await reload();
      setView('profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function kick(userId: string) {
    try {
      await removeGroupMember(groupId, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  if (loading && !group) return <PageLoader />;
  if (error && !group) return <ErrorBanner message={error} />;
  if (!group) return <EmptyState title={t('notMember')} />;

  /* ——— Edit profile (name / photo / description) ——— */
  if (view === 'edit') {
    return (
      <div className="tg-group-settings">
        <header className="tg-edit-top">
          <button type="button" className="focus-back-btn" onClick={() => setView('settings')}>
            ✕
          </button>
          <button
            type="button"
            className="tg-save-fab"
            disabled={busy || editName.trim().length < 2}
            onClick={() => void saveEdit()}
            aria-label={t('saveProfile')}
          >
            ✓
          </button>
        </header>
        <div className="tg-profile-hero">
          <FocusSpacePhoto
            kind="group"
            spaceId={groupId}
            name={editName || group.name}
            avatarUrl={group.avatarUrl}
            canEdit={canManage}
            onUpdated={(url) => setGroup((prev: any) => ({ ...prev, avatarUrl: url }))}
          />
        </div>
        <div className="tg-settings-card">
          <input
            className="tg-settings-field"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder={t('groupName')}
            dir="auto"
          />
          <textarea
            className="tg-settings-field"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder={t('description')}
            rows={3}
            dir="auto"
          />
        </div>
        {error ? <ErrorBanner message={error} /> : null}
      </div>
    );
  }

  /* ——— Settings list ——— */
  if (view === 'settings') {
    const inviteCount = group.inviteSlug ? 1 : 0;
    const adminCount = members.filter((m) => m.role === 'owner' || m.role === 'admin').length;
    return (
      <div className="tg-group-settings">
        <FocusBackBar
          title={t('groupSettings')}
          onBack={() => setView('profile')}
          trailing={
            canManage ? (
              <button type="button" className="focus-text-btn" onClick={() => setView('edit')}>
                {t('edit')}
              </button>
            ) : null
          }
        />
        {error ? <ErrorBanner message={error} /> : null}

        {canManage ? (
          <>
            <div className="tg-profile-hero compact">
              <FocusSpacePhoto
                kind="group"
                spaceId={groupId}
                name={group.name}
                avatarUrl={group.avatarUrl}
                canEdit={canManage}
                onUpdated={(url) => setGroup((prev: any) => ({ ...prev, avatarUrl: url }))}
              />
              <h1>{group.name}</h1>
            </div>

            <div className="tg-settings-card">
              <button type="button" className="tg-settings-row" onClick={() => void setVisibility(group.visibility === 'public' ? 'private' : 'public')}>
                <span className="tg-ico blue"><IconUsers size={18} /></span>
                <span className="tg-settings-main">
                  <strong>{t('groupType')}</strong>
                </span>
                <span className="muted tiny">
                  {group.visibility === 'public' ? t('publicGroup') : t('privateGroup')}
                </span>
              </button>
              <button type="button" className="tg-settings-row" onClick={() => void setHistory(group.historyVisibility === 'hidden' ? 'visible' : 'hidden')}>
                <span className="tg-ico green"><IconSend size={18} /></span>
                <span className="tg-settings-main">
                  <strong>{t('chatHistory')}</strong>
                </span>
                <span className="muted tiny">
                  {group.historyVisibility === 'hidden' ? t('historyHidden') : t('historyVisible')}
                </span>
              </button>
              <button type="button" className="tg-settings-row" onClick={() => void openInvite()}>
                <span className="tg-ico orange">🔗</span>
                <span className="tg-settings-main"><strong>{t('inviteLinks')}</strong></span>
                <span className="muted tiny">{inviteCount || 1}</span>
              </button>
              <button type="button" className="tg-settings-row" onClick={() => setView('edit')}>
                <span className="tg-ico purple">✎</span>
                <span className="tg-settings-main"><strong>{t('edit')}</strong></span>
                <span className="chev">›</span>
              </button>
            </div>
          </>
        ) : null}

        <div className="tg-settings-card">
          <button type="button" className="tg-settings-row" onClick={() => setView('profile')}>
            <span className="tg-ico blue"><IconUsers size={18} /></span>
            <span className="tg-settings-main"><strong>{t('members')}</strong></span>
            <span className="muted tiny">{memberCount}</span>
          </button>
          <button type="button" className="tg-settings-row" onClick={() => setView('profile')}>
            <span className="tg-ico green">★</span>
            <span className="tg-settings-main"><strong>{t('administrators')}</strong></span>
            <span className="muted tiny">{adminCount}</span>
          </button>
        </div>

        {!isOwner ? (
          <button type="button" className="tg-danger-btn" onClick={() => void onLeave()}>
            {t('leaveGroup')}
          </button>
        ) : (
          <button type="button" className="tg-danger-btn" onClick={() => void onDelete()}>
            {t('deleteGroup')}
          </button>
        )}

        <FocusInviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} url={inviteUrl} title={group.name} />
      </div>
    );
  }

  /* ——— Add members ——— */
  if (view === 'addMembers') {
    return (
      <div className="tg-group-settings">
        <FocusBackBar title={t('addMembers')} onBack={() => setView('profile')} />
        <div className="focus-search">
          <IconSearch size={16} />
          <input value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder={t('searchContacts')} />
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        <ul className="focus-pick-list">
          {contacts
            .filter((c) => !memberIds.has(c.id))
            .map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="focus-pick-row"
                  disabled={busy}
                  onClick={() => void addPerson(c.id)}
                >
                  <UserAvatar size="md" name={c.displayName || c.username} username={c.username} avatarUrl={c.avatarUrl} />
                  <span className="focus-contact-body">
                    <strong>{c.displayName || c.username}</strong>
                    <span className="muted">@{c.username}</span>
                  </span>
                  <IconPlus size={18} />
                </button>
              </li>
            ))}
        </ul>
      </div>
    );
  }

  /* ——— Profile (Telegram group info) ——— */
  if (view === 'profile') {
    return (
      <div className="tg-channel-profile">
        <header className="tg-profile-topbar">
          <button type="button" className="focus-back-btn" onClick={() => setView('chat')}>
            ←
          </button>
          <div className="tg-profile-top-actions">
            {canManage ? (
              <button type="button" className="focus-back-btn" onClick={() => setView('addMembers')} aria-label={t('addMembers')}>
                <IconPlus size={18} />
              </button>
            ) : null}
            {canManage ? (
              <button type="button" className="focus-text-btn" onClick={() => setView('edit')}>
                {t('edit')}
              </button>
            ) : null}
          </div>
        </header>

        <div className="tg-profile-hero">
          <FocusSpacePhoto
            kind="group"
            spaceId={groupId}
            name={group.name}
            avatarUrl={group.avatarUrl}
            canEdit={canManage}
            onUpdated={(url) => setGroup((prev: any) => ({ ...prev, avatarUrl: url }))}
          />
          <h1>{group.name}</h1>
          <p className="muted">
            {memberCount.toLocaleString(locale === 'ar' ? 'ar' : 'en')} {t('members')}
          </p>
        </div>

        <div className="tg-action-row">
          <button type="button" className="tg-action-btn" onClick={startVideoCall}>
            <IconVideo size={20} />
            <span>{t('videoChat')}</span>
          </button>
          <button type="button" className="tg-action-btn" onClick={() => void toggleMute()}>
            {muted ? <IconBell size={20} /> : <IconMute size={20} />}
            <span>{muted ? t('unmute') : t('mute')}</span>
          </button>
          <button
            type="button"
            className="tg-action-btn"
            onClick={() => {
              setSearchOpen(true);
              setView('chat');
            }}
          >
            <IconSearch size={20} />
            <span>{t('search')}</span>
          </button>
          <button type="button" className="tg-action-btn" onClick={() => setMoreOpen(true)}>
            <IconMore size={20} />
            <span>{t('more')}</span>
          </button>
        </div>

        {moreOpen ? (
          <div className="focus-sheet-backdrop" onClick={() => setMoreOpen(false)}>
            <div className="focus-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="focus-sheet-handle" />
              <button
                type="button"
                className="button"
                onClick={() => {
                  setMoreOpen(false);
                  void openInvite();
                }}
              >
                {t('shareInviteLink')}
              </button>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => {
                  setMoreOpen(false);
                  void toggleMute();
                }}
              >
                {muted ? t('unmute') : t('mute')}
              </button>
              {!isOwner ? (
                <button type="button" className="button button-ghost" style={{ color: '#ff453a' }} onClick={() => void onLeave()}>
                  {t('leaveGroup')}
                </button>
              ) : (
                <button type="button" className="button button-ghost" style={{ color: '#ff453a' }} onClick={() => void onDelete()}>
                  {t('deleteGroup')}
                </button>
              )}
              <button type="button" className="button button-ghost" onClick={() => setMoreOpen(false)}>
                {t('close')}
              </button>
            </div>
          </div>
        ) : null}

        <button type="button" className="tg-settings-entry" onClick={() => setView('settings')}>
          <span className="tg-ico orange"><IconSettings size={18} /></span>
          <strong>{t('groupSettings')}</strong>
          <span className="chev">›</span>
        </button>

        <section className="tg-members-card">
          {canManage ? (
            <button type="button" className="tg-member-row add" onClick={() => setView('addMembers')}>
              <span className="tg-add-member-ico">
                <IconUserPlus size={20} />
              </span>
              <strong className="tg-add-label">{t('addMembers')}</strong>
            </button>
          ) : null}
          {members.map((m) => {
            const name =
              m.user?.displayName?.trim() ||
              m.user?.username ||
              (m.userId.length > 16 ? m.userId.slice(0, 8) : m.userId);
            const badge = roleLabel(m.role, t);
            return (
              <div key={m.id} className="tg-member-row">
                <UserAvatar
                  size="md"
                  name={name}
                  username={m.user?.username}
                  avatarUrl={m.user?.avatarUrl}
                />
                <span className="focus-contact-body">
                  <strong>{name}</strong>
                  <span className={m.online ? 'is-online' : 'muted'}>
                    {m.online ? t('online') : t('lastSeenRecently')}
                  </span>
                </span>
                {badge ? <span className={`tg-role-badge ${m.role}`}>{badge}</span> : null}
                {canManage && m.role !== 'owner' && m.userId !== meId ? (
                  <button type="button" className="tg-kick" onClick={() => void kick(m.userId)}>
                    ✕
                  </button>
                ) : null}
              </div>
            );
          })}
        </section>

        <div className="tg-media-strip">
          <span className="tg-tab is-active">{t('tabMedia')}</span>
          <p className="muted tiny pad-inline">{t('emptyTabContent')}</p>
        </div>

        <FocusInviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} url={inviteUrl} title={group.name} />
      </div>
    );
  }

  /* ——— Chat ——— */
  return (
    <div className="tg-channel-chat">
      <FocusBackBar
        fallbackTo="/focus/chats"
        title={group.name}
        subtitle={`${memberCount} ${t('members')}`}
        trailing={
          <button type="button" className="focus-header-avatar" onClick={() => setView('profile')}>
            <UserAvatar size="sm" name={group.name} avatarUrl={group.avatarUrl} />
          </button>
        }
      />

      {searchOpen ? (
        <div className="focus-search tg-search-bar">
          <IconSearch size={16} />
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder={t('search')} autoFocus />
          <button type="button" className="focus-text-btn" onClick={() => setSearchOpen(false)}>
            {t('cancel')}
          </button>
        </div>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      <div className="tg-channel-msg-list tg-group-msg-list">
        {visibleMessages.length === 0 ? (
          <p className="focus-empty-inline muted">{t('noMessagesYet')}</p>
        ) : null}
        {visibleMessages.map((m) => {
          const mine = meId && m.senderId === meId;
          return (
            <div key={m.id} className={`tg-msg-row ${mine ? 'mine' : 'theirs'}`}>
              {!mine ? (
                <UserAvatar
                  size="sm"
                  name={m.sender?.displayName}
                  username={m.sender?.username}
                  avatarUrl={m.sender?.avatarUrl}
                />
              ) : (
                <span className="tg-msg-spacer" />
              )}
              <div className={`tg-bubble ${mine ? 'mine' : ''}`}>
                {!mine ? (
                  <span className="tg-sender">{m.sender?.displayName || m.sender?.username || 'user'}</span>
                ) : null}
                <p dir="auto">{m.encryptedContent}</p>
                <span className="tg-bubble-time">{formatMsgTime(m.timestamp, locale)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <form className="tg-channel-composer" onSubmit={(e) => void send(e)}>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            getRealtimeSocket()?.emit('group:typing', {
              groupId,
              isTyping: Boolean(e.target.value.trim())
            });
          }}
          placeholder={t('typeMessage')}
          dir="auto"
        />
        <button type="submit" className="icon-btn" disabled={!text.trim()} aria-label={t('send')}>
          <IconSend size={20} />
        </button>
      </form>
    </div>
  );
}
