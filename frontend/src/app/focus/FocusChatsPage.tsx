import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  fetchUnifiedInbox,
  pinInboxItem,
  setChatMute,
  unpinInboxItem,
  type UnifiedInboxItem
} from '@/api/focus';
import { blockUser, deleteGroup, leaveChannel, leaveGroup, unblockUser } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner, PageLoader } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { IconCompose, IconMegaphone, IconMore, IconPlus, IconSearch, IconUsers } from '../ui/Icons';
import { getRealtimeSocket } from '@/lib/realtime';

type Filter = 'all' | 'dm' | 'group' | 'channel' | 'archived';

const ARCHIVE_KEY = 'securechat-focus-archived';
const BLOCKED_KEY = 'securechat-focus-blocked';

function formatTime(iso: string | null, locale: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString(locale === 'ar' ? 'ar' : 'en', {
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function rowKey(row: UnifiedInboxItem) {
  return `${row.type}:${row.id}`;
}

function readSet(key: string): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>) {
  window.localStorage.setItem(key, JSON.stringify([...set]));
}

export function FocusChatsPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<UnifiedInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [archived, setArchived] = useState<Set<string>>(() => readSet(ARCHIVE_KEY));
  const [blocked, setBlocked] = useState<Set<string>>(() => readSet(BLOCKED_KEY));

  async function reload() {
    setLoading(true);
    setError('');
    try {
      setItems(await fetchUnifiedInbox(80, 'focus'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    const socket = getRealtimeSocket();
    if (!socket) return;
    const refresh = () => void reload();
    socket.on('message:new', refresh);
    socket.on('group:message:new', refresh);
    socket.on('channel:message:new', refresh);
    return () => {
      socket.off('message:new', refresh);
      socket.off('group:message:new', refresh);
      socket.off('channel:message:new', refresh);
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = [...items].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned && b.pinned) return (a.pinSortOrder ?? 0) - (b.pinSortOrder ?? 0);
      const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
      const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
      return tb - ta;
    });

    list = list.filter((row) => {
      const key = rowKey(row);
      const isArchived = archived.has(key);
      const isBlocked = blocked.has(key);
      if (filter === 'archived') return isArchived || isBlocked;
      if (isArchived || isBlocked) return false;
      if (filter === 'dm') return row.type === 'dm';
      if (filter === 'group') return row.type === 'group';
      if (filter === 'channel') return row.type === 'channel';
      return true;
    });

    if (!needle) return list;
    return list.filter(
      (row) =>
        row.title.toLowerCase().includes(needle) ||
        (row.subtitle || '').toLowerCase().includes(needle) ||
        (row.lastMessage || '').toLowerCase().includes(needle)
    );
  }, [items, q, filter, archived, blocked]);

  function openRow(row: UnifiedInboxItem) {
    setMenuKey(null);
    if (row.type === 'dm') {
      navigate(`/focus/chats/dm/${row.id}`, {
        state: {
          peer: {
            id: row.id,
            username: row.username || undefined,
            displayName: row.title,
            avatarUrl: row.avatarUrl
          }
        }
      });
    } else if (row.type === 'group') navigate(`/focus/chats/group/${row.id}`);
    else navigate(`/focus/chats/channel/${row.id}`);
  }

  async function togglePin(row: UnifiedInboxItem) {
    setMenuKey(null);
    try {
      if (row.pinned) await unpinInboxItem(row.type, row.id);
      else await pinInboxItem(row.type, row.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function toggleMute(row: UnifiedInboxItem) {
    setMenuKey(null);
    try {
      await setChatMute(row.type, row.id, !row.muted);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  function toggleArchive(row: UnifiedInboxItem) {
    setMenuKey(null);
    const key = rowKey(row);
    setArchived((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeSet(ARCHIVE_KEY, next);
      return next;
    });
  }

  async function leaveOrDelete(row: UnifiedInboxItem) {
    setMenuKey(null);
    try {
      if (row.type === 'group') {
        const okLeave = window.confirm(t('confirmLeaveGroup'));
        if (!okLeave) return;
        try {
          await leaveGroup(row.id);
        } catch {
          if (window.confirm(t('confirmDeleteGroup'))) await deleteGroup(row.id);
          else return;
        }
      } else if (row.type === 'channel') {
        if (!window.confirm(t('confirmLeaveChannel'))) return;
        await leaveChannel(row.id);
      } else {
        toggleArchive(row);
        return;
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function toggleBlock(row: UnifiedInboxItem) {
    setMenuKey(null);
    const key = rowKey(row);
    const isBlocked = blocked.has(key);
    try {
      if (isBlocked) {
        if (row.type === 'dm') await unblockUser(row.id);
        setBlocked((prev) => {
          const next = new Set(prev);
          next.delete(key);
          writeSet(BLOCKED_KEY, next);
          return next;
        });
      } else {
        const msg =
          row.type === 'dm' ? t('confirmBlockUser') : t('confirmBlockChat');
        if (!window.confirm(msg)) return;
        if (row.type === 'dm') await blockUser(row.id);
        setBlocked((prev) => {
          const next = new Set(prev);
          next.add(key);
          writeSet(BLOCKED_KEY, next);
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  if (loading && items.length === 0) return <PageLoader />;

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('filterAll') },
    { id: 'dm', label: t('filterUsers') },
    { id: 'group', label: t('filterGroups') },
    { id: 'channel', label: t('filterChannels') },
    { id: 'archived', label: t('filterArchived') }
  ];

  return (
    <div className="focus-chats">
      <div className="focus-inbox-pane">
        <div className="focus-chats-header">
          <span className="focus-header-spacer" />
          <h1>{t('focusChats')}</h1>
          <div className="focus-chats-actions">
            <Link to="/focus/contacts" className="icon-btn" aria-label={t('newMessage')}>
              <IconCompose size={20} />
            </Link>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('create')}
              onClick={() => setCreateOpen((v) => !v)}
            >
              <IconPlus size={20} />
            </button>
          </div>
        </div>

        {createOpen ? (
          <div className="focus-create-panel">
            <div className="focus-create-kinds">
              <button type="button" className="is-active" onClick={() => navigate('/focus/create/group')}>
                <IconUsers size={16} /> {t('createGroup')}
              </button>
              <button type="button" onClick={() => navigate('/focus/create/channel')}>
                <IconMegaphone size={16} /> {t('createChannel')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="focus-filter-tabs" role="tablist">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? 'is-active' : ''}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
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

        {error ? <ErrorBanner message={error} /> : null}

        {filtered.length === 0 ? (
          <p className="focus-empty-inline muted">{t('emptyFocusChats')}</p>
        ) : (
          <ul className="focus-chat-list">
            {filtered.map((row) => {
              const key = rowKey(row);
              const menuOpen = menuKey === key;
              const isBlocked = blocked.has(key);
              return (
                <li key={key} className={row.pinned ? 'is-pinned' : ''}>
                  <div className="focus-chat-row-wrap">
                    <button type="button" className="focus-chat-row" onClick={() => openRow(row)}>
                      <UserAvatar
                        size="lg"
                        name={row.title}
                        username={row.username || row.title}
                        avatarUrl={row.avatarUrl}
                      />
                      <span className="focus-chat-body">
                        <span className="focus-chat-top">
                          <strong>
                            {row.title}
                            {row.type === 'group' ? (
                              <span className="focus-type-tag">{t('groups')}</span>
                            ) : null}
                            {row.type === 'channel' ? (
                              <span className="focus-type-tag">{t('channels')}</span>
                            ) : null}
                            {isBlocked ? (
                              <span className="focus-type-tag danger">{t('blockedTag')}</span>
                            ) : null}
                          </strong>
                          <time>{formatTime(row.lastAt, locale)}</time>
                        </span>
                        <span className="focus-chat-bottom">
                          <span className="muted ellipsis">{row.lastMessage || t('noMessagesYet')}</span>
                          {row.unreadCount > 0 ? (
                            <span className={`focus-unread${row.muted ? ' is-muted' : ''}`}>
                              {row.unreadCount > 99 ? '99+' : row.unreadCount}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="focus-row-more"
                      aria-label={t('more')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuKey(menuOpen ? null : key);
                      }}
                    >
                      <IconMore size={18} />
                    </button>
                  </div>

                  {menuOpen ? (
                    <div className="focus-row-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => void togglePin(row)}>
                        {row.pinned ? t('unpin') : t('pin')}
                      </button>
                      <button type="button" role="menuitem" onClick={() => void toggleMute(row)}>
                        {row.muted ? t('unmute') : t('mute')}
                      </button>
                      <button type="button" role="menuitem" onClick={() => toggleArchive(row)}>
                        {archived.has(key) ? t('unarchiveChat') : t('archiveChat')}
                      </button>
                      <button type="button" role="menuitem" onClick={() => void toggleBlock(row)}>
                        {isBlocked ? t('unblock') : t('block')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={() => void leaveOrDelete(row)}
                      >
                        {row.type === 'dm'
                          ? t('deleteChat')
                          : row.type === 'group'
                            ? t('leaveGroup')
                            : t('leaveChannel')}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {menuKey ? (
          <button
            type="button"
            className="focus-menu-scrim"
            aria-label={t('close')}
            onClick={() => setMenuKey(null)}
          />
        ) : null}
      </div>

      <div className="focus-inbox-stage" aria-hidden="true">
        <p className="focus-inbox-stage-hint muted">{t('focusSelectChat')}</p>
      </div>
    </div>
  );
}
