import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import type { ConversationSummary } from '@/api/client';
import {
  searchAll,
  uploadMediaFile,
  fetchMediaUrl,
  resolveMediaUrl,
  blockUser,
  fetchUserProfile,
  fetchFollowing,
  followUser,
  fetchMyGroups,
  fetchMyChannels,
  sendGroupMessage,
  sendChannelMessage
} from '@/api/social';
import type { PrivateMessage } from '@/types/api';
import { useAuth } from '@/auth/AuthProvider';
import { listVaultAccounts, upsertVaultAccount, vaultToSession, type VaultAccount } from '@/lib/accountVault';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { useI18n } from '@/i18n/I18nProvider';
import {
  IconBack,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconCompose,
  IconImage,
  IconMic,
  IconMore,
  IconPhone,
  IconPin,
  IconSearch,
  IconSendArrow,
  IconSticker,
  IconVideo
} from './ui/Icons';
import { UserAvatar } from './ui/UserAvatar';
import { AvatarCrop } from './ui/AvatarCrop';
import { parseShareContent, ShareContentBubble, sharePreviewLabel } from './ui/ShareContentBubble';

type SendOpts = {
  mediaIds?: string[];
  text?: string;
  replyToMessageId?: string;
  forwardFromMessageId?: string;
  toUserId?: string;
};

type Props = {
  username: string;
  userRole: 'free' | 'premium';
  theme: 'dark' | 'light';
  isOpeningChat: boolean;
  peerId: string;
  draft: string;
  typingHint: string;
  onlineByUser: Record<string, boolean>;
  messagesByPeer: Record<string, PrivateMessage[]>;
  conversations: ConversationSummary[];
  conversationsLoading: boolean;
  conversationsError: string;
  currentUserId: string;
  hasMoreByPeer: Record<string, boolean>;
  peerMeta: Record<string, { username?: string; displayName?: string | null; avatarUrl?: string | null }>;
  smartReplies: string[];
  smartReplyLoading: boolean;
  uploadProgress: number | null;
  reconnecting?: boolean;
  socket?: Socket | null;
  onPeerChange: (peerId: string) => void;
  onOpenChat: (peerId?: string) => Promise<void>;
  onSelectChat: (peerId: string) => void;
  onDraftChange: (text: string) => void;
  onUseSmartReply: (suggestion: string) => void;
  onSend: (opts?: SendOpts) => void;
  onEditMessage?: (messageId: string, text: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onLoadOlder: () => Promise<void>;
  onToggleTheme: () => void;
  onRefreshConversations: () => void;
  onStartCall?: (kind: 'audio' | 'video') => void;
  /** Focus Mode DM: hide inbox, keep thread chrome only. */
  embedded?: boolean;
  onEmbeddedBack?: () => void;
};

const STICKERS = [
  '😀', '😂', '😍', '🥰', '😎', '😭', '🔥', '👍', '👏', '🙏', '❤️', '💔', '🎉', '✨', '💯', '🤝',
  '😊', '🤔', '😴', '🤗', '🫡', '💪', '🌟', '🌈'
];
const MUTED_KEY = 'securechat.mutedChats';
const INBOX_BUCKET_KEY = 'securechat.inboxBuckets';
const INBOX_HIDDEN_KEY = 'securechat.inboxHidden';
const INBOX_PINNED_KEY = 'securechat.inboxPinned';
const INBOX_ARCHIVED_KEY = 'securechat.inboxArchived';
const INBOX_FORCED_UNREAD_KEY = 'securechat.inboxForcedUnread';
const INBOX_MARKED_READ_KEY = 'securechat.inboxMarkedRead';

type InboxTab = 'all' | 'primary' | 'general' | 'requests' | 'archived';
type InboxBucket = 'primary' | 'general' | 'requests';
type InboxFilter = 'none' | 'unread' | 'muted';

function scopedKey(base: string, userId: string) {
  return `${base}.${userId || 'anon'}`;
}

function loadIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistIdSet(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

function loadIdList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function persistIdList(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function loadMuted(userId: string): Set<string> {
  return loadIdSet(scopedKey(MUTED_KEY, userId));
}

function persistMuted(userId: string, ids: Set<string>) {
  persistIdSet(scopedKey(MUTED_KEY, userId), ids);
}

function loadInboxBuckets(userId: string): Record<string, InboxBucket> {
  try {
    const raw = localStorage.getItem(scopedKey(INBOX_BUCKET_KEY, userId));
    const obj = raw ? (JSON.parse(raw) as Record<string, InboxBucket>) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function persistInboxBuckets(userId: string, map: Record<string, InboxBucket>) {
  try {
    localStorage.setItem(scopedKey(INBOX_BUCKET_KEY, userId), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function loadInboxHidden(userId: string): Set<string> {
  return loadIdSet(scopedKey(INBOX_HIDDEN_KEY, userId));
}

function persistInboxHidden(userId: string, ids: Set<string>) {
  persistIdSet(scopedKey(INBOX_HIDDEN_KEY, userId), ids);
}

function formatInboxAgo(iso: string | undefined, locale: string): string {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diff) || diff < 0) return '';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return locale.startsWith('ar') ? 'الآن' : 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return new Date(iso).toLocaleDateString(locale.startsWith('ar') ? 'ar' : 'en', {
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return '';
  }
}

function classifyConversation(
  c: ConversationSummary,
  me: string,
  followingIds: Set<string>,
  buckets: Record<string, InboxBucket>
): InboxBucket {
  const override = buckets[c.peer.id];
  if (override) return override;
  if (followingIds.has(c.peer.id)) return 'primary';
  const last = c.lastMessage;
  if (!last) return 'requests';
  if (last.senderId !== me) return 'requests';
  return 'general';
}

function mediaMetaFromText(text: string): { mode: 'normal' | 'once' | 'timed'; ttl: number; body: string } {
  const once = text.match(/^\[img:once\]\s*(.*)$/s);
  if (once) return { mode: 'once', ttl: 0, body: once[1] || '' };
  const timed = text.match(/^\[img:ttl:(\d+)\]\s*(.*)$/s);
  if (timed) return { mode: 'timed', ttl: Math.min(60, Math.max(1, Number(timed[1]) || 1)), body: timed[2] || '' };
  const img = text.match(/^\[img\]\s*(.*)$/s);
  if (img) return { mode: 'normal', ttl: 0, body: img[1] || '' };
  return { mode: 'normal', ttl: 0, body: text };
}

function formatMsgTime(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

type GalleryItem = { id: string; file: File; url: string; selected: boolean; cropped?: boolean };

export default function ChatScreen(props: Props) {
  const { t, dir, locale } = useI18n();
  const { setSession } = useAuth();
  const uid = props.currentUserId;
  const messages = props.messagesByPeer[props.peerId] ?? [];
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [peopleQ, setPeopleQ] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [inboxTab, setInboxTab] = useState<InboxTab>('all');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('none');
  const [composeOpen, setComposeOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [addAccountStep, setAddAccountStep] = useState(false);
  const [vaultAccounts, setVaultAccounts] = useState<VaultAccount[]>(() => listVaultAccounts());
  const [inboxMoreOpen, setInboxMoreOpen] = useState(false);
  const [rowMenuPeer, setRowMenuPeer] = useState<string | null>(null);
  const [followingIds, setFollowingIds] = useState<Set<string>>(() => new Set());
  const [inboxBuckets, setInboxBuckets] = useState<Record<string, InboxBucket>>(() => loadInboxBuckets(uid));
  const [inboxHidden, setInboxHidden] = useState<Set<string>>(() => loadInboxHidden(uid));
  const [pinnedPeers, setPinnedPeers] = useState<string[]>(() => loadIdList(scopedKey(INBOX_PINNED_KEY, uid)));
  const [archivedPeers, setArchivedPeers] = useState<Set<string>>(() =>
    loadIdSet(scopedKey(INBOX_ARCHIVED_KEY, uid))
  );
  const [forcedUnread, setForcedUnread] = useState<Set<string>>(() =>
    loadIdSet(scopedKey(INBOX_FORCED_UNREAD_KEY, uid))
  );
  const [markedRead, setMarkedRead] = useState<Set<string>>(() =>
    loadIdSet(scopedKey(INBOX_MARKED_READ_KEY, uid))
  );
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [sendMode, setSendMode] = useState<'normal' | 'once' | 'timed'>('normal');
  const [ttlSecs, setTtlSecs] = useState(10);
  const [croppingId, setCroppingId] = useState<string | null>(null);
  const [pendingAudio, setPendingAudio] = useState<{ blob: Blob; url: string; secs: number } | null>(null);
  const [waveBars, setWaveBars] = useState<number[]>(() => Array.from({ length: 24 }, () => 0.12));
  const [peerMenuOpen, setPeerMenuOpen] = useState(false);
  const [msgMenuId, setMsgMenuId] = useState<string | null>(null);
  const [timeShownId, setTimeShownId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<PrivateMessage | null>(null);
  const [editing, setEditing] = useState<PrivateMessage | null>(null);
  const [shareFor, setShareFor] = useState<PrivateMessage | null>(null);
  const [shareQ, setShareQ] = useState('');
  const [shareTab, setShareTab] = useState<'users' | 'groups' | 'channels'>('users');
  const [sharePeople, setSharePeople] = useState<any[]>([]);
  const [shareGroups, setShareGroups] = useState<any[]>([]);
  const [shareChannels, setShareChannels] = useState<any[]>([]);
  const [sharePending, setSharePending] = useState<{
    kind: 'user' | 'group' | 'channel';
    id: string;
    title: string;
  } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareFeedback, setShareFeedback] = useState('');
  const [mutedChats, setMutedChats] = useState<Set<string>>(() => loadMuted(uid));
  const [peerProfile, setPeerProfile] = useState<any | null>(null);
  const [peerFollowBusy, setPeerFollowBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraShot, setCameraShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewer, setViewer] = useState<{
    items: { mediaId: string; url: string }[];
    index: number;
    mode: 'once' | 'timed' | 'normal';
    ttl: number;
    messageId: string;
  } | null>(null);
  const [viewerLeft, setViewerLeft] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordSecsRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveRafRef = useRef<number | null>(null);
  const autoSendVoiceRef = useRef(false);
  const discardVoiceRef = useRef(false);
  const stickAtBottom = useRef(true);
  const prevScrollHeight = useRef(0);
  const consumedOnce = useRef<Set<string>>(new Set());

  function isUnreadVisual(peerId: string, unreadCount: number) {
    if (forcedUnread.has(peerId)) return true;
    if (markedRead.has(peerId)) return false;
    return unreadCount > 0;
  }

  const allConversations = useMemo(() => {
    const fromApi = props.conversations;
    const fallbackIds = Object.keys(props.messagesByPeer).filter(
      (id) => !fromApi.some((c) => c.peer.id === id)
    );
    const merged: ConversationSummary[] = [
      ...fromApi,
      ...fallbackIds.map((id) => ({
        peer: {
          id,
          username: props.peerMeta[id]?.username || id.slice(0, 8),
          displayName: props.peerMeta[id]?.displayName ?? null,
          avatarUrl: props.peerMeta[id]?.avatarUrl ?? null
        },
        lastMessage: (props.messagesByPeer[id] ?? []).at(-1) as PrivateMessage,
        unreadCount: 0
      }))
    ].filter((c) => c.lastMessage && !inboxHidden.has(c.peer.id));
    return merged;
  }, [props.conversations, props.messagesByPeer, props.peerMeta, inboxHidden]);

  const tabCounts = useMemo(() => {
    const counts = { all: 0, primary: 0, general: 0, requests: 0, archived: 0 };
    for (const c of allConversations) {
      if (archivedPeers.has(c.peer.id)) {
        counts.archived += 1;
        continue;
      }
      const bucket = classifyConversation(c, props.currentUserId, followingIds, inboxBuckets);
      counts.all += 1;
      counts[bucket] += 1;
    }
    return counts;
  }, [allConversations, props.currentUserId, followingIds, inboxBuckets, archivedPeers]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allConversations.filter((c) => {
      const archived = archivedPeers.has(c.peer.id);
      if (inboxTab === 'archived') {
        if (!archived) return false;
      } else {
        if (archived) return false;
        const bucket = classifyConversation(c, props.currentUserId, followingIds, inboxBuckets);
        if (inboxTab !== 'all' && bucket !== inboxTab) return false;
      }
      if (inboxFilter === 'unread' && !isUnreadVisual(c.peer.id, c.unreadCount)) return false;
      if (inboxFilter === 'muted' && !mutedChats.has(c.peer.id)) return false;
      if (!q) return true;
      const name = `${c.peer.displayName || ''} ${c.peer.username}`.toLowerCase();
      const preview = (c.lastMessage?.encryptedContent || '').toLowerCase();
      return name.includes(q) || preview.includes(q);
    });
    const pinRank = new Map(pinnedPeers.map((id, i) => [id, i]));
    return filtered.sort((a, b) => {
      const ap = pinRank.has(a.peer.id);
      const bp = pinRank.has(b.peer.id);
      if (ap && bp) return (pinRank.get(a.peer.id) ?? 0) - (pinRank.get(b.peer.id) ?? 0);
      if (ap) return -1;
      if (bp) return 1;
      const at = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
      const bt = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
      return bt - at;
    });
  }, [
    allConversations,
    query,
    inboxTab,
    inboxFilter,
    mutedChats,
    props.currentUserId,
    followingIds,
    inboxBuckets,
    archivedPeers,
    pinnedPeers,
    forcedUnread,
    markedRead
  ]);

  useEffect(() => {
    setInboxBuckets(loadInboxBuckets(uid));
    setInboxHidden(loadInboxHidden(uid));
    setPinnedPeers(loadIdList(scopedKey(INBOX_PINNED_KEY, uid)));
    setArchivedPeers(loadIdSet(scopedKey(INBOX_ARCHIVED_KEY, uid)));
    setForcedUnread(loadIdSet(scopedKey(INBOX_FORCED_UNREAD_KEY, uid)));
    setMarkedRead(loadIdSet(scopedKey(INBOX_MARKED_READ_KEY, uid)));
    setMutedChats(loadMuted(uid));
    setVaultAccounts(listVaultAccounts());
  }, [uid]);

  useEffect(() => {
    if (!props.peerId) return;
    // Opening a chat clears unread glow / "new messages"
    setForcedUnread((prev) => {
      if (!prev.has(props.peerId)) return prev;
      const next = new Set(prev);
      next.delete(props.peerId);
      persistIdSet(scopedKey(INBOX_FORCED_UNREAD_KEY, uid), next);
      return next;
    });
    setMarkedRead((prev) => {
      if (prev.has(props.peerId)) return prev;
      const next = new Set(prev);
      next.add(props.peerId);
      persistIdSet(scopedKey(INBOX_MARKED_READ_KEY, uid), next);
      return next;
    });
  }, [props.peerId, uid]);

  useEffect(() => {
    let cancelled = false;
    void fetchFollowing(props.username)
      .then((rows) => {
        if (cancelled) return;
        const ids = new Set<string>();
        for (const u of rows || []) {
          if (u?.id) ids.add(String(u.id));
        }
        setFollowingIds(ids);
      })
      .catch(() => {
        if (!cancelled) setFollowingIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [props.username]);

  useEffect(() => {
    if (!composeOpen && !filterOpen && !accountMenuOpen && !inboxMoreOpen && !rowMenuPeer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setComposeOpen(false);
        setFilterOpen(false);
        setAccountMenuOpen(false);
        setInboxMoreOpen(false);
        setRowMenuPeer(null);
      }
    };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.ig-inbox-menu') && !t?.closest('.ig-inbox-more-btn') && !t?.closest('.ig-inbox-user-btn')) {
        setAccountMenuOpen(false);
        setInboxMoreOpen(false);
      }
      if (!t?.closest('.ig-inbox-row-menu') && !t?.closest('.ig-inbox-row-more')) {
        setRowMenuPeer(null);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [composeOpen, filterOpen, accountMenuOpen, inboxMoreOpen, rowMenuPeer]);

  function setPeerBucket(peerId: string, bucket: InboxBucket) {
    setInboxBuckets((prev) => {
      const next = { ...prev, [peerId]: bucket };
      persistInboxBuckets(uid, next);
      return next;
    });
    setRowMenuPeer(null);
  }

  function hideConversation(peerId: string) {
    setInboxHidden((prev) => {
      const next = new Set(prev);
      next.add(peerId);
      persistInboxHidden(uid, next);
      return next;
    });
    setRowMenuPeer(null);
    if (props.peerId === peerId) props.onPeerChange('');
  }

  function acceptRequest(peerId: string) {
    setPeerBucket(peerId, followingIds.has(peerId) ? 'primary' : 'general');
    setInboxTab('all');
    void props.onOpenChat(peerId);
  }

  function toggleReadState(peerId: string, unreadCount: number) {
    const unread = isUnreadVisual(peerId, unreadCount);
    if (unread) {
      setForcedUnread((prev) => {
        const next = new Set(prev);
        next.delete(peerId);
        persistIdSet(scopedKey(INBOX_FORCED_UNREAD_KEY, uid), next);
        return next;
      });
      setMarkedRead((prev) => {
        const next = new Set(prev);
        next.add(peerId);
        persistIdSet(scopedKey(INBOX_MARKED_READ_KEY, uid), next);
        return next;
      });
    } else {
      setMarkedRead((prev) => {
        const next = new Set(prev);
        next.delete(peerId);
        persistIdSet(scopedKey(INBOX_MARKED_READ_KEY, uid), next);
        return next;
      });
      setForcedUnread((prev) => {
        const next = new Set(prev);
        next.add(peerId);
        persistIdSet(scopedKey(INBOX_FORCED_UNREAD_KEY, uid), next);
        return next;
      });
    }
    setRowMenuPeer(null);
  }

  function togglePin(peerId: string) {
    setPinnedPeers((prev) => {
      const next = prev.includes(peerId) ? prev.filter((id) => id !== peerId) : [peerId, ...prev.filter((id) => id !== peerId)];
      persistIdList(scopedKey(INBOX_PINNED_KEY, uid), next);
      return next;
    });
    setRowMenuPeer(null);
  }

  function toggleArchive(peerId: string) {
    setArchivedPeers((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) next.delete(peerId);
      else next.add(peerId);
      persistIdSet(scopedKey(INBOX_ARCHIVED_KEY, uid), next);
      return next;
    });
    setRowMenuPeer(null);
    if (props.peerId === peerId) props.onPeerChange('');
  }

  async function blockAndHide(peerId: string) {
    try {
      await blockUser(peerId);
      hideConversation(peerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
      setRowMenuPeer(null);
    }
  }

  function switchToAccount(account: VaultAccount) {
    const current = getSessionSnapshot();
    if (current) upsertVaultAccount(current);
    if (account.userId === current?.user.id) {
      setAccountMenuOpen(false);
      setAddAccountStep(false);
      return;
    }
    setSession(vaultToSession(account));
    setVaultAccounts(listVaultAccounts());
    setAccountMenuOpen(false);
    setAddAccountStep(false);
    props.onPeerChange('');
  }

  function startAddAccount(mode: 'login' | 'register') {
    const current = getSessionSnapshot();
    if (current) upsertVaultAccount(current);
    setAccountMenuOpen(false);
    setAddAccountStep(false);
    window.dispatchEvent(new CustomEvent('securechat:auth-intent', { detail: { mode } }));
  }

  function promotePeerOnReply(peerId: string) {
    if (!peerId) return;
    setInboxBuckets((prev) => {
      const cur = prev[peerId];
      if (cur === 'primary' || cur === 'general') return prev;
      const nextBucket: InboxBucket = followingIds.has(peerId) ? 'primary' : 'general';
      const next = { ...prev, [peerId]: nextBucket };
      persistInboxBuckets(uid, next);
      return next;
    });
  }

  function conversationPreview(c: ConversationSummary): string {
    if (c.peer.id === props.peerId && props.typingHint) return t('typingNow');
    const raw = c.lastMessage?.encryptedContent || '';
    const metaPreview = mediaMetaFromText(raw);
    const sharePrev = parseShareContent(raw);
    const hasMedia = Boolean(c.lastMessage?.mediaAttachments?.length);
    const ago = formatInboxAgo(c.lastMessage?.timestamp, locale);
    if (c.lastMessage?.isDeleted) return t('messageDeleted');
    if (
      c.lastMessage &&
      c.lastMessage.senderId === props.currentUserId &&
      c.lastMessage.status === 'read'
    ) {
      return `${t('seenAgo')} ${ago}`.trim();
    }
    let body = '';
    if (sharePrev) {
      body = sharePrev.targetType === 'reel' ? t('sharedReel') : t('sharedPost');
    } else if (raw.startsWith('[voice')) {
      body = t('recordVoice');
    } else if (raw.startsWith('[sticker]')) {
      body = raw.replace('[sticker]', '').trim() || t('stickers');
    } else if (raw.startsWith('[img')) {
      body = metaPreview.body || (hasMedia ? '📷' : '📷');
    } else {
      body = metaPreview.body || raw;
    }
    return ago ? `${body} · ${ago}` : body;
  }

  const activePeer =
    props.conversations.find((c) => c.peer.id === props.peerId)?.peer ||
    (props.peerId
      ? {
          id: props.peerId,
          username:
            peerProfile?.username ||
            props.peerMeta[props.peerId]?.username ||
            props.peerId.slice(0, 8),
          displayName:
            peerProfile?.displayName ?? props.peerMeta[props.peerId]?.displayName ?? null,
          avatarUrl: peerProfile?.avatarUrl ?? props.peerMeta[props.peerId]?.avatarUrl ?? null
        }
      : null);

  const byId = useMemo(() => {
    const m = new Map<string, PrivateMessage>();
    for (const msg of messages) m.set(msg.id, msg);
    return m;
  }, [messages]);

  const selectedGallery = galleryItems.filter((g) => g.selected);
  const canSendText = Boolean(props.draft.trim() || editing || selectedGallery.length);

  useEffect(() => {
    const q = peopleQ.trim();
    if (q.length < 1) {
      setPeople([]);
      return;
    }
    const ctrl = new AbortController();
    setPeopleLoading(true);
    const timer = window.setTimeout(() => {
      void searchAll(q, ctrl.signal)
        .then((res) => {
          setPeople((res.users || []).filter((u: any) => u.id !== props.currentUserId));
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return;
          setError(err instanceof Error ? err.message : t('errorGeneric'));
        })
        .finally(() => setPeopleLoading(false));
    }, 280);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [peopleQ, props.currentUserId, t]);

  useEffect(() => {
    if (!shareFor) {
      setSharePeople([]);
      setShareGroups([]);
      setShareChannels([]);
      setSharePending(null);
      setShareFeedback('');
      setShareBusy(false);
      setShareTab('users');
      setShareQ('');
      return;
    }
    void fetchMyGroups()
      .then((items) => setShareGroups(Array.isArray(items) ? items : []))
      .catch(() => setShareGroups([]));
    void fetchMyChannels()
      .then((items) => setShareChannels(Array.isArray(items) ? items : []))
      .catch(() => setShareChannels([]));
    const fromConvos = props.conversations
      .map((c) => c.peer)
      .filter((p) => p?.id && p.id !== props.currentUserId)
      .slice(0, 24);
    setSharePeople(fromConvos);
  }, [shareFor, props.conversations, props.currentUserId]);

  useEffect(() => {
    if (!shareFor || shareTab !== 'users') return;
    const q = shareQ.trim();
    if (q.length < 1) {
      const fromConvos = props.conversations
        .map((c) => c.peer)
        .filter((p) => p?.id && p.id !== props.currentUserId)
        .slice(0, 24);
      setSharePeople(fromConvos);
      return;
    }
    const tmr = window.setTimeout(() => {
      void searchAll(q)
        .then((res) =>
          setSharePeople((res.users || []).filter((u: any) => u.id !== props.currentUserId).slice(0, 16))
        )
        .catch(() => setSharePeople([]));
    }, 260);
    return () => window.clearTimeout(tmr);
  }, [shareFor, shareQ, shareTab, props.currentUserId, props.conversations]);

  useEffect(() => {
    if (!props.peerId) {
      setPeerProfile(null);
      return;
    }
    let cancelled = false;
    void fetchUserProfile(props.peerId)
      .then((p) => {
        if (!cancelled) {
          setPeerProfile(p);
          // Enrich sidebar meta when opening from profile Message
          if (p?.id) {
            /* peerMeta is owned by App — local display uses peerProfile */
          }
        }
      })
      .catch(() => {
        if (!cancelled) setPeerProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [props.peerId]);

  useEffect(() => {
    const el = cameraVideoRef.current;
    if (!cameraOpen || !cameraStream || !el || cameraShot) return;
    el.srcObject = cameraStream;
    void el.play().catch(() => undefined);
  }, [cameraOpen, cameraStream, cameraShot]);

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((t) => t.stop());
      if (cameraShot) URL.revokeObjectURL(cameraShot.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openCamera() {
    setError('');
    setStickersOpen(false);
    setGalleryOpen(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      setCameraStream(stream);
      setCameraShot(null);
      setCameraOpen(true);
    } catch {
      setError(t('errorGeneric'));
    }
  }

  function closeCamera() {
    cameraStream?.getTracks().forEach((t) => t.stop());
    setCameraStream(null);
    if (cameraShot) URL.revokeObjectURL(cameraShot.url);
    setCameraShot(null);
    setCameraOpen(false);
  }

  function captureCameraPhoto() {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (cameraShot) URL.revokeObjectURL(cameraShot.url);
        setCameraShot({ blob, url: URL.createObjectURL(blob) });
        cameraStream?.getTracks().forEach((t) => t.stop());
        setCameraStream(null);
      },
      'image/jpeg',
      0.92
    );
  }

  function retakeCameraPhoto() {
    if (cameraShot) URL.revokeObjectURL(cameraShot.url);
    setCameraShot(null);
    void openCamera();
  }

  async function sendCameraPhoto() {
    if (!cameraShot || !props.peerId) return;
    setCameraBusy(true);
    setError('');
    try {
      const file = new File([cameraShot.blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const mediaId = await uploadMediaFile(file, 'chat');
      props.onSend({
        mediaIds: [mediaId],
        text: '[img]',
        ...(replyTo?.id ? { replyToMessageId: replyTo.id } : {})
      });
      promotePeerOnReply(props.peerId);
      setReplyTo(null);
      closeCamera();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setCameraBusy(false);
    }
  }

  async function followPeerFromChat() {
    if (!peerProfile?.id || peerFollowBusy) return;
    setPeerFollowBusy(true);
    try {
      const res = (await followUser(peerProfile.id)) as { status?: string };
      const next = res.status || 'accepted';
      setPeerProfile((p: any) =>
        p
          ? {
              ...p,
              followStatus: next,
              viewerFollowStatus: next,
              _count: {
                ...p._count,
                followers:
                  next === 'accepted' ? (p._count?.followers ?? 0) + 1 : p._count?.followers ?? 0
              }
            }
          : p
      );
      if (next === 'accepted') {
        setFollowingIds((prev) => {
          const ids = new Set(prev);
          ids.add(peerProfile.id);
          return ids;
        });
        setPeerBucket(peerProfile.id, 'primary');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setPeerFollowBusy(false);
    }
  }

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickAtBottom.current) {
      messageEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    } else if (prevScrollHeight.current) {
      el.scrollTop = el.scrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = 0;
    }
  }, [messages.length, props.peerId]);

  useEffect(() => {
    if (!viewer || viewer.mode !== 'timed') return;
    setViewerLeft(viewer.ttl);
    const tick = window.setInterval(() => {
      setViewerLeft((s) => {
        if (s <= 1) {
          window.clearInterval(tick);
          closeViewer(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer?.messageId, viewer?.mode]);

  function onMessagesScroll() {
    const el = listRef.current;
    if (!el) return;
    stickAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }

  async function loadOlderPreservingScroll() {
    const el = listRef.current;
    if (el) prevScrollHeight.current = el.scrollHeight - el.scrollTop;
    stickAtBottom.current = false;
    await props.onLoadOlder();
  }

  function focusComposer() {
    window.setTimeout(() => draftInputRef.current?.focus(), 30);
  }

  function stopWaveform() {
    if (waveRafRef.current != null) {
      window.cancelAnimationFrame(waveRafRef.current);
      waveRafRef.current = null;
    }
    try {
      void audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    setWaveBars(Array.from({ length: 24 }, () => 0.12));
  }

  function startWaveform(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        const a = analyserRef.current;
        if (!a) return;
        a.getByteFrequencyData(data);
        const bars: number[] = [];
        const step = Math.max(1, Math.floor(data.length / 24));
        for (let i = 0; i < 24; i++) {
          const v = data[i * step] ?? 0;
          bars.push(0.12 + (v / 255) * 0.88);
        }
        setWaveBars(bars);
        waveRafRef.current = window.requestAnimationFrame(tick);
      };
      waveRafRef.current = window.requestAnimationFrame(tick);
    } catch {
      /* waveform optional */
    }
  }

  async function startRecording() {
    setError('');
    autoSendVoiceRef.current = false;
    discardVoiceRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        stopWaveform();
        const secs = recordSecsRef.current;
        if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
        setRecording(false);
        if (discardVoiceRef.current) {
          discardVoiceRef.current = false;
          return;
        }
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (autoSendVoiceRef.current) {
          void sendVoiceBlob(blob, secs);
          return;
        }
        setPendingAudio({ blob, url: URL.createObjectURL(blob), secs });
      };
      mediaRecorderRef.current = rec;
      rec.start();
      startWaveform(stream);
      setRecording(true);
      recordSecsRef.current = 0;
      setRecordSecs(0);
      recordTimerRef.current = window.setInterval(() => {
        recordSecsRef.current += 1;
        setRecordSecs(recordSecsRef.current);
      }, 1000);
    } catch {
      setError(t('micPermissionDenied'));
    }
  }

  function stopRecording(autoSend = true) {
    autoSendVoiceRef.current = autoSend;
    mediaRecorderRef.current?.stop();
  }

  function cancelRecording() {
    autoSendVoiceRef.current = false;
    discardVoiceRef.current = true;
    if (recording) mediaRecorderRef.current?.stop();
    stopWaveform();
    if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    setPendingAudio(null);
    setRecording(false);
  }

  async function sendVoiceBlob(blob: Blob, secs: number) {
    const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
    try {
      const mediaId = await uploadMediaFile(file, 'voice');
      props.onSend({
        mediaIds: [mediaId],
        text: `[voice ${secs}s]`,
        ...(replyTo?.id ? { replyToMessageId: replyTo.id } : {})
      });
      promotePeerOnReply(props.peerId);
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function sendPendingAudio() {
    if (!pendingAudio) return;
    const { blob, url, secs } = pendingAudio;
    URL.revokeObjectURL(url);
    setPendingAudio(null);
    await sendVoiceBlob(blob, secs);
  }

  function onPickGallery(files: FileList | null) {
    if (!files?.length) return;
    const next: GalleryItem[] = [...galleryItems];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        url: URL.createObjectURL(file),
        selected: true
      });
    }
    setGalleryItems(next);
    setGalleryOpen(true);
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  }

  function toggleGallerySelect(id: string) {
    setGalleryItems((prev) => prev.map((g) => (g.id === id ? { ...g, selected: !g.selected } : g)));
  }

  function applyGalleryCrop(itemId: string, blob: Blob) {
    setGalleryItems((prev) =>
      prev.map((g) => {
        if (g.id !== itemId) return g;
        URL.revokeObjectURL(g.url);
        const file = new File([blob], g.file.name.replace(/\.\w+$/, '') + '-crop.jpg', {
          type: 'image/jpeg'
        });
        return { ...g, file, url: URL.createObjectURL(file), cropped: true, selected: true };
      })
    );
    setCroppingId(null);
  }

  async function sendGallery() {
    const selected = galleryItems.filter((g) => g.selected);
    if (!selected.length) return;
    try {
      const mediaIds: string[] = [];
      for (const item of selected.slice(0, 30)) {
        mediaIds.push(await uploadMediaFile(item.file, 'chat'));
      }
      const caption = props.draft.trim();
      const prefix =
        sendMode === 'once'
          ? '[img:once]'
          : sendMode === 'timed'
            ? `[img:ttl:${Math.min(60, Math.max(1, ttlSecs))}]`
            : '[img]';
      const text = caption ? `${prefix} ${caption}` : prefix;
      props.onSend({
        mediaIds,
        text,
        ...(replyTo?.id ? { replyToMessageId: replyTo.id } : {})
      });
      promotePeerOnReply(props.peerId);
      props.onDraftChange('');
      galleryItems.forEach((g) => URL.revokeObjectURL(g.url));
      setGalleryItems([]);
      setGalleryOpen(false);
      setCroppingId(null);
      setSendMode('normal');
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  function submitComposer(e?: FormEvent) {
    e?.preventDefault();
    if (!props.peerId) return;
    const selected = galleryItems.filter((g) => g.selected);
    if (selected.length && !editing) {
      void sendGallery();
      return;
    }
    const text = props.draft.trim();
    if (!text) return;
    if (editing) {
      props.onEditMessage?.(editing.id, text);
      setEditing(null);
      props.onDraftChange('');
      return;
    }
    props.onSend({ text, ...(replyTo?.id ? { replyToMessageId: replyTo.id } : {}) });
    promotePeerOnReply(props.peerId);
    props.onDraftChange('');
    setReplyTo(null);
    setStickersOpen(false);
  }

  function insertSticker(emoji: string) {
    if (!props.peerId) return;
    props.onSend({
      text: `[sticker] ${emoji}`,
      ...(replyTo?.id ? { replyToMessageId: replyTo.id } : {})
    });
    promotePeerOnReply(props.peerId);
    props.onDraftChange('');
    setReplyTo(null);
    setStickersOpen(false);
  }

  function isVoiceMessage(msg: PrivateMessage) {
    const text = msg.encryptedContent || '';
    if (text.startsWith('[voice')) return true;
    return (msg.mediaAttachments || []).some(
      (a) => a.mediaType === 'audio' || a.mimeType.startsWith('audio/') || a.purpose === 'voice'
    );
  }

  async function downloadUrl(url: string, filename: string) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(href);
    } catch {
      window.open(url, '_blank');
    }
  }

  function mediaExt(att: { mimeType?: string; mediaType?: string }) {
    const mime = (att.mimeType || '').toLowerCase();
    const kind = (att.mediaType || '').toLowerCase();
    if (mime.includes('video') || kind === 'video') return 'mp4';
    if (mime.includes('audio') || kind === 'audio') return 'webm';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return 'jpg';
  }

  async function downloadMessageMedia(msg: PrivateMessage) {
    const atts = msg.mediaAttachments || [];
    for (const att of atts) {
      try {
        const r = await fetchMediaUrl(att.mediaId);
        const u = resolveMediaUrl(r.secureUrl);
        if (!u) continue;
        await downloadUrl(u, `chat-${att.mediaId}.${mediaExt(att)}`);
      } catch {
        /* skip */
      }
    }
  }

  async function buildShareText(msg: PrivateMessage) {
    const meta = mediaMetaFromText(msg.encryptedContent || '');
    const raw = (meta.body || msg.encryptedContent || '').trim();
    const skipBody =
      !raw ||
      raw.startsWith('[img') ||
      raw.startsWith('[voice') ||
      raw.startsWith('[sticker]') ||
      Boolean(parseShareContent(raw));
    const urls: string[] = [];
    for (const att of msg.mediaAttachments || []) {
      try {
        const r = await fetchMediaUrl(att.mediaId);
        const u = resolveMediaUrl(r.secureUrl);
        if (u) urls.push(u);
      } catch {
        /* skip */
      }
    }
    const parts = [...(skipBody ? [] : [raw]), ...urls];
    return parts.join('\n').trim() || '[forward]';
  }

  async function confirmShareSend() {
    if (!shareFor || !sharePending || shareBusy) return;
    setShareBusy(true);
    setShareFeedback('');
    try {
      const body =
        mediaMetaFromText(shareFor.encryptedContent || '').body ||
        shareFor.encryptedContent ||
        '';
      if (sharePending.kind === 'user') {
        props.onSend({
          text: body || '[forward]',
          forwardFromMessageId: shareFor.id,
          toUserId: sharePending.id
        });
      } else {
        const text = await buildShareText(shareFor);
        if (sharePending.kind === 'group') {
          await sendGroupMessage(sharePending.id, text);
        } else {
          await sendChannelMessage(sharePending.id, text);
        }
      }
      setShareFeedback(`${t('shareSentOk')}: ${sharePending.title}`);
      setSharePending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
      setSharePending(null);
    } finally {
      setShareBusy(false);
    }
  }

  function toggleMuteChat() {
    if (!props.peerId) return;
    setMutedChats((prev) => {
      const next = new Set(prev);
      if (next.has(props.peerId)) next.delete(props.peerId);
      else next.add(props.peerId);
      persistMuted(uid, next);
      return next;
    });
    setPeerMenuOpen(false);
  }

  async function onBlockPeer() {
    if (!props.peerId) return;
    try {
      await blockUser(props.peerId);
      setPeerMenuOpen(false);
      props.onPeerChange('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function openViewer(msg: PrivateMessage, mediaId: string, url: string) {
    const meta = mediaMetaFromText(msg.encryptedContent || '');
    if (meta.mode === 'once' && consumedOnce.current.has(msg.id)) return;
    const imageAtts = (msg.mediaAttachments || []).filter(
      (a) => a.mediaType === 'image' || a.mimeType.startsWith('image/')
    );
    const items: { mediaId: string; url: string }[] = [];
    if (imageAtts.length > 1) {
      for (const att of imageAtts) {
        if (att.mediaId === mediaId) {
          items.push({ mediaId, url });
          continue;
        }
        try {
          const r = await fetchMediaUrl(att.mediaId);
          const u = resolveMediaUrl(r.secureUrl);
          if (u) items.push({ mediaId: att.mediaId, url: u });
        } catch {
          /* skip failed */
        }
      }
    } else {
      items.push({ mediaId, url });
    }
    const index = Math.max(0, items.findIndex((i) => i.mediaId === mediaId));
    setViewer({
      items,
      index: index < 0 ? 0 : index,
      mode: meta.mode === 'normal' ? 'normal' : meta.mode,
      ttl: meta.ttl || 0,
      messageId: msg.id
    });
  }

  function closeViewer(forceDelete = false) {
    if (!viewer) return;
    const { mode, messageId } = viewer;
    setViewer(null);
    if (mode === 'once' || forceDelete) {
      consumedOnce.current.add(messageId);
      props.onDeleteMessage?.(messageId);
    }
  }

  function isEphemeralLocked(msg: PrivateMessage) {
    const meta = mediaMetaFromText(msg.encryptedContent || '');
    if (meta.mode === 'normal') return false;
    if (msg.senderId === props.currentUserId) return false;
    return !consumedOnce.current.has(msg.id);
  }

  return (
    <main
      className={`app-shell messages-shell wa-messages ${props.peerId ? 'chat-open' : ''}${
        props.embedded ? ' is-embedded-dm' : ''
      }`}
    >
      <aside
        className={`sidebar ig-inbox ${props.peerId ? 'sidebar-mobile-hidden' : ''}${
          props.embedded ? ' is-embedded-hidden' : ''
        }`}
      >
        <div className="ig-inbox-top">
          <div className="ig-inbox-header">
            <span className="ig-inbox-header-spacer" aria-hidden="true" />
            <div className="ig-inbox-user-wrap">
              <button
                type="button"
                className="ig-inbox-user-btn"
                aria-expanded={accountMenuOpen}
                onClick={() => {
                  setVaultAccounts(listVaultAccounts());
                  setAccountMenuOpen((v) => !v);
                  setAddAccountStep(false);
                  setInboxMoreOpen(false);
                }}
              >
                <span className="ig-inbox-username">{props.username}</span>
                <IconChevronDown size={16} />
              </button>
              {accountMenuOpen ? (
                <div className="ig-inbox-menu ig-inbox-account-menu" role="menu">
                  {!addAccountStep ? (
                    <>
                      {vaultAccounts.map((a) => (
                        <button
                          key={a.userId}
                          type="button"
                          className={`ig-inbox-menu-item ig-inbox-account-item${
                            a.userId === props.currentUserId ? ' is-current' : ''
                          }`}
                          role="menuitem"
                          onClick={() => switchToAccount(a)}
                        >
                          <UserAvatar
                            size="sm"
                            name={a.displayName || a.username}
                            username={a.username}
                            avatarUrl={a.avatarUrl}
                          />
                          <span className="ig-inbox-account-meta">
                            <strong>{a.displayName || a.username}</strong>
                            <span className="muted tiny">@{a.username}</span>
                            {a.userId === props.currentUserId ? (
                              <span className="muted tiny">{t('currentAccount')}</span>
                            ) : null}
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className="ig-inbox-menu-item"
                        role="menuitem"
                        onClick={() => setAddAccountStep(true)}
                      >
                        {t('addAccount')}
                      </button>
                      <Link
                        to={`/u/${props.username}`}
                        className="ig-inbox-menu-item"
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                      >
                        {t('viewProfile')}
                      </Link>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="ig-inbox-menu-item"
                        role="menuitem"
                        onClick={() => startAddAccount('login')}
                      >
                        {t('loginExistingAccount')}
                      </button>
                      <button
                        type="button"
                        className="ig-inbox-menu-item"
                        role="menuitem"
                        onClick={() => startAddAccount('register')}
                      >
                        {t('createNewAccount')}
                      </button>
                      <button
                        type="button"
                        className="ig-inbox-menu-item"
                        role="menuitem"
                        onClick={() => setAddAccountStep(false)}
                      >
                        {t('cancel')}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
            <div className="ig-inbox-header-actions">
              <div className="ig-inbox-more-wrap">
                <button
                  type="button"
                  className="icon-btn ig-inbox-more-btn"
                  aria-label={t('more')}
                  onClick={() => {
                    setInboxMoreOpen((v) => !v);
                    setAccountMenuOpen(false);
                  }}
                >
                  <IconMore size={22} />
                </button>
                {inboxMoreOpen ? (
                  <div className="ig-inbox-menu ig-inbox-menu-end" role="menu">
                    <button
                      type="button"
                      className="ig-inbox-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setInboxMoreOpen(false);
                        setFilterOpen(true);
                      }}
                    >
                      {t('inboxFilter')}
                    </button>
                    <button
                      type="button"
                      className="ig-inbox-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setInboxMoreOpen(false);
                        props.onToggleTheme();
                      }}
                    >
                      {props.theme === 'dark' ? t('lightMode') : t('darkMode')}
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label={t('newMessage')}
                onClick={() => {
                  setComposeOpen(true);
                  setPeopleQ('');
                  setPeople([]);
                }}
              >
                <IconCompose size={22} />
              </button>
            </div>
          </div>

          <div className="ig-inbox-search-row">
            <label className="ig-inbox-search">
              <IconSearch size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search')}
                dir="auto"
                autoComplete="off"
                enterKeyHint="search"
              />
            </label>
            <button
              type="button"
              className={`ig-inbox-filter-link${inboxFilter !== 'none' ? ' is-active' : ''}`}
              onClick={() => setFilterOpen(true)}
            >
              {t('inboxFilter')}
            </button>
          </div>

          <div className="ig-inbox-tabs" role="tablist" aria-label={t('messages')}>
            {(
              [
                ['all', t('inboxAll'), tabCounts.all],
                ['primary', t('inboxPrimary'), tabCounts.primary],
                ['general', t('inboxGeneral'), tabCounts.general],
                ['requests', t('inboxRequests'), tabCounts.requests],
                ['archived', t('inboxArchive'), tabCounts.archived]
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={inboxTab === id}
                className={`ig-inbox-tab${inboxTab === id ? ' is-active' : ''}`}
                onClick={() => setInboxTab(id)}
              >
                {label}
                {(id === 'requests' || id === 'archived') && count > 0 ? (
                  <span className="ig-inbox-tab-badge">{count}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {inboxTab === 'requests' ? (
          <p className="ig-inbox-hint muted tiny">{t('messageRequestsHint')}</p>
        ) : null}
        {props.reconnecting ? <p className="muted pad-inline tiny">{t('reconnecting')}</p> : null}
        {props.conversationsLoading ? <p className="muted pad-inline tiny">{t('loading')}</p> : null}
        {props.conversationsError ? <p className="auth-error pad-inline">{props.conversationsError}</p> : null}
        {error ? <p className="auth-error pad-inline">{error}</p> : null}

        <div className="ig-inbox-list chat-list">
          {list.length === 0 && !props.conversationsLoading ? (
            <p className="muted pad-inline">
              {inboxTab === 'all'
                ? t('emptyConversations')
                : inboxTab === 'archived'
                  ? t('emptyArchiveChats')
                  : t('emptyInboxTab')}
            </p>
          ) : null}
          {list.map((c) => {
            const preview = conversationPreview(c);
            const bucket = classifyConversation(c, props.currentUserId, followingIds, inboxBuckets);
            const isTyping = c.peer.id === props.peerId && Boolean(props.typingHint);
            const unread = isUnreadVisual(c.peer.id, c.unreadCount);
            const pinned = pinnedPeers.includes(c.peer.id);
            const archived = archivedPeers.has(c.peer.id);
            return (
              <div
                key={c.peer.id}
                className={`ig-inbox-row${props.peerId === c.peer.id ? ' is-active' : ''}${
                  unread ? ' is-unread is-unread-glow' : ''
                }`}
              >
                <button
                  type="button"
                  className="ig-inbox-row-main"
                  onClick={() => props.onSelectChat(c.peer.id)}
                >
                  <span className={`ig-inbox-avatar-wrap${unread ? ' is-glow' : ''}`}>
                    <UserAvatar
                      size="md"
                      name={c.peer.displayName}
                      username={c.peer.username}
                      avatarUrl={c.peer.avatarUrl}
                    />
                    {props.onlineByUser[c.peer.id] ? <span className="ig-inbox-online" /> : null}
                  </span>
                  <span className="ig-inbox-row-body">
                    <span className="ig-inbox-row-name-line">
                      <span className="ig-inbox-row-name">{c.peer.displayName || c.peer.username}</span>
                      {pinned ? (
                        <span className="ig-inbox-pin" title={t('pinChat')}>
                          <IconPin size={14} />
                        </span>
                      ) : null}
                    </span>
                    {unread ? (
                      <span className="ig-inbox-new-label">{t('newMessages')}</span>
                    ) : (
                      <span className={`ig-inbox-row-preview${isTyping ? ' is-typing' : ''}`}>{preview}</span>
                    )}
                  </span>
                  {unread ? <span className="ig-inbox-unread-dot" /> : null}
                </button>
                <button
                  type="button"
                  className="icon-btn ig-inbox-row-more"
                  aria-label={t('more')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRowMenuPeer((v) => (v === c.peer.id ? null : c.peer.id));
                  }}
                >
                  <IconMore size={18} />
                </button>
                {rowMenuPeer === c.peer.id ? (
                  <div className="ig-inbox-menu ig-inbox-row-menu" role="menu">
                    {bucket === 'requests' && !archived ? (
                      <>
                        <button
                          type="button"
                          className="ig-inbox-menu-item"
                          role="menuitem"
                          onClick={() => acceptRequest(c.peer.id)}
                        >
                          {t('acceptRequest')}
                        </button>
                        <button
                          type="button"
                          className="ig-inbox-menu-item danger"
                          role="menuitem"
                          onClick={() => hideConversation(c.peer.id)}
                        >
                          {t('deleteRequest')}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="ig-inbox-menu-item"
                      role="menuitem"
                      onClick={() => toggleReadState(c.peer.id, c.unreadCount)}
                    >
                      {unread ? t('markAsRead') : t('markAsUnread')}
                    </button>
                    <button
                      type="button"
                      className="ig-inbox-menu-item"
                      role="menuitem"
                      onClick={() => togglePin(c.peer.id)}
                    >
                      {pinned ? t('unpinChat') : t('pinChat')}
                    </button>
                    <button
                      type="button"
                      className="ig-inbox-menu-item"
                      role="menuitem"
                      onClick={() => toggleArchive(c.peer.id)}
                    >
                      {archived ? t('unarchiveChat') : t('archiveChat')}
                    </button>
                    {!archived ? (
                      <>
                        <button
                          type="button"
                          className="ig-inbox-menu-item"
                          role="menuitem"
                          onClick={() => setPeerBucket(c.peer.id, 'primary')}
                        >
                          {t('moveToPrimary')}
                        </button>
                        <button
                          type="button"
                          className="ig-inbox-menu-item"
                          role="menuitem"
                          onClick={() => setPeerBucket(c.peer.id, 'general')}
                        >
                          {t('moveToGeneral')}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="ig-inbox-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMutedChats((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.peer.id)) next.delete(c.peer.id);
                          else next.add(c.peer.id);
                          persistMuted(uid, next);
                          return next;
                        });
                        setRowMenuPeer(null);
                      }}
                    >
                      {mutedChats.has(c.peer.id) ? t('unmute') : t('mute')}
                    </button>
                    <button
                      type="button"
                      className="ig-inbox-menu-item danger"
                      role="menuitem"
                      onClick={() => void blockAndHide(c.peer.id)}
                    >
                      {t('block')}
                    </button>
                    <button
                      type="button"
                      className="ig-inbox-menu-item danger"
                      role="menuitem"
                      title={t('deleteChatHint')}
                      onClick={() => hideConversation(c.peer.id)}
                    >
                      {t('deleteChat')}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>

      {composeOpen ? (
        <div className="ig-sheet-backdrop" role="presentation" onClick={() => setComposeOpen(false)}>
          <div
            className="ig-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t('newMessage')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ig-sheet-head">
              <h2>{t('newMessage')}</h2>
              <button type="button" className="icon-btn" aria-label={t('close')} onClick={() => setComposeOpen(false)}>
                ✕
              </button>
            </div>
            <label className="ig-inbox-search ig-sheet-search">
              <IconSearch size={18} />
              <input
                value={peopleQ}
                onChange={(e) => setPeopleQ(e.target.value)}
                placeholder={t('searchPeopleHint')}
                dir="auto"
                autoFocus
                autoComplete="off"
              />
            </label>
            {peopleLoading ? <p className="muted tiny pad-inline">{t('loading')}</p> : null}
            <div className="ig-sheet-list">
              {people.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="ig-sheet-person"
                  onClick={() => {
                    setComposeOpen(false);
                    setPeopleQ('');
                    setPeople([]);
                    if (followingIds.has(u.id)) setPeerBucket(u.id, 'primary');
                    else setPeerBucket(u.id, 'general');
                    void props.onOpenChat(u.id);
                  }}
                >
                  <UserAvatar size="md" name={u.displayName} username={u.username} avatarUrl={u.avatarUrl} />
                  <span className="ig-sheet-person-text">
                    <strong>{u.displayName || u.username}</strong>
                    <span className="muted">@{u.username}</span>
                  </span>
                </button>
              ))}
              {!peopleLoading && peopleQ.trim() && people.length === 0 ? (
                <p className="muted pad-inline">{t('emptySearch')}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {filterOpen ? (
        <div className="ig-sheet-backdrop" role="presentation" onClick={() => setFilterOpen(false)}>
          <div
            className="ig-sheet ig-sheet-sm"
            role="dialog"
            aria-modal="true"
            aria-label={t('inboxFilter')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ig-sheet-head">
              <h2>{t('inboxFilter')}</h2>
              <button type="button" className="icon-btn" aria-label={t('close')} onClick={() => setFilterOpen(false)}>
                ✕
              </button>
            </div>
            <div className="ig-filter-options">
              {(
                [
                  ['none', t('inboxFilterClear')],
                  ['unread', t('inboxFilterUnread')],
                  ['muted', t('inboxFilterMuted')]
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`ig-filter-option${inboxFilter === id ? ' is-active' : ''}`}
                  onClick={() => {
                    setInboxFilter(id);
                    setFilterOpen(false);
                  }}
                >
                  {label}
                  {inboxFilter === id ? <IconCheck size={18} /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <section className={`chat-main ${!props.peerId ? 'chat-main-empty' : ''}`}>
        {!props.peerId ? (
          <div className="empty-state chat-empty">
            <h2>{t('selectConversation')}</h2>
            <p className="muted">{t('selectConversationHint')}</p>
            <button className="button button-compact" type="button" onClick={props.onRefreshConversations}>
              {t('retry')}
            </button>
          </div>
        ) : (
          <>
            <header className="chat-header wa-chat-header">
              <button
                className={`icon-btn mobile-back${props.embedded ? ' is-always-visible' : ''}`}
                type="button"
                aria-label={t('back')}
                onClick={() => {
                  if (props.embedded && props.onEmbeddedBack) props.onEmbeddedBack();
                  else props.onPeerChange('');
                }}
              >
                <IconBack size={22} />
              </button>
              {peerProfile?.browseProfileHidden ? (
                <div className="chat-peer-link">
                  <UserAvatar
                    size="sm"
                    name={activePeer?.displayName}
                    username={activePeer?.username}
                    avatarUrl={activePeer?.avatarUrl}
                  />
                  <div>
                    <strong>{activePeer?.displayName || activePeer?.username || t('messages')}</strong>
                    <p className="muted">
                      {props.onlineByUser[props.peerId] ? t('online') : ''}
                      {props.typingHint ? `${props.onlineByUser[props.peerId] ? ' · ' : ''}${props.typingHint}` : ''}
                    </p>
                  </div>
                </div>
              ) : (
                <Link to={`/u/${activePeer?.username || props.peerId}`} className="chat-peer-link">
                  <UserAvatar
                    size="sm"
                    name={activePeer?.displayName}
                    username={activePeer?.username}
                    avatarUrl={activePeer?.avatarUrl}
                  />
                  <div>
                    <strong>{activePeer?.displayName || activePeer?.username}</strong>
                    <p className="muted">
                      @{activePeer?.username}
                      {props.onlineByUser[props.peerId] ? ` · ${t('online')}` : ''}
                      {props.typingHint ? ` · ${props.typingHint}` : ''}
                    </p>
                  </div>
                </Link>
              )}
              <div className="chat-header-actions">
                {props.onStartCall ? (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('audioCall')}
                      onClick={() => props.onStartCall?.('audio')}
                    >
                      <IconPhone size={22} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('videoCall')}
                      onClick={() => props.onStartCall?.('video')}
                    >
                      <IconVideo size={22} />
                    </button>
                  </>
                ) : null}
                <div className="more-wrap">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('more')}
                    aria-expanded={peerMenuOpen}
                    onClick={() => setPeerMenuOpen((v) => !v)}
                  >
                    <IconMore size={20} />
                  </button>
                  {peerMenuOpen ? (
                    <div className="more-menu peer-chat-menu" role="menu">
                      <button type="button" className="more-menu-item" role="menuitem" onClick={toggleMuteChat}>
                        {mutedChats.has(props.peerId) ? t('unmute') : t('mute')}
                      </button>
                      <button type="button" className="more-menu-item danger" role="menuitem" onClick={() => void onBlockPeer()}>
                        {t('block')}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>

            <div className="messages wa-messages-list" ref={listRef} onScroll={onMessagesScroll}>
              {props.hasMoreByPeer[props.peerId] ? (
                <button
                  className="button button-ghost button-compact"
                  type="button"
                  onClick={() => void loadOlderPreservingScroll()}
                >
                  {t('loadMore')}
                </button>
              ) : null}
              {props.isOpeningChat ? <p className="muted">{t('loading')}</p> : null}

              {peerProfile && !props.isOpeningChat && !peerProfile.browseProfileHidden ? (
                <div className="chat-peer-intro">
                  <UserAvatar
                    size="lg"
                    name={peerProfile.displayName || peerProfile.username}
                    username={peerProfile.username}
                    avatarUrl={peerProfile.avatarUrl}
                  />
                  <strong className="chat-peer-intro-name">
                    {peerProfile.displayName || peerProfile.username}
                  </strong>
                  <span className="muted chat-peer-intro-user">@{peerProfile.username}</span>
                  <p className="chat-peer-intro-stats muted tiny">
                    {peerProfile._count?.followers ?? 0} {t('followers')} ·{' '}
                    {peerProfile._count?.posts ?? 0} {t('posts')}
                  </p>
                  {peerProfile.followStatus !== 'accepted' &&
                  peerProfile.followStatus !== 'pending' &&
                  !peerProfile.isSelf ? (
                    <div className="chat-peer-intro-follow">
                      <p className="muted tiny">{t('chatFollowPrompt')}</p>
                      <button
                        type="button"
                        className="button button-compact"
                        disabled={peerFollowBusy}
                        onClick={() => void followPeerFromChat()}
                      >
                        {t('follow')}
                      </button>
                    </div>
                  ) : null}
                  <Link
                    to={`/u/${peerProfile.username || peerProfile.id}`}
                    className="button button-ghost button-compact chat-peer-intro-profile"
                  >
                    {t('viewProfile')}
                  </Link>
                </div>
              ) : null}

              {messages.map((msg) => {
                const mine = msg.senderId === props.currentUserId;
                const meta = mediaMetaFromText(msg.encryptedContent || '');
                const sharePayload = parseShareContent(msg.encryptedContent || '');
                const replySrc = msg.replyToMessageId ? byId.get(msg.replyToMessageId) : null;
                const showTime = timeShownId === msg.id;
                const ticks =
                  mine && !msg.isDeleted ? (
                    <span className={`wa-ticks ${msg.status === 'read' ? 'is-read' : ''}`} aria-hidden>
                      <IconCheck size={14} double={msg.status === 'delivered' || msg.status === 'read'} />
                    </span>
                  ) : null;
                const voiceMsg = isVoiceMessage(msg);
                return (
                  <div
                    key={msg.id}
                    className={`bubble wa-bubble ${mine ? 'sent' : 'received'}${voiceMsg ? ' is-voice' : ''}${sharePayload ? ' is-share' : ''}`}
                    onClick={() => setTimeShownId((id) => (id === msg.id ? null : msg.id))}
                    onContextMenu={(e) => {
                      if (voiceMsg) return;
                      e.preventDefault();
                      setMsgMenuId(msg.id);
                    }}
                  >
                    {msg.isDeleted ? (
                      <div className="wa-deleted">{t('messageDeleted')}</div>
                    ) : (
                      <>
                        {replySrc ? (
                          <div className="wa-reply-quote">
                            <strong>
                              {replySrc.senderId === props.currentUserId
                                ? t('you')
                                : `@${activePeer?.username || ''}`}
                            </strong>
                            <span>
                              {sharePreviewLabel(
                                replySrc.encryptedContent || '',
                                parseShareContent(replySrc.encryptedContent || '')?.targetType === 'reel'
                                  ? t('sharedReel')
                                  : t('sharedPost')
                              ) ||
                                mediaMetaFromText(replySrc.encryptedContent || '').body ||
                                replySrc.encryptedContent}
                            </span>
                          </div>
                        ) : null}
                        {(msg.mediaAttachments || []).map((att) => (
                          <MessageAttachment
                            key={att.mediaId}
                            att={att}
                            blurred={isEphemeralLocked(msg) && (meta.mode === 'once' || meta.mode === 'timed')}
                            onOpen={(url) => void openViewer(msg, att.mediaId, url)}
                          />
                        ))}
                        {String(msg.encryptedContent || '').startsWith('[img') &&
                        !(msg.mediaAttachments || []).length ? (
                          <div className="wa-media-missing muted tiny">{t('mediaMissing')}</div>
                        ) : null}
                        {sharePayload ? (
                          <ShareContentBubble
                            payload={sharePayload}
                            mine={mine}
                            sentAt={msg.timestamp}
                            showDate={showTime}
                            onToggleDate={() =>
                              setTimeShownId((id) => (id === msg.id ? null : msg.id))
                            }
                            onReply={() => {
                              setReplyTo(msg);
                              focusComposer();
                            }}
                            {...(mine
                              ? {
                                  onDelete: () => {
                                    props.onDeleteMessage?.(msg.id);
                                  }
                                }
                              : {})}
                            onForward={() => setShareFor(msg)}
                          />
                        ) : meta.body &&
                          !meta.body.startsWith('[voice') &&
                          !msg.encryptedContent?.startsWith('[sticker]') ? (
                          <div className="wa-text" dir="auto">
                            {meta.body}
                          </div>
                        ) : null}
                        {msg.encryptedContent?.startsWith('[sticker]') && !(msg.mediaAttachments || []).length ? (
                          <div className="sticker-text">{msg.encryptedContent.replace('[sticker]', '').trim()}</div>
                        ) : null}
                        {msg.encryptedContent?.startsWith('[voice') && !(msg.mediaAttachments || []).length ? (
                          <div className="wa-media-missing muted tiny">{t('mediaMissing')}</div>
                        ) : null}
                      </>
                    )}
                    <div className="bubble-meta wa-meta">
                      {showTime ? <span>{formatMsgTime(msg.timestamp, locale)}</span> : null}
                      {msg.editedAt ? <span>{t('edited')}</span> : null}
                      {ticks}
                    </div>
                    {msgMenuId === msg.id && !msg.isDeleted && !voiceMsg ? (
                      <div className="wa-msg-menu" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => {
                            setReplyTo(msg);
                            setMsgMenuId(null);
                            focusComposer();
                          }}
                        >
                          {t('reply')}
                        </button>
                        {mine && meta.mode === 'normal' && !msg.mediaAttachments?.length ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(msg);
                              props.onDraftChange(meta.body || msg.encryptedContent);
                              setMsgMenuId(null);
                              focusComposer();
                            }}
                          >
                            {t('edit')}
                          </button>
                        ) : null}
                        {mine ? (
                          <button
                            type="button"
                            onClick={() => {
                              props.onDeleteMessage?.(msg.id);
                              setMsgMenuId(null);
                            }}
                          >
                            {(msg.mediaAttachments || []).length ? t('deleteMedia') : t('delete')}
                          </button>
                        ) : null}
                        {(msg.mediaAttachments || []).length ? (
                          <button
                            type="button"
                            onClick={() => {
                              setMsgMenuId(null);
                              void downloadMessageMedia(msg);
                            }}
                          >
                            {t('downloadMedia')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setShareFor(msg);
                            setMsgMenuId(null);
                          }}
                        >
                          {t('share')}
                        </button>
                        <button type="button" onClick={() => setMsgMenuId(null)}>
                          {t('close')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <div ref={messageEndRef} />
            </div>

            {props.smartReplies.length > 0 && !editing ? (
              <div className="smart-replies">
                {props.smartReplies.map((s) => (
                  <button key={s} type="button" className="smart-reply-chip" onClick={() => props.onUseSmartReply(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : null}

            {replyTo ? (
              <div className="wa-composer-banner">
                <div>
                  <strong>{t('reply')}</strong>
                  <span dir="auto">{mediaMetaFromText(replyTo.encryptedContent || '').body || replyTo.encryptedContent}</span>
                </div>
                <button type="button" className="icon-btn" onClick={() => setReplyTo(null)} aria-label={t('close')}>
                  ×
                </button>
              </div>
            ) : null}
            {editing ? (
              <div className="wa-composer-banner">
                <div>
                  <strong>{t('edit')}</strong>
                  <span>{t('typeMessage')}</span>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    setEditing(null);
                    props.onDraftChange('');
                  }}
                  aria-label={t('close')}
                >
                  ×
                </button>
              </div>
            ) : null}

            {stickersOpen ? (
              <div className="sticker-studio" role="listbox" aria-label={t('stickers')}>
                {STICKERS.map((s) => (
                  <button key={s} type="button" className="sticker-btn" onClick={() => insertSticker(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : null}

            {galleryOpen ? (
              <div className="gallery-sheet">
                <div className="gallery-sheet-head">
                  <strong>{t('chooseFromGallery')}</strong>
                  <button
                    type="button"
                    className="button button-ghost button-compact"
                    onClick={() => {
                      galleryItems.forEach((g) => URL.revokeObjectURL(g.url));
                      setGalleryItems([]);
                      setGalleryOpen(false);
                    }}
                  >
                    {t('close')}
                  </button>
                </div>
                <div className="gallery-modes">
                  <button
                    type="button"
                    className={`button button-compact ${sendMode === 'normal' ? '' : 'button-ghost'}`}
                    onClick={() => setSendMode('normal')}
                  >
                    {t('permanent')}
                  </button>
                  <button
                    type="button"
                    className={`button button-compact ${sendMode === 'once' ? '' : 'button-ghost'}`}
                    onClick={() => setSendMode('once')}
                  >
                    {t('viewOnce')}
                  </button>
                  <button
                    type="button"
                    className={`button button-compact ${sendMode === 'timed' ? '' : 'button-ghost'}`}
                    onClick={() => setSendMode('timed')}
                  >
                    {t('viewTimed')}
                  </button>
                  {sendMode === 'timed' ? (
                    <label className="ttl-field">
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={ttlSecs}
                        onChange={(e) => setTtlSecs(Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
                      />
                      <span>{t('seconds')}</span>
                    </label>
                  ) : null}
                </div>
                <div className="gallery-grid">
                  {galleryItems.map((g) => (
                    <div key={g.id} className={`gallery-tile-wrap ${g.selected ? 'is-selected' : ''}`}>
                      <button
                        type="button"
                        className={`gallery-tile ${g.selected ? 'is-selected' : ''}`}
                        onClick={() => toggleGallerySelect(g.id)}
                      >
                        <img src={g.url} alt="" />
                        {g.selected ? <span className="gallery-check">✓</span> : null}
                      </button>
                      {g.selected ? (
                        <button
                          type="button"
                          className="button button-ghost button-compact gallery-crop-btn"
                          onClick={() => setCroppingId(g.id)}
                        >
                          {g.cropped ? t('cropOn') : t('crop')}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <button type="button" className="gallery-tile gallery-add" onClick={() => galleryInputRef.current?.click()}>
                    +
                  </button>
                </div>
                {selectedGallery.length ? (
                  <p className="muted tiny gallery-send-hint">{t('sendWithComposerHint')}</p>
                ) : null}
              </div>
            ) : null}

            {croppingId ? (
              (() => {
                const item = galleryItems.find((g) => g.id === croppingId);
                if (!item) return null;
                return (
                  <AvatarCrop
                    variant="free"
                    file={item.file}
                    onCancel={() => setCroppingId(null)}
                    onConfirm={(blob) => applyGalleryCrop(item.id, blob)}
                  />
                );
              })()
            ) : null}

            {props.uploadProgress != null ? (
              <div className="upload-progress">
                <div style={{ width: `${props.uploadProgress}%` }} />
              </div>
            ) : null}

            {recording ? (
              <div className="voice-recording-bar" aria-live="polite">
                <div className="voice-waveform" aria-hidden>
                  {waveBars.map((h, i) => (
                    <span key={i} style={{ height: `${Math.round(h * 100)}%` }} />
                  ))}
                </div>
                <span className="voice-rec-secs">{recordSecs}s</span>
                <button type="button" className="button button-ghost button-compact" onClick={cancelRecording}>
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  className="composer-send-btn"
                  aria-label={t('send')}
                  onClick={() => stopRecording(true)}
                >
                  <IconSendArrow size={20} />
                </button>
              </div>
            ) : null}

            {pendingAudio ? (
              <div className="voice-preview">
                <audio src={pendingAudio.url} controls />
                <button type="button" className="icon-btn" aria-label={t('send')} onClick={() => void sendPendingAudio()}>
                  <IconSendArrow size={20} />
                </button>
                <button type="button" className="button button-ghost button-compact" onClick={cancelRecording}>
                  {t('cancel')}
                </button>
              </div>
            ) : null}

            <form className="composer tg-composer wa-composer" onSubmit={submitComposer}>
              <input
                ref={galleryInputRef}
                className="sr-only"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => onPickGallery(e.target.files)}
              />
              <div className="composer-row">
                {typeof document !== 'undefined' &&
                document.querySelector('.focus-shell')?.getAttribute('data-focus-stickers') === 'off' ? null : (
                  <button
                    type="button"
                    className="composer-icon-btn"
                    aria-label={t('stickers')}
                    onClick={() => {
                      setStickersOpen((v) => !v);
                      setGalleryOpen(false);
                    }}
                  >
                    <IconSticker size={22} />
                  </button>
                )}
                <button
                  type="button"
                  className="composer-icon-btn"
                  aria-label={t('chooseFromGallery')}
                  onClick={() => {
                    setGalleryOpen(true);
                    setStickersOpen(false);
                    galleryInputRef.current?.click();
                  }}
                >
                  <IconImage size={22} />
                </button>
                <button
                  type="button"
                  className="composer-icon-btn"
                  aria-label={t('takePhoto')}
                  disabled={!props.peerId}
                  onClick={() => void openCamera()}
                >
                  <IconCamera size={22} />
                </button>
                <textarea
                  ref={draftInputRef}
                  value={props.draft}
                  onChange={(e) => props.onDraftChange(e.target.value)}
                  placeholder={t('typeMessage')}
                  dir="auto"
                  lang="ar"
                  inputMode="text"
                  enterKeyHint="send"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  rows={1}
                  disabled={!props.peerId}
                  onFocus={() => {
                    setStickersOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitComposer();
                    }
                  }}
                />
                {canSendText ? (
                  <button
                    className="composer-send-btn"
                    type="submit"
                    disabled={!props.peerId}
                    aria-label={t('send')}
                    title={
                      selectedGallery.length
                        ? `${t('send')} (${selectedGallery.length})`
                        : t('send')
                    }
                  >
                    <IconSendArrow size={20} />
                    {selectedGallery.length ? (
                      <span className="composer-send-badge">{selectedGallery.length}</span>
                    ) : null}
                  </button>
                ) : recording ? (
                  <button
                    type="button"
                    className="composer-icon-btn mic is-recording"
                    onClick={() => stopRecording(true)}
                    aria-label={t('stopRecording')}
                  >
                    {recordSecs}s
                  </button>
                ) : (
                  <button
                    type="button"
                    className="composer-icon-btn mic"
                    aria-label={t('recordVoice')}
                    disabled={!props.peerId}
                    onClick={() => void startRecording()}
                  >
                    <IconMic size={22} />
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </section>

      {cameraOpen ? (
        <div className="camera-capture-overlay" role="dialog" aria-modal="true">
          <header className="camera-capture-top">
            <button type="button" className="button button-ghost button-compact" onClick={closeCamera}>
              {t('close')}
            </button>
            <strong>{t('takePhoto')}</strong>
            <span />
          </header>
          <div className="camera-capture-stage">
            {cameraShot ? (
              <img src={cameraShot.url} alt="" className="camera-capture-preview" />
            ) : (
              <video ref={cameraVideoRef} className="camera-capture-video" playsInline muted autoPlay />
            )}
            <canvas ref={cameraCanvasRef} className="sr-only" />
          </div>
          <div className="camera-capture-actions">
            {cameraShot ? (
              <>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={cameraBusy}
                  onClick={() => void retakeCameraPhoto()}
                >
                  {t('retakePhoto')}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={cameraBusy}
                  onClick={() => void sendCameraPhoto()}
                >
                  {cameraBusy ? '…' : t('send')}
                </button>
              </>
            ) : (
              <button type="button" className="camera-shutter" aria-label={t('takePhoto')} onClick={captureCameraPhoto} />
            )}
          </div>
        </div>
      ) : null}

      {shareFor ? (
        <div className="sheet-backdrop" onClick={() => (!shareBusy ? setShareFor(null) : undefined)}>
          <div className="sheet wa-share-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{t('share')}</h3>
            <div className="wa-share-tabs" role="tablist">
              {(
                [
                  ['users', t('shareToUsers')],
                  ['groups', t('shareToGroups')],
                  ['channels', t('shareToChannels')]
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={shareTab === id}
                  className={`button button-compact ${shareTab === id ? '' : 'button-ghost'}`}
                  disabled={shareBusy}
                  onClick={() => {
                    setShareTab(id);
                    setSharePending(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {shareTab === 'users' ? (
              <input
                value={shareQ}
                onChange={(e) => setShareQ(e.target.value)}
                placeholder={t('shareSearchHint')}
                dir="auto"
                disabled={shareBusy}
              />
            ) : (
              <input
                value={shareQ}
                onChange={(e) => setShareQ(e.target.value)}
                placeholder={t('shareSearchHint')}
                dir="auto"
                disabled={shareBusy}
              />
            )}
            {shareFeedback ? <p className="wa-share-feedback">{shareFeedback}</p> : null}
            {sharePending ? (
              <div className="wa-share-confirm">
                <p>
                  {t('shareConfirmSend')}
                  <br />
                  <strong>{sharePending.title}</strong>
                </p>
                <div className="wa-share-confirm-actions">
                  <button
                    type="button"
                    className="button button-ghost button-compact"
                    disabled={shareBusy}
                    onClick={() => setSharePending(null)}
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    className="button button-compact"
                    disabled={shareBusy}
                    onClick={() => void confirmShareSend()}
                  >
                    {shareBusy ? '…' : t('send')}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="wa-share-list">
              {shareTab === 'users'
                ? sharePeople.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="list-row"
                      disabled={shareBusy}
                      onClick={() =>
                        setSharePending({
                          kind: 'user',
                          id: u.id,
                          title: `@${u.username || u.displayName || u.id}`
                        })
                      }
                    >
                      @{u.username || u.id}
                    </button>
                  ))
                : null}
              {shareTab === 'groups'
                ? shareGroups
                    .filter((g) => {
                      const q = shareQ.trim().toLowerCase();
                      if (!q) return true;
                      return String(g.name || '').toLowerCase().includes(q);
                    })
                    .map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        className="list-row"
                        disabled={shareBusy}
                        onClick={() =>
                          setSharePending({
                            kind: 'group',
                            id: g.id,
                            title: g.name || t('groups')
                          })
                        }
                      >
                        {g.name || g.id}
                      </button>
                    ))
                : null}
              {shareTab === 'channels'
                ? shareChannels
                    .filter((c) => {
                      const q = shareQ.trim().toLowerCase();
                      if (!q) return true;
                      return String(c.name || '').toLowerCase().includes(q);
                    })
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="list-row"
                        disabled={shareBusy}
                        onClick={() =>
                          setSharePending({
                            kind: 'channel',
                            id: c.id,
                            title: c.name || t('channels')
                          })
                        }
                      >
                        {c.name || c.id}
                      </button>
                    ))
                : null}
            </div>
            <button
              type="button"
              className="button button-ghost button-compact"
              disabled={shareBusy}
              onClick={() => setShareFor(null)}
            >
              {t('close')}
            </button>
          </div>
        </div>
      ) : null}

      {viewer ? (
        <div className="ephemeral-viewer album-viewer" role="dialog" aria-modal="true">
          <div className="ephemeral-viewer-bar">
            <div className="album-viewer-meta">
              {viewer.mode === 'timed' ? <span>{viewerLeft}s</span> : null}
              {viewer.items.length > 1 ? (
                <span>
                  {viewer.index + 1}/{viewer.items.length}
                </span>
              ) : null}
            </div>
            <div className="album-viewer-actions">
              {viewer.mode === 'normal' ? (
                <>
                  <button
                    type="button"
                    className="button button-ghost button-compact"
                    onClick={() => {
                      const cur = viewer.items[viewer.index];
                      if (cur) void downloadUrl(cur.url, `chat-${cur.mediaId}.jpg`);
                    }}
                  >
                    {t('saveCurrent')}
                  </button>
                  {viewer.items.length > 1 ? (
                    <button
                      type="button"
                      className="button button-ghost button-compact"
                      onClick={() => {
                        void (async () => {
                          for (let i = 0; i < viewer.items.length; i++) {
                            const it = viewer.items[i];
                            if (!it) continue;
                            await downloadUrl(it.url, `chat-${it.mediaId}-${i + 1}.jpg`);
                          }
                        })();
                      }}
                    >
                      {t('saveAll')}
                    </button>
                  ) : null}
                </>
              ) : null}
              <button type="button" className="icon-btn" onClick={() => closeViewer(viewer.mode === 'once')} aria-label={t('close')}>
                ×
              </button>
            </div>
          </div>
          <div className="album-viewer-stage">
            {viewer.items.length > 1 ? (
              <button
                type="button"
                className="album-nav album-nav-prev"
                aria-label={t('back')}
                disabled={viewer.index <= 0}
                onClick={() => setViewer((v) => (v ? { ...v, index: Math.max(0, v.index - 1) } : v))}
              >
                ‹
              </button>
            ) : null}
            <img src={viewer.items[viewer.index]?.url} alt="" />
            {viewer.items.length > 1 ? (
              <button
                type="button"
                className="album-nav album-nav-next"
                aria-label={t('loadMore')}
                disabled={viewer.index >= viewer.items.length - 1}
                onClick={() =>
                  setViewer((v) => (v ? { ...v, index: Math.min(v.items.length - 1, v.index + 1) } : v))
                }
              >
                ›
              </button>
            ) : null}
          </div>
          {viewer.items.length > 1 ? (
            <div className="album-thumbs">
              {viewer.items.map((it, i) => (
                <button
                  key={it.mediaId}
                  type="button"
                  className={`album-thumb ${i === viewer.index ? 'is-active' : ''}`}
                  onClick={() => setViewer((v) => (v ? { ...v, index: i } : v))}
                >
                  <img src={it.url} alt="" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function MessageAttachment({
  att,
  blurred,
  onOpen
}: {
  att: { mediaId: string; mimeType: string; mediaType: string; purpose: string; durationSeconds: number | null };
  blurred?: boolean;
  onOpen?: (url: string) => void;
}) {
  const { t } = useI18n();
  const { session } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [blockedAuto, setBlockedAuto] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setBlockedAuto(false);
    const inFocus = typeof window !== 'undefined' && window.location.pathname.startsWith('/focus');
    if (inFocus) {
      // Lazy import avoids circular deps with focus prefs.
      void import('./focus/focusPrefs').then(({ canAutoDownloadMedia, recordDataUsage }) => {
        if (!alive) return;
        if (!canAutoDownloadMedia(session?.user?.id)) {
          setBlockedAuto(true);
          return;
        }
        void fetchMediaUrl(att.mediaId)
          .then((r) => {
            if (!alive) return;
            const next = resolveMediaUrl(r.secureUrl);
            if (next) {
              setUrl(next);
              recordDataUsage(session?.user?.id, 'in', 64 * 1024);
              void import('./focus/focusPrefs').then(({ loadStoragePrefs }) => {
                const sp = loadStoragePrefs(session?.user?.id);
                if (!sp.saveGalleryPrivate) return;
                const a = document.createElement('a');
                a.href = next;
                a.download = `securechat-${att.mediaId}`;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
              });
            } else setFailed(true);
          })
          .catch(() => {
            if (alive) setFailed(true);
          });
      });
      return () => {
        alive = false;
      };
    }
    void fetchMediaUrl(att.mediaId)
      .then((r) => {
        if (!alive) return;
        const next = resolveMediaUrl(r.secureUrl);
        if (next) setUrl(next);
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [att.mediaId, session?.user?.id]);

  const isAudio = att.mediaType === 'audio' || att.mimeType.startsWith('audio/');
  const isVideo = att.mediaType === 'video' || att.mimeType.startsWith('video/');

  async function loadManually() {
    setBlockedAuto(false);
    setFailed(false);
    try {
      const r = await fetchMediaUrl(att.mediaId);
      const next = resolveMediaUrl(r.secureUrl);
      if (next) {
        setUrl(next);
        const { recordDataUsage } = await import('./focus/focusPrefs');
        recordDataUsage(session?.user?.id, 'in', 64 * 1024);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }

  if (blockedAuto && !url) {
    return (
      <button type="button" className="button button-ghost button-compact" onClick={() => void loadManually()}>
        {t('downloadMedia')}
      </button>
    );
  }

  if (isAudio) {
    if (failed && !url) {
      return <div className="wa-media-missing muted tiny">{t('mediaMissing')}</div>;
    }
    if (!url) {
      return <div className="wa-voice-loading" aria-hidden />;
    }
    return (
      <div className="wa-voice-player">
        <audio controls preload="metadata" src={url} className="bubble-audio" />
      </div>
    );
  }

  if (failed && !url) {
    return <div className="wa-media-missing muted tiny">{t('mediaMissing')}</div>;
  }

  if (!url) {
    return (
      <div className="wa-chat-img-loading" aria-hidden>
        <span className="shimmer" />
      </div>
    );
  }

  if (blurred) {
    return (
      <button type="button" className="wa-ephemeral-thumb" onClick={() => onOpen?.(url)}>
        <img src={url} alt="" className="wa-chat-img" />
        <span className="wa-ephemeral-lock">◌</span>
      </button>
    );
  }

  if (isVideo) {
    return (
      <div className="wa-media-open">
        <video src={url} controls playsInline className="wa-chat-img" preload="metadata" />
      </div>
    );
  }

  return (
    <button type="button" className="wa-media-open" onClick={() => onOpen?.(url)}>
      <img
        src={url}
        alt=""
        className="wa-chat-img"
        loading="eager"
        onError={() => setFailed(true)}
      />
    </button>
  );
}
