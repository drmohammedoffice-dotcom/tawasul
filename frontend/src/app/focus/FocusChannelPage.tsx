import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  fetchChannel,
  fetchChannelInvite,
  fetchChannelMessages,
  leaveChannel,
  pinChannelMessage
} from '@/api/social';
import { fetchUnifiedInbox, setChatMute } from '@/api/focus';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { getRealtimeSocket } from '@/lib/realtime';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import {
  IconBell,
  IconChat,
  IconEye,
  IconMegaphone,
  IconMore,
  IconMute,
  IconSearch,
  IconSend
} from '../ui/Icons';
import { FocusBackBar } from './FocusBackBar';
import { FocusInviteSheet } from './FocusInviteSheet';
import { FocusSpacePhoto } from './FocusSpacePhoto';

type TabKey = 'media' | 'links';

type ChannelMsg = {
  id: string;
  channelId?: string;
  senderId: string;
  encryptedContent: string;
  timestamp: string;
  viewCount?: number;
  editedAt?: string | null;
  sender?: {
    id: string;
    username?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
};

function extractLinks(text: string): string[] {
  const re = /https?:\/\/[^\s<>"']+/gi;
  return text.match(re) || [];
}

function formatViews(n: number, locale: string) {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', {
      notation: n >= 1000 ? 'compact' : 'standard',
      maximumFractionDigits: 1
    }).format(n);
  } catch {
    return String(n);
  }
}

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

function formatFullDate(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleString(locale === 'ar' ? 'ar' : 'en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

export function FocusChannelPage() {
  const { t, locale } = useI18n();
  const { session } = useAuth();
  const navigate = useNavigate();
  const { channelId = '' } = useParams();

  const [channel, setChannel] = useState<any>(null);
  const [messages, setMessages] = useState<ChannelMsg[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'chat' | 'profile'>('chat');
  const [tab, setTab] = useState<TabKey>('media');
  const [muted, setMuted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');

  const canPost = channel?.myRole === 'owner' || channel?.myRole === 'admin';
  const subscriberCount = channel?._count?.subscriptions ?? 0;

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const ch = await fetchChannel(channelId);
      setChannel(ch);
      const msgs = (await fetchChannelMessages(channelId)) as ChannelMsg[];
      setMessages(msgs);
      try {
        const inbox = await fetchUnifiedInbox(80, 'focus');
        const row = inbox.find((i) => i.type === 'channel' && i.id === channelId);
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
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return;
    const socket = getRealtimeSocket();
    if (!socket) return;
    const onNew = (data: ChannelMsg) => {
      if (data?.channelId && data.channelId !== channelId) return;
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
    };
    const join = () => {
      socket.emit('channel:join', { channelId });
    };
    socket.on('channel:message:new', onNew);
    if (socket.connected) join();
    socket.on('connect', join);
    return () => {
      socket.off('channel:message:new', onNew);
      socket.off('connect', join);
      socket.emit('channel:leave', { channelId });
    };
  }, [channelId]);

  const pinned = useMemo(() => {
    if (!channel?.pinnedMessageId) return null;
    return messages.find((m) => m.id === channel.pinnedMessageId) || null;
  }, [channel?.pinnedMessageId, messages]);

  const visibleMessages = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    if (!needle) return messages;
    return messages.filter((m) => m.encryptedContent.toLowerCase().includes(needle));
  }, [messages, searchQ]);

  const linkItems = useMemo(() => {
    const out: { url: string; snippet: string; at: string; id: string }[] = [];
    for (const m of messages) {
      for (const url of extractLinks(m.encryptedContent)) {
        out.push({
          id: `${m.id}:${url}`,
          url,
          snippet: m.encryptedContent.slice(0, 160),
          at: m.timestamp
        });
      }
    }
    return out;
  }, [messages]);

  async function openInvite() {
    try {
      const inv = await fetchChannelInvite(channelId);
      const url = `${window.location.origin}/focus/join/${inv.inviteSlug}`;
      setInviteUrl(url);
      setInviteOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function toggleMute() {
    try {
      await setChatMute('channel', channelId, !muted);
      setMuted((v) => !v);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function onLeave() {
    setMoreOpen(false);
    try {
      await leaveChannel(channelId);
      navigate('/focus/chats', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

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
      { channelId, encryptedContent: content },
      (ack: { success?: boolean; data?: ChannelMsg; message?: string }) => {
        if (ack?.data) {
          setMessages((prev) =>
            prev.some((m) => m.id === ack.data!.id) ? prev : [...prev, ack.data!]
          );
        }
        if (ack && ack.success === false) {
          setError(ack.message || t('onlyAdminsPost'));
        }
      }
    );
  }

  async function pinMsg(messageId: string) {
    try {
      await pinChannelMessage(channelId, messageId);
      setChannel((prev: any) => (prev ? { ...prev, pinnedMessageId: messageId } : prev));
      setMoreOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  if (loading && !channel) return <PageLoader />;
  if (error && !channel) return <ErrorBanner message={error} />;
  if (!channel) return <EmptyState title={t('notMember')} />;

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'media', label: t('tabMedia') },
    { key: 'links', label: t('tabLinks') }
  ];

  if (view === 'profile') {
    return (
      <div className="tg-channel-profile">
        <FocusBackBar
          fallbackTo={`/focus/chats/channel/${channelId}`}
          onBack={() => setView('chat')}
        />
        <div className="tg-profile-hero">
          <FocusSpacePhoto
            kind="channel"
            spaceId={channelId}
            name={channel.name}
            avatarUrl={channel.avatarUrl}
            canEdit={canPost}
            onUpdated={(url) => setChannel((prev: any) => ({ ...prev, avatarUrl: url }))}
          />
          <h1>{channel.name}</h1>
          <p className="muted">
            {subscriberCount.toLocaleString(locale === 'ar' ? 'ar' : 'en')} {t('subscribers')}
          </p>
        </div>

        <div className="tg-action-row">
          <button type="button" className="tg-action-btn" onClick={() => setView('chat')}>
            <IconChat size={20} />
            <span>{t('messageAction')}</span>
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
              <button
                type="button"
                className="button button-ghost"
                style={{ color: '#ff453a' }}
                onClick={() => void onLeave()}
              >
                {t('leaveChannel')}
              </button>
              <button type="button" className="button button-ghost" onClick={() => setMoreOpen(false)}>
                {t('close')}
              </button>
            </div>
          </div>
        ) : null}

        <section className="tg-info-card">
          <div className="tg-info-row">
            <div>
              <span className="tg-info-label">{t('shareInviteLink')}</span>
              <button type="button" className="tg-info-link" onClick={() => void openInvite()}>
                {inviteUrl || t('tapToGetInviteLink')}
              </button>
            </div>
          </div>
          <div className="tg-info-row">
            <div>
              <span className="tg-info-label">{t('description')}</span>
              <p className="tg-info-desc" dir="auto">
                {channel.description || t('noDescription')}
              </p>
            </div>
          </div>
        </section>

        <div className="tg-tabs" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={`tg-tab${tab === item.key ? ' is-active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="tg-tab-panel">
          {tab === 'links' ? (
            linkItems.length ? (
              <ul className="tg-link-list">
                {linkItems.map((item) => (
                  <li key={item.id}>
                    <a href={item.url} target="_blank" rel="noreferrer" className="tg-link-row">
                      <span className="tg-link-icon">🔗</span>
                      <span>
                        <strong className="ellipsis">{item.url}</strong>
                        <span className="muted tiny ellipsis">{item.snippet}</span>
                        <span className="muted tiny">{formatFullDate(item.at, locale)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="focus-empty-inline muted">{t('emptyTabContent')}</p>
            )
          ) : (
            <p className="focus-empty-inline muted">{t('emptyTabContent')}</p>
          )}
        </div>

        <FocusInviteSheet
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          url={inviteUrl}
          title={channel.name}
          shareText={`${t('inviteFriendsShare')}: ${channel.name}`}
        />
      </div>
    );
  }

  return (
    <div className="tg-channel-chat">
      <header className="tg-channel-chat-header">
        <FocusBackBar
          fallbackTo="/focus/chats"
          title={channel.name}
          subtitle={`${subscriberCount.toLocaleString(locale === 'ar' ? 'ar' : 'en')} ${t('subscribers')}`}
          trailing={
            <button type="button" className="focus-header-avatar" onClick={() => setView('profile')}>
              <UserAvatar size="sm" name={channel.name} avatarUrl={channel.avatarUrl} />
            </button>
          }
        />
      </header>

      {pinned ? (
        <button type="button" className="tg-pinned-bar" onClick={() => setView('profile')}>
          <IconMegaphone size={16} />
          <span className="ellipsis">
            <strong>{t('pinnedMessage')}</strong> {pinned.encryptedContent.slice(0, 80)}
          </span>
        </button>
      ) : null}

      {searchOpen ? (
        <div className="focus-search tg-search-bar">
          <IconSearch size={16} />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder={t('search')}
            autoFocus
          />
          <button type="button" className="focus-text-btn" onClick={() => setSearchOpen(false)}>
            {t('cancel')}
          </button>
        </div>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      <div className="tg-channel-msg-list">
        {visibleMessages.length === 0 ? (
          <p className="focus-empty-inline muted">{t('noMessagesYet')}</p>
        ) : null}
        {visibleMessages.map((m) => {
          const links = extractLinks(m.encryptedContent);
          return (
            <article key={m.id} className="tg-channel-bubble">
              <p dir="auto">{m.encryptedContent}</p>
              {links.map((url) => (
                <a key={url} href={url} className="tg-inline-link" target="_blank" rel="noreferrer">
                  {url}
                </a>
              ))}
              <footer className="tg-bubble-meta">
                <span className="tg-views">
                  <IconEye size={12} /> {formatViews(m.viewCount ?? 0, locale)}
                </span>
                {m.sender?.displayName || m.sender?.username ? (
                  <span className="tg-poster">{m.sender.displayName || m.sender.username}</span>
                ) : null}
                <span>{formatMsgTime(m.timestamp, locale)}</span>
                {m.editedAt ? <span>{t('edited')}</span> : null}
                {canPost ? (
                  <button type="button" className="tg-pin-mini" onClick={() => void pinMsg(m.id)}>
                    {t('pin')}
                  </button>
                ) : null}
              </footer>
            </article>
          );
        })}
      </div>

      {canPost ? (
        <form className="tg-channel-composer" onSubmit={(e) => void send(e)}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('typeMessage')}
            dir="auto"
          />
          <button type="submit" className="icon-btn" disabled={!text.trim()} aria-label={t('send')}>
            <IconSend size={20} />
          </button>
        </form>
      ) : (
        <div className="tg-channel-subscriber-bar">
          <button type="button" className="icon-btn" onClick={() => setView('profile')} aria-label={t('more')}>
            <IconChat size={20} />
          </button>
          <button type="button" className="button tg-unmute-wide" onClick={() => void toggleMute()}>
            {muted ? t('unmute') : t('mute')}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSearchOpen(true)}
            aria-label={t('search')}
          >
            <IconSearch size={20} />
          </button>
        </div>
      )}

      <FocusInviteSheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        url={inviteUrl}
        title={channel.name}
      />
    </div>
  );
}

export function FocusJoinChannelPage() {
  const { t } = useI18n();
  const { inviteSlug = '' } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { joinChannelByInvite } = await import('@/api/social');
        const sub = (await joinChannelByInvite(inviteSlug)) as { channelId?: string };
        if (cancelled) return;
        // join returns subscription; fetch channel id via invite slug path — API returns sub with channelId ideally
        const channelId = (sub as any)?.channelId;
        if (channelId) navigate(`/focus/chats/channel/${channelId}`, { replace: true });
        else navigate('/focus/chats', { replace: true });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('errorGeneric'));
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteSlug, navigate, t]);

  return (
    <div className="focus-wizard">
      <FocusBackBar title={t('joinChannel')} fallbackTo="/focus/chats" />
      {busy ? <PageLoader /> : null}
      {error ? (
        <>
          <ErrorBanner message={error} />
          <Link to="/focus/chats" className="button">
            {t('focusChats')}
          </Link>
        </>
      ) : null}
    </div>
  );
}
