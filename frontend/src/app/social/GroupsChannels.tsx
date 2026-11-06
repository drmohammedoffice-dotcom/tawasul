import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  addChannelSubscriber,
  addGroupMember,
  createChannel,
  createGroup,
  fetchChannel,
  fetchChannelMessages,
  fetchChannelSubscriptions,
  fetchGroup,
  fetchGroupMembers,
  fetchGroupMessages,
  fetchMyChannels,
  fetchMyGroups
} from '@/api/social';
import { pinSpace } from '@/api/messagingExtras';
import { markChannelRead, markGroupRead } from '@/api/focus';
import { useI18n } from '@/i18n/I18nProvider';
import { clientRequestId, getRealtimeSocket } from '@/lib/realtime';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { UserPicker } from '../ui/UserPicker';
import { getSessionSnapshot } from '@/lib/sessionBridge';

function upsertMessage(list: any[], msg: any) {
  if (!msg?.id) return list;
  if (list.some((m) => m.id === msg.id)) return list;
  return [...list, msg];
}

export function GroupsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      setItems(await fetchMyGroups());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    try {
      await createGroup(name.trim());
      setName('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div>
      <div className="page-header">
        <h1>{t('groups')}</h1>
      </div>
      <form className="create-form" onSubmit={(e) => void onCreate(e)}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('groupName')} minLength={2} />
        <button className="button" type="submit">
          {t('createGroup')}
        </button>
      </form>
      {error ? <ErrorBanner message={error} /> : null}
      {items.length === 0 ? <EmptyState title={t('emptyGroups')} /> : null}
      {items.map((g) => (
        <Link key={g.id} className="list-row card-link" to={`/focus/chats/group/${g.id}`}>
          <strong>{g.name}</strong>
          <span className="muted">
            {g.myRole} · {g._count?.members ?? 0} {t('members')}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function GroupDetailPage() {
  const { t } = useI18n();
  const { groupId = '' } = useParams();
  const location = useLocation();
  const backTo = location.pathname.startsWith('/focus') ? '/focus/chats' : '/groups';
  const [group, setGroup] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);

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
      setMembers(m);
      setMessages(msgs);
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
    void markGroupRead(groupId).catch(() => undefined);
  }, [groupId, messages.length]);

  useEffect(() => {
    if (!groupId) return;
    const socket = getRealtimeSocket();
    if (!socket) return;
    const onNew = (data: any) => {
      if (data?.groupId && data.groupId !== groupId) return;
      setMessages((prev) => upsertMessage(prev, data));
      void markGroupRead(groupId).catch(() => undefined);
    };
    const join = () => {
      socket.emit('group:join', { groupId }, (ack: any) => {
        if (ack && ack.success === false) {
          setError(t('notMember'));
        }
      });
    };
    socket.on('group:message:new', onNew);
    if (socket.connected) join();
    socket.on('connect', join);
    return () => {
      socket.off('group:message:new', onNew);
      socket.off('connect', join);
      socket.emit('group:leave', { groupId });
    };
  }, [groupId, t]);

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
      (ack: any) => {
        if (ack?.data) setMessages((prev) => upsertMessage(prev, ack.data));
        if (ack && ack.success === false) setError(t('errorGeneric'));
      }
    );
  }

  async function addMember(user: { id: string; username: string }) {
    setAdding(true);
    setError('');
    try {
      await addGroupMember(groupId, user.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <PageLoader />;
  if (error && !group) return <ErrorBanner message={error} />;
  if (!group) return <EmptyState title={t('notMember')} />;

  const canManage = group.myRole === 'owner' || group.myRole === 'admin';
  const meId = getSessionSnapshot()?.user?.id;

  return (
    <div className="tg-chat-shell">
      <header className="tg-chat-header">
        <Link to={backTo} className="focus-back-btn" aria-label="Back">
          ←
        </Link>
        <button type="button" className="tg-chat-title" onClick={() => setShowInfo((v) => !v)}>
          <UserAvatar size="sm" name={group.name} />
          <span>
            <strong>{group.name}</strong>
            <span className="muted tiny">
              {members.length} {t('members')}
            </span>
          </span>
        </button>
        <div className="inline-actions">
          <button
            type="button"
            className="button button-ghost button-compact"
            onClick={() =>
              void pinSpace('group', groupId)
                .then(() => undefined)
                .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
            }
          >
            {t('pinSpace')}
          </button>
          {canManage ? (
            <button
              type="button"
              className="button button-compact"
              onClick={() => {
                const socket = getRealtimeSocket();
                socket?.emit('call:invite', { scope: 'group', spaceId: groupId, kind: 'audio' });
              }}
            >
              {t('startGroupCall')}
            </button>
          ) : null}
        </div>
      </header>
      {error ? <ErrorBanner message={error} /> : null}
      {showInfo ? (
        <section className="tg-chat-info panel-block">
          {members.map((m) => (
            <div key={m.id} className="list-row">
              <Link to={`/u/${m.user?.username}`} className="tg-member-row">
                <UserAvatar
                  size="sm"
                  name={m.user?.displayName}
                  username={m.user?.username}
                  avatarUrl={m.user?.avatarUrl}
                />
                @{m.user?.username}
              </Link>
            </div>
          ))}
          {canManage ? (
            <div className="panel-block">
              <h3>{t('addMember')}</h3>
              <UserPicker disabled={adding} onPick={(u) => void addMember(u)} />
            </div>
          ) : null}
        </section>
      ) : null}
      <div className="tg-msg-list">
        {messages.map((m) => {
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
              <div className="tg-bubble">
                {!mine ? <span className="tg-sender">@{m.sender?.username || 'user'}</span> : null}
                <p dir="auto">{m.encryptedContent}</p>
              </div>
            </div>
          );
        })}
      </div>
      <form className="tg-composer comment-form" onSubmit={(e) => void send(e)}>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const socket = getRealtimeSocket();
            socket?.emit('group:typing', { groupId, isTyping: Boolean(e.target.value.trim()) });
          }}
          placeholder={t('typeMessage')}
          dir="auto"
          enterKeyHint="send"
        />
        <button className="button" type="submit" disabled={!text.trim()}>
          {t('send')}
        </button>
      </form>
    </div>
  );
}

export function ChannelsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      setItems(await fetchMyChannels());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createChannel(name.trim());
      setName('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div>
      <div className="page-header">
        <h1>{t('channels')}</h1>
      </div>
      <form className="create-form" onSubmit={(e) => void onCreate(e)}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('channelName')} minLength={2} />
        <button className="button" type="submit">
          {t('createChannel')}
        </button>
      </form>
      {error ? <ErrorBanner message={error} /> : null}
      {items.length === 0 ? <EmptyState title={t('emptyChannels')} /> : null}
      {items.map((c) => (
        <Link key={c.id} className="list-row card-link" to={`/focus/chats/channel/${c.id}`}>
          <strong>{c.name}</strong>
          <span className="muted">
            {c.myRole} · {c._count?.subscriptions ?? 0} {t('subscribers')}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function ChannelDetailPage() {
  const { t } = useI18n();
  const { channelId = '' } = useParams();
  const [channel, setChannel] = useState<any>(null);
  const [subs, setSubs] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const ch = await fetchChannel(channelId);
      setChannel(ch);
      const msgs = await fetchChannelMessages(channelId);
      setMessages(msgs);
      if (ch.myRole === 'owner' || ch.myRole === 'admin') {
        setSubs(await fetchChannelSubscriptions(channelId));
      } else {
        setSubs([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return;
    void markChannelRead(channelId).catch(() => undefined);
  }, [channelId, messages.length]);

  useEffect(() => {
    if (!channelId) return;
    const socket = getRealtimeSocket();
    if (!socket) return;
    const onNew = (data: any) => {
      if (data?.channelId && data.channelId !== channelId) return;
      setMessages((prev) => upsertMessage(prev, data));
      void markChannelRead(channelId).catch(() => undefined);
    };
    const join = () => {
      socket.emit('channel:join', { channelId }, (ack: any) => {
        if (ack && ack.success === false) setError(t('notMember'));
      });
    };
    socket.on('channel:message:new', onNew);
    if (socket.connected) join();
    socket.on('connect', join);
    return () => {
      socket.off('channel:message:new', onNew);
      socket.off('connect', join);
      socket.emit('channel:leave', { channelId });
    };
  }, [channelId, t]);

  const canPost = channel?.myRole === 'owner' || channel?.myRole === 'admin';

  function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || !canPost) return;
    const socket = getRealtimeSocket();
    if (!socket) {
      setError(t('errorGeneric'));
      return;
    }
    const content = text.trim();
    setText('');
    socket.emit(
      'channel:message:send',
      { channelId, encryptedContent: content, clientRequestId: clientRequestId('c') },
      (ack: any) => {
        if (ack?.data) setMessages((prev) => upsertMessage(prev, ack.data));
        if (ack && (ack.success === false || ack.message?.includes?.('Forbidden'))) {
          setError(t('onlyAdminsPost'));
        }
      }
    );
  }

  async function addSub(user: { id: string }) {
    setAdding(true);
    setError('');
    try {
      await addChannelSubscriber(channelId, user.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <PageLoader />;
  if (error && !channel) return <ErrorBanner message={error} />;
  if (!channel) return <EmptyState title={t('notMember')} />;

  const meId = getSessionSnapshot()?.user?.id;

  return (
    <div className="tg-chat-shell">
      <header className="tg-chat-header">
        <Link to="/channels" className="button button-ghost button-compact">
          ←
        </Link>
        <div className="tg-chat-title">
          <UserAvatar size="sm" name={channel.name} />
          <span>
            <strong>{channel.name}</strong>
            <span className="muted tiny">{t('channels')}</span>
          </span>
        </div>
      </header>
      {error ? <ErrorBanner message={error} /> : null}
      {canPost ? (
        <section className="tg-chat-info panel-block">
          <h2>{t('subscribers')}</h2>
          {subs.map((s) => (
            <div key={s.id} className="list-row">
              <Link to={`/u/${s.user?.username}`} className="tg-member-row">
                <UserAvatar
                  size="sm"
                  name={s.user?.displayName}
                  username={s.user?.username}
                  avatarUrl={s.user?.avatarUrl}
                />
                @{s.user?.username || s.userId}
              </Link>
            </div>
          ))}
          <UserPicker disabled={adding} onPick={(u) => void addSub(u)} />
        </section>
      ) : null}
      <div className="tg-msg-list">
        {messages.map((m) => {
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
              <div className="tg-bubble">
                {!mine ? <span className="tg-sender">@{m.sender?.username || 'user'}</span> : null}
                <p dir="auto">{m.encryptedContent}</p>
              </div>
            </div>
          );
        })}
      </div>
      {canPost ? (
        <form className="tg-composer comment-form" onSubmit={(e) => void send(e)}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('typeMessage')}
            dir="auto"
            enterKeyHint="send"
          />
          <button className="button" type="submit" disabled={!text.trim()}>
            {t('send')}
          </button>
        </form>
      ) : (
        <p className="muted pad-inline">{t('onlyAdminsPost')}</p>
      )}
    </div>
  );
}
