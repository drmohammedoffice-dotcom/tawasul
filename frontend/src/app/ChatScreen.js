import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { searchAll, uploadMediaFile, fetchMediaUrl, resolveMediaUrl, blockUser, fetchUserProfile, fetchFollowing, followUser, fetchMyGroups, fetchMyChannels, sendGroupMessage, sendChannelMessage } from '@/api/social';
import { useAuth } from '@/auth/AuthProvider';
import { listVaultAccounts, upsertVaultAccount, vaultToSession } from '@/lib/accountVault';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { useI18n } from '@/i18n/I18nProvider';
import { IconBack, IconCamera, IconCheck, IconChevronDown, IconCompose, IconImage, IconMic, IconMore, IconPhone, IconPin, IconSearch, IconSendArrow, IconSticker, IconVideo } from './ui/Icons';
import { UserAvatar } from './ui/UserAvatar';
import { AvatarCrop } from './ui/AvatarCrop';
import { parseShareContent, ShareContentBubble, sharePreviewLabel } from './ui/ShareContentBubble';
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
function scopedKey(base, userId) {
    return `${base}.${userId || 'anon'}`;
}
function loadIdSet(key) {
    try {
        const raw = localStorage.getItem(key);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr : []);
    }
    catch {
        return new Set();
    }
}
function persistIdSet(key, ids) {
    try {
        localStorage.setItem(key, JSON.stringify([...ids]));
    }
    catch {
        /* ignore */
    }
}
function loadIdList(key) {
    try {
        const raw = localStorage.getItem(key);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
    }
    catch {
        return [];
    }
}
function persistIdList(key, ids) {
    try {
        localStorage.setItem(key, JSON.stringify(ids));
    }
    catch {
        /* ignore */
    }
}
function loadMuted(userId) {
    return loadIdSet(scopedKey(MUTED_KEY, userId));
}
function persistMuted(userId, ids) {
    persistIdSet(scopedKey(MUTED_KEY, userId), ids);
}
function loadInboxBuckets(userId) {
    try {
        const raw = localStorage.getItem(scopedKey(INBOX_BUCKET_KEY, userId));
        const obj = raw ? JSON.parse(raw) : {};
        return obj && typeof obj === 'object' ? obj : {};
    }
    catch {
        return {};
    }
}
function persistInboxBuckets(userId, map) {
    try {
        localStorage.setItem(scopedKey(INBOX_BUCKET_KEY, userId), JSON.stringify(map));
    }
    catch {
        /* ignore */
    }
}
function loadInboxHidden(userId) {
    return loadIdSet(scopedKey(INBOX_HIDDEN_KEY, userId));
}
function persistInboxHidden(userId, ids) {
    persistIdSet(scopedKey(INBOX_HIDDEN_KEY, userId), ids);
}
function formatInboxAgo(iso, locale) {
    if (!iso)
        return '';
    try {
        const diff = Date.now() - new Date(iso).getTime();
        if (Number.isNaN(diff) || diff < 0)
            return '';
        const mins = Math.floor(diff / 60000);
        if (mins < 1)
            return locale.startsWith('ar') ? 'الآن' : 'now';
        if (mins < 60)
            return `${mins}m`;
        const hours = Math.floor(mins / 60);
        if (hours < 24)
            return `${hours}h`;
        const days = Math.floor(hours / 24);
        if (days < 7)
            return `${days}d`;
        return new Date(iso).toLocaleDateString(locale.startsWith('ar') ? 'ar' : 'en', {
            month: 'short',
            day: 'numeric'
        });
    }
    catch {
        return '';
    }
}
function classifyConversation(c, me, followingIds, buckets) {
    const override = buckets[c.peer.id];
    if (override)
        return override;
    if (followingIds.has(c.peer.id))
        return 'primary';
    const last = c.lastMessage;
    if (!last)
        return 'requests';
    if (last.senderId !== me)
        return 'requests';
    return 'general';
}
function mediaMetaFromText(text) {
    const once = text.match(/^\[img:once\]\s*(.*)$/s);
    if (once)
        return { mode: 'once', ttl: 0, body: once[1] || '' };
    const timed = text.match(/^\[img:ttl:(\d+)\]\s*(.*)$/s);
    if (timed)
        return { mode: 'timed', ttl: Math.min(60, Math.max(1, Number(timed[1]) || 1)), body: timed[2] || '' };
    const img = text.match(/^\[img\]\s*(.*)$/s);
    if (img)
        return { mode: 'normal', ttl: 0, body: img[1] || '' };
    return { mode: 'normal', ttl: 0, body: text };
}
function formatMsgTime(iso, locale) {
    try {
        return new Date(iso).toLocaleString(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    catch {
        return iso;
    }
}
export default function ChatScreen(props) {
    const { t, dir, locale } = useI18n();
    const { setSession } = useAuth();
    const uid = props.currentUserId;
    const messages = props.messagesByPeer[props.peerId] ?? [];
    const messageEndRef = useRef(null);
    const listRef = useRef(null);
    const draftInputRef = useRef(null);
    const galleryInputRef = useRef(null);
    const [query, setQuery] = useState('');
    const [peopleQ, setPeopleQ] = useState('');
    const [people, setPeople] = useState([]);
    const [peopleLoading, setPeopleLoading] = useState(false);
    const [inboxTab, setInboxTab] = useState('all');
    const [inboxFilter, setInboxFilter] = useState('none');
    const [composeOpen, setComposeOpen] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const [addAccountStep, setAddAccountStep] = useState(false);
    const [vaultAccounts, setVaultAccounts] = useState(() => listVaultAccounts());
    const [inboxMoreOpen, setInboxMoreOpen] = useState(false);
    const [rowMenuPeer, setRowMenuPeer] = useState(null);
    const [followingIds, setFollowingIds] = useState(() => new Set());
    const [inboxBuckets, setInboxBuckets] = useState(() => loadInboxBuckets(uid));
    const [inboxHidden, setInboxHidden] = useState(() => loadInboxHidden(uid));
    const [pinnedPeers, setPinnedPeers] = useState(() => loadIdList(scopedKey(INBOX_PINNED_KEY, uid)));
    const [archivedPeers, setArchivedPeers] = useState(() => loadIdSet(scopedKey(INBOX_ARCHIVED_KEY, uid)));
    const [forcedUnread, setForcedUnread] = useState(() => loadIdSet(scopedKey(INBOX_FORCED_UNREAD_KEY, uid)));
    const [markedRead, setMarkedRead] = useState(() => loadIdSet(scopedKey(INBOX_MARKED_READ_KEY, uid)));
    const [error, setError] = useState('');
    const [recording, setRecording] = useState(false);
    const [recordSecs, setRecordSecs] = useState(0);
    const [stickersOpen, setStickersOpen] = useState(false);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [galleryItems, setGalleryItems] = useState([]);
    const [sendMode, setSendMode] = useState('normal');
    const [ttlSecs, setTtlSecs] = useState(10);
    const [croppingId, setCroppingId] = useState(null);
    const [pendingAudio, setPendingAudio] = useState(null);
    const [waveBars, setWaveBars] = useState(() => Array.from({ length: 24 }, () => 0.12));
    const [peerMenuOpen, setPeerMenuOpen] = useState(false);
    const [msgMenuId, setMsgMenuId] = useState(null);
    const [timeShownId, setTimeShownId] = useState(null);
    const [replyTo, setReplyTo] = useState(null);
    const [editing, setEditing] = useState(null);
    const [shareFor, setShareFor] = useState(null);
    const [shareQ, setShareQ] = useState('');
    const [shareTab, setShareTab] = useState('users');
    const [sharePeople, setSharePeople] = useState([]);
    const [shareGroups, setShareGroups] = useState([]);
    const [shareChannels, setShareChannels] = useState([]);
    const [sharePending, setSharePending] = useState(null);
    const [shareBusy, setShareBusy] = useState(false);
    const [shareFeedback, setShareFeedback] = useState('');
    const [mutedChats, setMutedChats] = useState(() => loadMuted(uid));
    const [peerProfile, setPeerProfile] = useState(null);
    const [peerFollowBusy, setPeerFollowBusy] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [cameraStream, setCameraStream] = useState(null);
    const [cameraShot, setCameraShot] = useState(null);
    const [cameraBusy, setCameraBusy] = useState(false);
    const cameraVideoRef = useRef(null);
    const cameraCanvasRef = useRef(null);
    const [viewer, setViewer] = useState(null);
    const [viewerLeft, setViewerLeft] = useState(0);
    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const recordTimerRef = useRef(null);
    const recordSecsRef = useRef(0);
    const audioCtxRef = useRef(null);
    const analyserRef = useRef(null);
    const waveRafRef = useRef(null);
    const autoSendVoiceRef = useRef(false);
    const discardVoiceRef = useRef(false);
    const stickAtBottom = useRef(true);
    const prevScrollHeight = useRef(0);
    const consumedOnce = useRef(new Set());
    function isUnreadVisual(peerId, unreadCount) {
        if (forcedUnread.has(peerId))
            return true;
        if (markedRead.has(peerId))
            return false;
        return unreadCount > 0;
    }
    const allConversations = useMemo(() => {
        const fromApi = props.conversations;
        const fallbackIds = Object.keys(props.messagesByPeer).filter((id) => !fromApi.some((c) => c.peer.id === id));
        const merged = [
            ...fromApi,
            ...fallbackIds.map((id) => ({
                peer: {
                    id,
                    username: props.peerMeta[id]?.username || id.slice(0, 8),
                    displayName: props.peerMeta[id]?.displayName ?? null,
                    avatarUrl: props.peerMeta[id]?.avatarUrl ?? null
                },
                lastMessage: (props.messagesByPeer[id] ?? []).at(-1),
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
                if (!archived)
                    return false;
            }
            else {
                if (archived)
                    return false;
                const bucket = classifyConversation(c, props.currentUserId, followingIds, inboxBuckets);
                if (inboxTab !== 'all' && bucket !== inboxTab)
                    return false;
            }
            if (inboxFilter === 'unread' && !isUnreadVisual(c.peer.id, c.unreadCount))
                return false;
            if (inboxFilter === 'muted' && !mutedChats.has(c.peer.id))
                return false;
            if (!q)
                return true;
            const name = `${c.peer.displayName || ''} ${c.peer.username}`.toLowerCase();
            const preview = (c.lastMessage?.encryptedContent || '').toLowerCase();
            return name.includes(q) || preview.includes(q);
        });
        const pinRank = new Map(pinnedPeers.map((id, i) => [id, i]));
        return filtered.sort((a, b) => {
            const ap = pinRank.has(a.peer.id);
            const bp = pinRank.has(b.peer.id);
            if (ap && bp)
                return (pinRank.get(a.peer.id) ?? 0) - (pinRank.get(b.peer.id) ?? 0);
            if (ap)
                return -1;
            if (bp)
                return 1;
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
        if (!props.peerId)
            return;
        // Opening a chat clears unread glow / "new messages"
        setForcedUnread((prev) => {
            if (!prev.has(props.peerId))
                return prev;
            const next = new Set(prev);
            next.delete(props.peerId);
            persistIdSet(scopedKey(INBOX_FORCED_UNREAD_KEY, uid), next);
            return next;
        });
        setMarkedRead((prev) => {
            if (prev.has(props.peerId))
                return prev;
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
            if (cancelled)
                return;
            const ids = new Set();
            for (const u of rows || []) {
                if (u?.id)
                    ids.add(String(u.id));
            }
            setFollowingIds(ids);
        })
            .catch(() => {
            if (!cancelled)
                setFollowingIds(new Set());
        });
        return () => {
            cancelled = true;
        };
    }, [props.username]);
    useEffect(() => {
        if (!composeOpen && !filterOpen && !accountMenuOpen && !inboxMoreOpen && !rowMenuPeer)
            return;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                setComposeOpen(false);
                setFilterOpen(false);
                setAccountMenuOpen(false);
                setInboxMoreOpen(false);
                setRowMenuPeer(null);
            }
        };
        const onDoc = (e) => {
            const t = e.target;
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
    function setPeerBucket(peerId, bucket) {
        setInboxBuckets((prev) => {
            const next = { ...prev, [peerId]: bucket };
            persistInboxBuckets(uid, next);
            return next;
        });
        setRowMenuPeer(null);
    }
    function hideConversation(peerId) {
        setInboxHidden((prev) => {
            const next = new Set(prev);
            next.add(peerId);
            persistInboxHidden(uid, next);
            return next;
        });
        setRowMenuPeer(null);
        if (props.peerId === peerId)
            props.onPeerChange('');
    }
    function acceptRequest(peerId) {
        setPeerBucket(peerId, followingIds.has(peerId) ? 'primary' : 'general');
        setInboxTab('all');
        void props.onOpenChat(peerId);
    }
    function toggleReadState(peerId, unreadCount) {
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
        }
        else {
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
    function togglePin(peerId) {
        setPinnedPeers((prev) => {
            const next = prev.includes(peerId) ? prev.filter((id) => id !== peerId) : [peerId, ...prev.filter((id) => id !== peerId)];
            persistIdList(scopedKey(INBOX_PINNED_KEY, uid), next);
            return next;
        });
        setRowMenuPeer(null);
    }
    function toggleArchive(peerId) {
        setArchivedPeers((prev) => {
            const next = new Set(prev);
            if (next.has(peerId))
                next.delete(peerId);
            else
                next.add(peerId);
            persistIdSet(scopedKey(INBOX_ARCHIVED_KEY, uid), next);
            return next;
        });
        setRowMenuPeer(null);
        if (props.peerId === peerId)
            props.onPeerChange('');
    }
    async function blockAndHide(peerId) {
        try {
            await blockUser(peerId);
            hideConversation(peerId);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
            setRowMenuPeer(null);
        }
    }
    function switchToAccount(account) {
        const current = getSessionSnapshot();
        if (current)
            upsertVaultAccount(current);
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
    function startAddAccount(mode) {
        const current = getSessionSnapshot();
        if (current)
            upsertVaultAccount(current);
        setAccountMenuOpen(false);
        setAddAccountStep(false);
        window.dispatchEvent(new CustomEvent('securechat:auth-intent', { detail: { mode } }));
    }
    function promotePeerOnReply(peerId) {
        if (!peerId)
            return;
        setInboxBuckets((prev) => {
            const cur = prev[peerId];
            if (cur === 'primary' || cur === 'general')
                return prev;
            const nextBucket = followingIds.has(peerId) ? 'primary' : 'general';
            const next = { ...prev, [peerId]: nextBucket };
            persistInboxBuckets(uid, next);
            return next;
        });
    }
    function conversationPreview(c) {
        if (c.peer.id === props.peerId && props.typingHint)
            return t('typingNow');
        const raw = c.lastMessage?.encryptedContent || '';
        const metaPreview = mediaMetaFromText(raw);
        const sharePrev = parseShareContent(raw);
        const hasMedia = Boolean(c.lastMessage?.mediaAttachments?.length);
        const ago = formatInboxAgo(c.lastMessage?.timestamp, locale);
        if (c.lastMessage?.isDeleted)
            return t('messageDeleted');
        if (c.lastMessage &&
            c.lastMessage.senderId === props.currentUserId &&
            c.lastMessage.status === 'read') {
            return `${t('seenAgo')} ${ago}`.trim();
        }
        let body = '';
        if (sharePrev) {
            body = sharePrev.targetType === 'reel' ? t('sharedReel') : t('sharedPost');
        }
        else if (raw.startsWith('[voice')) {
            body = t('recordVoice');
        }
        else if (raw.startsWith('[sticker]')) {
            body = raw.replace('[sticker]', '').trim() || t('stickers');
        }
        else if (raw.startsWith('[img')) {
            body = metaPreview.body || (hasMedia ? '📷' : '📷');
        }
        else {
            body = metaPreview.body || raw;
        }
        return ago ? `${body} · ${ago}` : body;
    }
    const activePeer = props.conversations.find((c) => c.peer.id === props.peerId)?.peer ||
        (props.peerId
            ? {
                id: props.peerId,
                username: peerProfile?.username ||
                    props.peerMeta[props.peerId]?.username ||
                    props.peerId.slice(0, 8),
                displayName: peerProfile?.displayName ?? props.peerMeta[props.peerId]?.displayName ?? null,
                avatarUrl: peerProfile?.avatarUrl ?? props.peerMeta[props.peerId]?.avatarUrl ?? null
            }
            : null);
    const byId = useMemo(() => {
        const m = new Map();
        for (const msg of messages)
            m.set(msg.id, msg);
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
                setPeople((res.users || []).filter((u) => u.id !== props.currentUserId));
            })
                .catch((err) => {
                if (err?.name === 'AbortError')
                    return;
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
        if (!shareFor || shareTab !== 'users')
            return;
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
                .then((res) => setSharePeople((res.users || []).filter((u) => u.id !== props.currentUserId).slice(0, 16)))
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
            if (!cancelled)
                setPeerProfile(null);
        });
        return () => {
            cancelled = true;
        };
    }, [props.peerId]);
    useEffect(() => {
        const el = cameraVideoRef.current;
        if (!cameraOpen || !cameraStream || !el || cameraShot)
            return;
        el.srcObject = cameraStream;
        void el.play().catch(() => undefined);
    }, [cameraOpen, cameraStream, cameraShot]);
    useEffect(() => {
        return () => {
            cameraStream?.getTracks().forEach((t) => t.stop());
            if (cameraShot)
                URL.revokeObjectURL(cameraShot.url);
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
        }
        catch {
            setError(t('errorGeneric'));
        }
    }
    function closeCamera() {
        cameraStream?.getTracks().forEach((t) => t.stop());
        setCameraStream(null);
        if (cameraShot)
            URL.revokeObjectURL(cameraShot.url);
        setCameraShot(null);
        setCameraOpen(false);
    }
    function captureCameraPhoto() {
        const video = cameraVideoRef.current;
        const canvas = cameraCanvasRef.current;
        if (!video || !canvas)
            return;
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob((blob) => {
            if (!blob)
                return;
            if (cameraShot)
                URL.revokeObjectURL(cameraShot.url);
            setCameraShot({ blob, url: URL.createObjectURL(blob) });
            cameraStream?.getTracks().forEach((t) => t.stop());
            setCameraStream(null);
        }, 'image/jpeg', 0.92);
    }
    function retakeCameraPhoto() {
        if (cameraShot)
            URL.revokeObjectURL(cameraShot.url);
        setCameraShot(null);
        void openCamera();
    }
    async function sendCameraPhoto() {
        if (!cameraShot || !props.peerId)
            return;
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setCameraBusy(false);
        }
    }
    async function followPeerFromChat() {
        if (!peerProfile?.id || peerFollowBusy)
            return;
        setPeerFollowBusy(true);
        try {
            const res = (await followUser(peerProfile.id));
            const next = res.status || 'accepted';
            setPeerProfile((p) => p
                ? {
                    ...p,
                    followStatus: next,
                    viewerFollowStatus: next,
                    _count: {
                        ...p._count,
                        followers: next === 'accepted' ? (p._count?.followers ?? 0) + 1 : p._count?.followers ?? 0
                    }
                }
                : p);
            if (next === 'accepted') {
                setFollowingIds((prev) => {
                    const ids = new Set(prev);
                    ids.add(peerProfile.id);
                    return ids;
                });
                setPeerBucket(peerProfile.id, 'primary');
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setPeerFollowBusy(false);
        }
    }
    useEffect(() => {
        const el = listRef.current;
        if (!el)
            return;
        if (stickAtBottom.current) {
            messageEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
        else if (prevScrollHeight.current) {
            el.scrollTop = el.scrollHeight - prevScrollHeight.current;
            prevScrollHeight.current = 0;
        }
    }, [messages.length, props.peerId]);
    useEffect(() => {
        if (!viewer || viewer.mode !== 'timed')
            return;
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
        if (!el)
            return;
        stickAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    }
    async function loadOlderPreservingScroll() {
        const el = listRef.current;
        if (el)
            prevScrollHeight.current = el.scrollHeight - el.scrollTop;
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
        }
        catch {
            /* ignore */
        }
        audioCtxRef.current = null;
        analyserRef.current = null;
        setWaveBars(Array.from({ length: 24 }, () => 0.12));
    }
    function startWaveform(stream) {
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
                if (!a)
                    return;
                a.getByteFrequencyData(data);
                const bars = [];
                const step = Math.max(1, Math.floor(data.length / 24));
                for (let i = 0; i < 24; i++) {
                    const v = data[i * step] ?? 0;
                    bars.push(0.12 + (v / 255) * 0.88);
                }
                setWaveBars(bars);
                waveRafRef.current = window.requestAnimationFrame(tick);
            };
            waveRafRef.current = window.requestAnimationFrame(tick);
        }
        catch {
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
                if (e.data.size)
                    chunksRef.current.push(e.data);
            };
            rec.onstop = () => {
                stream.getTracks().forEach((tr) => tr.stop());
                stopWaveform();
                const secs = recordSecsRef.current;
                if (recordTimerRef.current)
                    window.clearInterval(recordTimerRef.current);
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
        }
        catch {
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
        if (recording)
            mediaRecorderRef.current?.stop();
        stopWaveform();
        if (pendingAudio)
            URL.revokeObjectURL(pendingAudio.url);
        setPendingAudio(null);
        setRecording(false);
    }
    async function sendVoiceBlob(blob, secs) {
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function sendPendingAudio() {
        if (!pendingAudio)
            return;
        const { blob, url, secs } = pendingAudio;
        URL.revokeObjectURL(url);
        setPendingAudio(null);
        await sendVoiceBlob(blob, secs);
    }
    function onPickGallery(files) {
        if (!files?.length)
            return;
        const next = [...galleryItems];
        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/'))
                continue;
            next.push({
                id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
                file,
                url: URL.createObjectURL(file),
                selected: true
            });
        }
        setGalleryItems(next);
        setGalleryOpen(true);
        if (galleryInputRef.current)
            galleryInputRef.current.value = '';
    }
    function toggleGallerySelect(id) {
        setGalleryItems((prev) => prev.map((g) => (g.id === id ? { ...g, selected: !g.selected } : g)));
    }
    function applyGalleryCrop(itemId, blob) {
        setGalleryItems((prev) => prev.map((g) => {
            if (g.id !== itemId)
                return g;
            URL.revokeObjectURL(g.url);
            const file = new File([blob], g.file.name.replace(/\.\w+$/, '') + '-crop.jpg', {
                type: 'image/jpeg'
            });
            return { ...g, file, url: URL.createObjectURL(file), cropped: true, selected: true };
        }));
        setCroppingId(null);
    }
    async function sendGallery() {
        const selected = galleryItems.filter((g) => g.selected);
        if (!selected.length)
            return;
        try {
            const mediaIds = [];
            for (const item of selected.slice(0, 30)) {
                mediaIds.push(await uploadMediaFile(item.file, 'chat'));
            }
            const caption = props.draft.trim();
            const prefix = sendMode === 'once'
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    function submitComposer(e) {
        e?.preventDefault();
        if (!props.peerId)
            return;
        const selected = galleryItems.filter((g) => g.selected);
        if (selected.length && !editing) {
            void sendGallery();
            return;
        }
        const text = props.draft.trim();
        if (!text)
            return;
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
    function insertSticker(emoji) {
        if (!props.peerId)
            return;
        props.onSend({
            text: `[sticker] ${emoji}`,
            ...(replyTo?.id ? { replyToMessageId: replyTo.id } : {})
        });
        promotePeerOnReply(props.peerId);
        props.onDraftChange('');
        setReplyTo(null);
        setStickersOpen(false);
    }
    function isVoiceMessage(msg) {
        const text = msg.encryptedContent || '';
        if (text.startsWith('[voice'))
            return true;
        return (msg.mediaAttachments || []).some((a) => a.mediaType === 'audio' || a.mimeType.startsWith('audio/') || a.purpose === 'voice');
    }
    async function downloadUrl(url, filename) {
        try {
            const res = await fetch(url);
            const blob = await res.blob();
            const href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = href;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(href);
        }
        catch {
            window.open(url, '_blank');
        }
    }
    function mediaExt(att) {
        const mime = (att.mimeType || '').toLowerCase();
        const kind = (att.mediaType || '').toLowerCase();
        if (mime.includes('video') || kind === 'video')
            return 'mp4';
        if (mime.includes('audio') || kind === 'audio')
            return 'webm';
        if (mime.includes('png'))
            return 'png';
        if (mime.includes('webp'))
            return 'webp';
        if (mime.includes('gif'))
            return 'gif';
        return 'jpg';
    }
    async function downloadMessageMedia(msg) {
        const atts = msg.mediaAttachments || [];
        for (const att of atts) {
            try {
                const r = await fetchMediaUrl(att.mediaId);
                const u = resolveMediaUrl(r.secureUrl);
                if (!u)
                    continue;
                await downloadUrl(u, `chat-${att.mediaId}.${mediaExt(att)}`);
            }
            catch {
                /* skip */
            }
        }
    }
    async function buildShareText(msg) {
        const meta = mediaMetaFromText(msg.encryptedContent || '');
        const raw = (meta.body || msg.encryptedContent || '').trim();
        const skipBody = !raw ||
            raw.startsWith('[img') ||
            raw.startsWith('[voice') ||
            raw.startsWith('[sticker]') ||
            Boolean(parseShareContent(raw));
        const urls = [];
        for (const att of msg.mediaAttachments || []) {
            try {
                const r = await fetchMediaUrl(att.mediaId);
                const u = resolveMediaUrl(r.secureUrl);
                if (u)
                    urls.push(u);
            }
            catch {
                /* skip */
            }
        }
        const parts = [...(skipBody ? [] : [raw]), ...urls];
        return parts.join('\n').trim() || '[forward]';
    }
    async function confirmShareSend() {
        if (!shareFor || !sharePending || shareBusy)
            return;
        setShareBusy(true);
        setShareFeedback('');
        try {
            const body = mediaMetaFromText(shareFor.encryptedContent || '').body ||
                shareFor.encryptedContent ||
                '';
            if (sharePending.kind === 'user') {
                props.onSend({
                    text: body || '[forward]',
                    forwardFromMessageId: shareFor.id,
                    toUserId: sharePending.id
                });
            }
            else {
                const text = await buildShareText(shareFor);
                if (sharePending.kind === 'group') {
                    await sendGroupMessage(sharePending.id, text);
                }
                else {
                    await sendChannelMessage(sharePending.id, text);
                }
            }
            setShareFeedback(`${t('shareSentOk')}: ${sharePending.title}`);
            setSharePending(null);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
            setSharePending(null);
        }
        finally {
            setShareBusy(false);
        }
    }
    function toggleMuteChat() {
        if (!props.peerId)
            return;
        setMutedChats((prev) => {
            const next = new Set(prev);
            if (next.has(props.peerId))
                next.delete(props.peerId);
            else
                next.add(props.peerId);
            persistMuted(uid, next);
            return next;
        });
        setPeerMenuOpen(false);
    }
    async function onBlockPeer() {
        if (!props.peerId)
            return;
        try {
            await blockUser(props.peerId);
            setPeerMenuOpen(false);
            props.onPeerChange('');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function openViewer(msg, mediaId, url) {
        const meta = mediaMetaFromText(msg.encryptedContent || '');
        if (meta.mode === 'once' && consumedOnce.current.has(msg.id))
            return;
        const imageAtts = (msg.mediaAttachments || []).filter((a) => a.mediaType === 'image' || a.mimeType.startsWith('image/'));
        const items = [];
        if (imageAtts.length > 1) {
            for (const att of imageAtts) {
                if (att.mediaId === mediaId) {
                    items.push({ mediaId, url });
                    continue;
                }
                try {
                    const r = await fetchMediaUrl(att.mediaId);
                    const u = resolveMediaUrl(r.secureUrl);
                    if (u)
                        items.push({ mediaId: att.mediaId, url: u });
                }
                catch {
                    /* skip failed */
                }
            }
        }
        else {
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
        if (!viewer)
            return;
        const { mode, messageId } = viewer;
        setViewer(null);
        if (mode === 'once' || forceDelete) {
            consumedOnce.current.add(messageId);
            props.onDeleteMessage?.(messageId);
        }
    }
    function isEphemeralLocked(msg) {
        const meta = mediaMetaFromText(msg.encryptedContent || '');
        if (meta.mode === 'normal')
            return false;
        if (msg.senderId === props.currentUserId)
            return false;
        return !consumedOnce.current.has(msg.id);
    }
    return (_jsxs("main", { className: `app-shell messages-shell wa-messages ${props.peerId ? 'chat-open' : ''}${props.embedded ? ' is-embedded-dm' : ''}`, children: [_jsxs("aside", { className: `sidebar ig-inbox ${props.peerId ? 'sidebar-mobile-hidden' : ''}${props.embedded ? ' is-embedded-hidden' : ''}`, children: [_jsxs("div", { className: "ig-inbox-top", children: [_jsxs("div", { className: "ig-inbox-header", children: [_jsx("span", { className: "ig-inbox-header-spacer", "aria-hidden": "true" }), _jsxs("div", { className: "ig-inbox-user-wrap", children: [_jsxs("button", { type: "button", className: "ig-inbox-user-btn", "aria-expanded": accountMenuOpen, onClick: () => {
                                                    setVaultAccounts(listVaultAccounts());
                                                    setAccountMenuOpen((v) => !v);
                                                    setAddAccountStep(false);
                                                    setInboxMoreOpen(false);
                                                }, children: [_jsx("span", { className: "ig-inbox-username", children: props.username }), _jsx(IconChevronDown, { size: 16 })] }), accountMenuOpen ? (_jsx("div", { className: "ig-inbox-menu ig-inbox-account-menu", role: "menu", children: !addAccountStep ? (_jsxs(_Fragment, { children: [vaultAccounts.map((a) => (_jsxs("button", { type: "button", className: `ig-inbox-menu-item ig-inbox-account-item${a.userId === props.currentUserId ? ' is-current' : ''}`, role: "menuitem", onClick: () => switchToAccount(a), children: [_jsx(UserAvatar, { size: "sm", name: a.displayName || a.username, username: a.username, avatarUrl: a.avatarUrl }), _jsxs("span", { className: "ig-inbox-account-meta", children: [_jsx("strong", { children: a.displayName || a.username }), _jsxs("span", { className: "muted tiny", children: ["@", a.username] }), a.userId === props.currentUserId ? (_jsx("span", { className: "muted tiny", children: t('currentAccount') })) : null] })] }, a.userId))), _jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => setAddAccountStep(true), children: t('addAccount') }), _jsx(Link, { to: `/u/${props.username}`, className: "ig-inbox-menu-item", role: "menuitem", onClick: () => setAccountMenuOpen(false), children: t('viewProfile') })] })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => startAddAccount('login'), children: t('loginExistingAccount') }), _jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => startAddAccount('register'), children: t('createNewAccount') }), _jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => setAddAccountStep(false), children: t('cancel') })] })) })) : null] }), _jsxs("div", { className: "ig-inbox-header-actions", children: [_jsxs("div", { className: "ig-inbox-more-wrap", children: [_jsx("button", { type: "button", className: "icon-btn ig-inbox-more-btn", "aria-label": t('more'), onClick: () => {
                                                            setInboxMoreOpen((v) => !v);
                                                            setAccountMenuOpen(false);
                                                        }, children: _jsx(IconMore, { size: 22 }) }), inboxMoreOpen ? (_jsxs("div", { className: "ig-inbox-menu ig-inbox-menu-end", role: "menu", children: [_jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => {
                                                                    setInboxMoreOpen(false);
                                                                    setFilterOpen(true);
                                                                }, children: t('inboxFilter') }), _jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => {
                                                                    setInboxMoreOpen(false);
                                                                    props.onToggleTheme();
                                                                }, children: props.theme === 'dark' ? t('lightMode') : t('darkMode') })] })) : null] }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": t('newMessage'), onClick: () => {
                                                    setComposeOpen(true);
                                                    setPeopleQ('');
                                                    setPeople([]);
                                                }, children: _jsx(IconCompose, { size: 22 }) })] })] }), _jsxs("div", { className: "ig-inbox-search-row", children: [_jsxs("label", { className: "ig-inbox-search", children: [_jsx(IconSearch, { size: 18 }), _jsx("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: t('search'), dir: "auto", autoComplete: "off", enterKeyHint: "search" })] }), _jsx("button", { type: "button", className: `ig-inbox-filter-link${inboxFilter !== 'none' ? ' is-active' : ''}`, onClick: () => setFilterOpen(true), children: t('inboxFilter') })] }), _jsx("div", { className: "ig-inbox-tabs", role: "tablist", "aria-label": t('messages'), children: [
                                    ['all', t('inboxAll'), tabCounts.all],
                                    ['primary', t('inboxPrimary'), tabCounts.primary],
                                    ['general', t('inboxGeneral'), tabCounts.general],
                                    ['requests', t('inboxRequests'), tabCounts.requests],
                                    ['archived', t('inboxArchive'), tabCounts.archived]
                                ].map(([id, label, count]) => (_jsxs("button", { type: "button", role: "tab", "aria-selected": inboxTab === id, className: `ig-inbox-tab${inboxTab === id ? ' is-active' : ''}`, onClick: () => setInboxTab(id), children: [label, (id === 'requests' || id === 'archived') && count > 0 ? (_jsx("span", { className: "ig-inbox-tab-badge", children: count })) : null] }, id))) })] }), inboxTab === 'requests' ? (_jsx("p", { className: "ig-inbox-hint muted tiny", children: t('messageRequestsHint') })) : null, props.reconnecting ? _jsx("p", { className: "muted pad-inline tiny", children: t('reconnecting') }) : null, props.conversationsLoading ? _jsx("p", { className: "muted pad-inline tiny", children: t('loading') }) : null, props.conversationsError ? _jsx("p", { className: "auth-error pad-inline", children: props.conversationsError }) : null, error ? _jsx("p", { className: "auth-error pad-inline", children: error }) : null, _jsxs("div", { className: "ig-inbox-list chat-list", children: [list.length === 0 && !props.conversationsLoading ? (_jsx("p", { className: "muted pad-inline", children: inboxTab === 'all'
                                    ? t('emptyConversations')
                                    : inboxTab === 'archived'
                                        ? t('emptyArchiveChats')
                                        : t('emptyInboxTab') })) : null, list.map((c) => {
                                const preview = conversationPreview(c);
                                const bucket = classifyConversation(c, props.currentUserId, followingIds, inboxBuckets);
                                const isTyping = c.peer.id === props.peerId && Boolean(props.typingHint);
                                const unread = isUnreadVisual(c.peer.id, c.unreadCount);
                                const pinned = pinnedPeers.includes(c.peer.id);
                                const archived = archivedPeers.has(c.peer.id);
                                return (_jsxs("div", { className: `ig-inbox-row${props.peerId === c.peer.id ? ' is-active' : ''}${unread ? ' is-unread is-unread-glow' : ''}`, children: [_jsxs("button", { type: "button", className: "ig-inbox-row-main", onClick: () => props.onSelectChat(c.peer.id), children: [_jsxs("span", { className: `ig-inbox-avatar-wrap${unread ? ' is-glow' : ''}`, children: [_jsx(UserAvatar, { size: "md", name: c.peer.displayName, username: c.peer.username, avatarUrl: c.peer.avatarUrl }), props.onlineByUser[c.peer.id] ? _jsx("span", { className: "ig-inbox-online" }) : null] }), _jsxs("span", { className: "ig-inbox-row-body", children: [_jsxs("span", { className: "ig-inbox-row-name-line", children: [_jsx("span", { className: "ig-inbox-row-name", children: c.peer.displayName || c.peer.username }), pinned ? (_jsx("span", { className: "ig-inbox-pin", title: t('pinChat'), children: _jsx(IconPin, { size: 14 }) })) : null] }), unread ? (_jsx("span", { className: "ig-inbox-new-label", children: t('newMessages') })) : (_jsx("span", { className: `ig-inbox-row-preview${isTyping ? ' is-typing' : ''}`, children: preview }))] }), unread ? _jsx("span", { className: "ig-inbox-unread-dot" }) : null] }), _jsx("button", { type: "button", className: "icon-btn ig-inbox-row-more", "aria-label": t('more'), onClick: (e) => {
                                                e.stopPropagation();
                                                setRowMenuPeer((v) => (v === c.peer.id ? null : c.peer.id));
                                            }, children: _jsx(IconMore, { size: 18 }) }), rowMenuPeer === c.peer.id ? (_jsxs("div", { className: "ig-inbox-menu ig-inbox-row-menu", role: "menu", children: [bucket === 'requests' && !archived ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => acceptRequest(c.peer.id), children: t('acceptRequest') }), _jsx("button", { type: "button", className: "ig-inbox-menu-item danger", role: "menuitem", onClick: () => hideConversation(c.peer.id), children: t('deleteRequest') })] })) : null, _jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => toggleReadState(c.peer.id, c.unreadCount), children: unread ? t('markAsRead') : t('markAsUnread') }), _jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => togglePin(c.peer.id), children: pinned ? t('unpinChat') : t('pinChat') }), _jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => toggleArchive(c.peer.id), children: archived ? t('unarchiveChat') : t('archiveChat') }), !archived ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => setPeerBucket(c.peer.id, 'primary'), children: t('moveToPrimary') }), _jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => setPeerBucket(c.peer.id, 'general'), children: t('moveToGeneral') })] })) : null, _jsx("button", { type: "button", className: "ig-inbox-menu-item", role: "menuitem", onClick: () => {
                                                        setMutedChats((prev) => {
                                                            const next = new Set(prev);
                                                            if (next.has(c.peer.id))
                                                                next.delete(c.peer.id);
                                                            else
                                                                next.add(c.peer.id);
                                                            persistMuted(uid, next);
                                                            return next;
                                                        });
                                                        setRowMenuPeer(null);
                                                    }, children: mutedChats.has(c.peer.id) ? t('unmute') : t('mute') }), _jsx("button", { type: "button", className: "ig-inbox-menu-item danger", role: "menuitem", onClick: () => void blockAndHide(c.peer.id), children: t('block') }), _jsx("button", { type: "button", className: "ig-inbox-menu-item danger", role: "menuitem", title: t('deleteChatHint'), onClick: () => hideConversation(c.peer.id), children: t('deleteChat') })] })) : null] }, c.peer.id));
                            })] })] }), composeOpen ? (_jsx("div", { className: "ig-sheet-backdrop", role: "presentation", onClick: () => setComposeOpen(false), children: _jsxs("div", { className: "ig-sheet", role: "dialog", "aria-modal": "true", "aria-label": t('newMessage'), onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "ig-sheet-head", children: [_jsx("h2", { children: t('newMessage') }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": t('close'), onClick: () => setComposeOpen(false), children: "\u2715" })] }), _jsxs("label", { className: "ig-inbox-search ig-sheet-search", children: [_jsx(IconSearch, { size: 18 }), _jsx("input", { value: peopleQ, onChange: (e) => setPeopleQ(e.target.value), placeholder: t('searchPeopleHint'), dir: "auto", autoFocus: true, autoComplete: "off" })] }), peopleLoading ? _jsx("p", { className: "muted tiny pad-inline", children: t('loading') }) : null, _jsxs("div", { className: "ig-sheet-list", children: [people.map((u) => (_jsxs("button", { type: "button", className: "ig-sheet-person", onClick: () => {
                                        setComposeOpen(false);
                                        setPeopleQ('');
                                        setPeople([]);
                                        if (followingIds.has(u.id))
                                            setPeerBucket(u.id, 'primary');
                                        else
                                            setPeerBucket(u.id, 'general');
                                        void props.onOpenChat(u.id);
                                    }, children: [_jsx(UserAvatar, { size: "md", name: u.displayName, username: u.username, avatarUrl: u.avatarUrl }), _jsxs("span", { className: "ig-sheet-person-text", children: [_jsx("strong", { children: u.displayName || u.username }), _jsxs("span", { className: "muted", children: ["@", u.username] })] })] }, u.id))), !peopleLoading && peopleQ.trim() && people.length === 0 ? (_jsx("p", { className: "muted pad-inline", children: t('emptySearch') })) : null] })] }) })) : null, filterOpen ? (_jsx("div", { className: "ig-sheet-backdrop", role: "presentation", onClick: () => setFilterOpen(false), children: _jsxs("div", { className: "ig-sheet ig-sheet-sm", role: "dialog", "aria-modal": "true", "aria-label": t('inboxFilter'), onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "ig-sheet-head", children: [_jsx("h2", { children: t('inboxFilter') }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": t('close'), onClick: () => setFilterOpen(false), children: "\u2715" })] }), _jsx("div", { className: "ig-filter-options", children: [
                                ['none', t('inboxFilterClear')],
                                ['unread', t('inboxFilterUnread')],
                                ['muted', t('inboxFilterMuted')]
                            ].map(([id, label]) => (_jsxs("button", { type: "button", className: `ig-filter-option${inboxFilter === id ? ' is-active' : ''}`, onClick: () => {
                                    setInboxFilter(id);
                                    setFilterOpen(false);
                                }, children: [label, inboxFilter === id ? _jsx(IconCheck, { size: 18 }) : null] }, id))) })] }) })) : null, _jsx("section", { className: `chat-main ${!props.peerId ? 'chat-main-empty' : ''}`, children: !props.peerId ? (_jsxs("div", { className: "empty-state chat-empty", children: [_jsx("h2", { children: t('selectConversation') }), _jsx("p", { className: "muted", children: t('selectConversationHint') }), _jsx("button", { className: "button button-compact", type: "button", onClick: props.onRefreshConversations, children: t('retry') })] })) : (_jsxs(_Fragment, { children: [_jsxs("header", { className: "chat-header wa-chat-header", children: [_jsx("button", { className: `icon-btn mobile-back${props.embedded ? ' is-always-visible' : ''}`, type: "button", "aria-label": t('back'), onClick: () => {
                                        if (props.embedded && props.onEmbeddedBack)
                                            props.onEmbeddedBack();
                                        else
                                            props.onPeerChange('');
                                    }, children: _jsx(IconBack, { size: 22 }) }), peerProfile?.browseProfileHidden ? (_jsxs("div", { className: "chat-peer-link", children: [_jsx(UserAvatar, { size: "sm", name: activePeer?.displayName, username: activePeer?.username, avatarUrl: activePeer?.avatarUrl }), _jsxs("div", { children: [_jsx("strong", { children: activePeer?.displayName || activePeer?.username || t('messages') }), _jsxs("p", { className: "muted", children: [props.onlineByUser[props.peerId] ? t('online') : '', props.typingHint ? `${props.onlineByUser[props.peerId] ? ' · ' : ''}${props.typingHint}` : ''] })] })] })) : (_jsxs(Link, { to: `/u/${activePeer?.username || props.peerId}`, className: "chat-peer-link", children: [_jsx(UserAvatar, { size: "sm", name: activePeer?.displayName, username: activePeer?.username, avatarUrl: activePeer?.avatarUrl }), _jsxs("div", { children: [_jsx("strong", { children: activePeer?.displayName || activePeer?.username }), _jsxs("p", { className: "muted", children: ["@", activePeer?.username, props.onlineByUser[props.peerId] ? ` · ${t('online')}` : '', props.typingHint ? ` · ${props.typingHint}` : ''] })] })] })), _jsxs("div", { className: "chat-header-actions", children: [props.onStartCall ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": t('audioCall'), onClick: () => props.onStartCall?.('audio'), children: _jsx(IconPhone, { size: 22 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": t('videoCall'), onClick: () => props.onStartCall?.('video'), children: _jsx(IconVideo, { size: 22 }) })] })) : null, _jsxs("div", { className: "more-wrap", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": t('more'), "aria-expanded": peerMenuOpen, onClick: () => setPeerMenuOpen((v) => !v), children: _jsx(IconMore, { size: 20 }) }), peerMenuOpen ? (_jsxs("div", { className: "more-menu peer-chat-menu", role: "menu", children: [_jsx("button", { type: "button", className: "more-menu-item", role: "menuitem", onClick: toggleMuteChat, children: mutedChats.has(props.peerId) ? t('unmute') : t('mute') }), _jsx("button", { type: "button", className: "more-menu-item danger", role: "menuitem", onClick: () => void onBlockPeer(), children: t('block') })] })) : null] })] })] }), _jsxs("div", { className: "messages wa-messages-list", ref: listRef, onScroll: onMessagesScroll, children: [props.hasMoreByPeer[props.peerId] ? (_jsx("button", { className: "button button-ghost button-compact", type: "button", onClick: () => void loadOlderPreservingScroll(), children: t('loadMore') })) : null, props.isOpeningChat ? _jsx("p", { className: "muted", children: t('loading') }) : null, peerProfile && !props.isOpeningChat && !peerProfile.browseProfileHidden ? (_jsxs("div", { className: "chat-peer-intro", children: [_jsx(UserAvatar, { size: "lg", name: peerProfile.displayName || peerProfile.username, username: peerProfile.username, avatarUrl: peerProfile.avatarUrl }), _jsx("strong", { className: "chat-peer-intro-name", children: peerProfile.displayName || peerProfile.username }), _jsxs("span", { className: "muted chat-peer-intro-user", children: ["@", peerProfile.username] }), _jsxs("p", { className: "chat-peer-intro-stats muted tiny", children: [peerProfile._count?.followers ?? 0, " ", t('followers'), " \u00B7", ' ', peerProfile._count?.posts ?? 0, " ", t('posts')] }), peerProfile.followStatus !== 'accepted' &&
                                            peerProfile.followStatus !== 'pending' &&
                                            !peerProfile.isSelf ? (_jsxs("div", { className: "chat-peer-intro-follow", children: [_jsx("p", { className: "muted tiny", children: t('chatFollowPrompt') }), _jsx("button", { type: "button", className: "button button-compact", disabled: peerFollowBusy, onClick: () => void followPeerFromChat(), children: t('follow') })] })) : null, _jsx(Link, { to: `/u/${peerProfile.username || peerProfile.id}`, className: "button button-ghost button-compact chat-peer-intro-profile", children: t('viewProfile') })] })) : null, messages.map((msg) => {
                                    const mine = msg.senderId === props.currentUserId;
                                    const meta = mediaMetaFromText(msg.encryptedContent || '');
                                    const sharePayload = parseShareContent(msg.encryptedContent || '');
                                    const replySrc = msg.replyToMessageId ? byId.get(msg.replyToMessageId) : null;
                                    const showTime = timeShownId === msg.id;
                                    const ticks = mine && !msg.isDeleted ? (_jsx("span", { className: `wa-ticks ${msg.status === 'read' ? 'is-read' : ''}`, "aria-hidden": true, children: _jsx(IconCheck, { size: 14, double: msg.status === 'delivered' || msg.status === 'read' }) })) : null;
                                    const voiceMsg = isVoiceMessage(msg);
                                    return (_jsxs("div", { className: `bubble wa-bubble ${mine ? 'sent' : 'received'}${voiceMsg ? ' is-voice' : ''}${sharePayload ? ' is-share' : ''}`, onClick: () => setTimeShownId((id) => (id === msg.id ? null : msg.id)), onContextMenu: (e) => {
                                            if (voiceMsg)
                                                return;
                                            e.preventDefault();
                                            setMsgMenuId(msg.id);
                                        }, children: [msg.isDeleted ? (_jsx("div", { className: "wa-deleted", children: t('messageDeleted') })) : (_jsxs(_Fragment, { children: [replySrc ? (_jsxs("div", { className: "wa-reply-quote", children: [_jsx("strong", { children: replySrc.senderId === props.currentUserId
                                                                    ? t('you')
                                                                    : `@${activePeer?.username || ''}` }), _jsx("span", { children: sharePreviewLabel(replySrc.encryptedContent || '', parseShareContent(replySrc.encryptedContent || '')?.targetType === 'reel'
                                                                    ? t('sharedReel')
                                                                    : t('sharedPost')) ||
                                                                    mediaMetaFromText(replySrc.encryptedContent || '').body ||
                                                                    replySrc.encryptedContent })] })) : null, (msg.mediaAttachments || []).map((att) => (_jsx(MessageAttachment, { att: att, blurred: isEphemeralLocked(msg) && (meta.mode === 'once' || meta.mode === 'timed'), onOpen: (url) => void openViewer(msg, att.mediaId, url) }, att.mediaId))), String(msg.encryptedContent || '').startsWith('[img') &&
                                                        !(msg.mediaAttachments || []).length ? (_jsx("div", { className: "wa-media-missing muted tiny", children: t('mediaMissing') })) : null, sharePayload ? (_jsx(ShareContentBubble, { payload: sharePayload, mine: mine, sentAt: msg.timestamp, showDate: showTime, onToggleDate: () => setTimeShownId((id) => (id === msg.id ? null : msg.id)), onReply: () => {
                                                            setReplyTo(msg);
                                                            focusComposer();
                                                        }, ...(mine
                                                            ? {
                                                                onDelete: () => {
                                                                    props.onDeleteMessage?.(msg.id);
                                                                }
                                                            }
                                                            : {}), onForward: () => setShareFor(msg) })) : meta.body &&
                                                        !meta.body.startsWith('[voice') &&
                                                        !msg.encryptedContent?.startsWith('[sticker]') ? (_jsx("div", { className: "wa-text", dir: "auto", children: meta.body })) : null, msg.encryptedContent?.startsWith('[sticker]') && !(msg.mediaAttachments || []).length ? (_jsx("div", { className: "sticker-text", children: msg.encryptedContent.replace('[sticker]', '').trim() })) : null, msg.encryptedContent?.startsWith('[voice') && !(msg.mediaAttachments || []).length ? (_jsx("div", { className: "wa-media-missing muted tiny", children: t('mediaMissing') })) : null] })), _jsxs("div", { className: "bubble-meta wa-meta", children: [showTime ? _jsx("span", { children: formatMsgTime(msg.timestamp, locale) }) : null, msg.editedAt ? _jsx("span", { children: t('edited') }) : null, ticks] }), msgMenuId === msg.id && !msg.isDeleted && !voiceMsg ? (_jsxs("div", { className: "wa-msg-menu", onClick: (e) => e.stopPropagation(), children: [_jsx("button", { type: "button", onClick: () => {
                                                            setReplyTo(msg);
                                                            setMsgMenuId(null);
                                                            focusComposer();
                                                        }, children: t('reply') }), mine && meta.mode === 'normal' && !msg.mediaAttachments?.length ? (_jsx("button", { type: "button", onClick: () => {
                                                            setEditing(msg);
                                                            props.onDraftChange(meta.body || msg.encryptedContent);
                                                            setMsgMenuId(null);
                                                            focusComposer();
                                                        }, children: t('edit') })) : null, mine ? (_jsx("button", { type: "button", onClick: () => {
                                                            props.onDeleteMessage?.(msg.id);
                                                            setMsgMenuId(null);
                                                        }, children: (msg.mediaAttachments || []).length ? t('deleteMedia') : t('delete') })) : null, (msg.mediaAttachments || []).length ? (_jsx("button", { type: "button", onClick: () => {
                                                            setMsgMenuId(null);
                                                            void downloadMessageMedia(msg);
                                                        }, children: t('downloadMedia') })) : null, _jsx("button", { type: "button", onClick: () => {
                                                            setShareFor(msg);
                                                            setMsgMenuId(null);
                                                        }, children: t('share') }), _jsx("button", { type: "button", onClick: () => setMsgMenuId(null), children: t('close') })] })) : null] }, msg.id));
                                }), _jsx("div", { ref: messageEndRef })] }), props.smartReplies.length > 0 && !editing ? (_jsx("div", { className: "smart-replies", children: props.smartReplies.map((s) => (_jsx("button", { type: "button", className: "smart-reply-chip", onClick: () => props.onUseSmartReply(s), children: s }, s))) })) : null, replyTo ? (_jsxs("div", { className: "wa-composer-banner", children: [_jsxs("div", { children: [_jsx("strong", { children: t('reply') }), _jsx("span", { dir: "auto", children: mediaMetaFromText(replyTo.encryptedContent || '').body || replyTo.encryptedContent })] }), _jsx("button", { type: "button", className: "icon-btn", onClick: () => setReplyTo(null), "aria-label": t('close'), children: "\u00D7" })] })) : null, editing ? (_jsxs("div", { className: "wa-composer-banner", children: [_jsxs("div", { children: [_jsx("strong", { children: t('edit') }), _jsx("span", { children: t('typeMessage') })] }), _jsx("button", { type: "button", className: "icon-btn", onClick: () => {
                                        setEditing(null);
                                        props.onDraftChange('');
                                    }, "aria-label": t('close'), children: "\u00D7" })] })) : null, stickersOpen ? (_jsx("div", { className: "sticker-studio", role: "listbox", "aria-label": t('stickers'), children: STICKERS.map((s) => (_jsx("button", { type: "button", className: "sticker-btn", onClick: () => insertSticker(s), children: s }, s))) })) : null, galleryOpen ? (_jsxs("div", { className: "gallery-sheet", children: [_jsxs("div", { className: "gallery-sheet-head", children: [_jsx("strong", { children: t('chooseFromGallery') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => {
                                                galleryItems.forEach((g) => URL.revokeObjectURL(g.url));
                                                setGalleryItems([]);
                                                setGalleryOpen(false);
                                            }, children: t('close') })] }), _jsxs("div", { className: "gallery-modes", children: [_jsx("button", { type: "button", className: `button button-compact ${sendMode === 'normal' ? '' : 'button-ghost'}`, onClick: () => setSendMode('normal'), children: t('permanent') }), _jsx("button", { type: "button", className: `button button-compact ${sendMode === 'once' ? '' : 'button-ghost'}`, onClick: () => setSendMode('once'), children: t('viewOnce') }), _jsx("button", { type: "button", className: `button button-compact ${sendMode === 'timed' ? '' : 'button-ghost'}`, onClick: () => setSendMode('timed'), children: t('viewTimed') }), sendMode === 'timed' ? (_jsxs("label", { className: "ttl-field", children: [_jsx("input", { type: "number", min: 1, max: 60, value: ttlSecs, onChange: (e) => setTtlSecs(Math.min(60, Math.max(1, Number(e.target.value) || 1))) }), _jsx("span", { children: t('seconds') })] })) : null] }), _jsxs("div", { className: "gallery-grid", children: [galleryItems.map((g) => (_jsxs("div", { className: `gallery-tile-wrap ${g.selected ? 'is-selected' : ''}`, children: [_jsxs("button", { type: "button", className: `gallery-tile ${g.selected ? 'is-selected' : ''}`, onClick: () => toggleGallerySelect(g.id), children: [_jsx("img", { src: g.url, alt: "" }), g.selected ? _jsx("span", { className: "gallery-check", children: "\u2713" }) : null] }), g.selected ? (_jsx("button", { type: "button", className: "button button-ghost button-compact gallery-crop-btn", onClick: () => setCroppingId(g.id), children: g.cropped ? t('cropOn') : t('crop') })) : null] }, g.id))), _jsx("button", { type: "button", className: "gallery-tile gallery-add", onClick: () => galleryInputRef.current?.click(), children: "+" })] }), selectedGallery.length ? (_jsx("p", { className: "muted tiny gallery-send-hint", children: t('sendWithComposerHint') })) : null] })) : null, croppingId ? ((() => {
                            const item = galleryItems.find((g) => g.id === croppingId);
                            if (!item)
                                return null;
                            return (_jsx(AvatarCrop, { variant: "free", file: item.file, onCancel: () => setCroppingId(null), onConfirm: (blob) => applyGalleryCrop(item.id, blob) }));
                        })()) : null, props.uploadProgress != null ? (_jsx("div", { className: "upload-progress", children: _jsx("div", { style: { width: `${props.uploadProgress}%` } }) })) : null, recording ? (_jsxs("div", { className: "voice-recording-bar", "aria-live": "polite", children: [_jsx("div", { className: "voice-waveform", "aria-hidden": true, children: waveBars.map((h, i) => (_jsx("span", { style: { height: `${Math.round(h * 100)}%` } }, i))) }), _jsxs("span", { className: "voice-rec-secs", children: [recordSecs, "s"] }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: cancelRecording, children: t('cancel') }), _jsx("button", { type: "button", className: "composer-send-btn", "aria-label": t('send'), onClick: () => stopRecording(true), children: _jsx(IconSendArrow, { size: 20 }) })] })) : null, pendingAudio ? (_jsxs("div", { className: "voice-preview", children: [_jsx("audio", { src: pendingAudio.url, controls: true }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": t('send'), onClick: () => void sendPendingAudio(), children: _jsx(IconSendArrow, { size: 20 }) }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: cancelRecording, children: t('cancel') })] })) : null, _jsxs("form", { className: "composer tg-composer wa-composer", onSubmit: submitComposer, children: [_jsx("input", { ref: galleryInputRef, className: "sr-only", type: "file", accept: "image/*", multiple: true, onChange: (e) => onPickGallery(e.target.files) }), _jsxs("div", { className: "composer-row", children: [typeof document !== 'undefined' &&
                                            document.querySelector('.focus-shell')?.getAttribute('data-focus-stickers') === 'off' ? null : (_jsx("button", { type: "button", className: "composer-icon-btn", "aria-label": t('stickers'), onClick: () => {
                                                setStickersOpen((v) => !v);
                                                setGalleryOpen(false);
                                            }, children: _jsx(IconSticker, { size: 22 }) })), _jsx("button", { type: "button", className: "composer-icon-btn", "aria-label": t('chooseFromGallery'), onClick: () => {
                                                setGalleryOpen(true);
                                                setStickersOpen(false);
                                                galleryInputRef.current?.click();
                                            }, children: _jsx(IconImage, { size: 22 }) }), _jsx("button", { type: "button", className: "composer-icon-btn", "aria-label": t('takePhoto'), disabled: !props.peerId, onClick: () => void openCamera(), children: _jsx(IconCamera, { size: 22 }) }), _jsx("textarea", { ref: draftInputRef, value: props.draft, onChange: (e) => props.onDraftChange(e.target.value), placeholder: t('typeMessage'), dir: "auto", lang: "ar", inputMode: "text", enterKeyHint: "send", autoComplete: "off", autoCorrect: "off", autoCapitalize: "off", spellCheck: false, rows: 1, disabled: !props.peerId, onFocus: () => {
                                                setStickersOpen(false);
                                            }, onKeyDown: (e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    submitComposer();
                                                }
                                            } }), canSendText ? (_jsxs("button", { className: "composer-send-btn", type: "submit", disabled: !props.peerId, "aria-label": t('send'), title: selectedGallery.length
                                                ? `${t('send')} (${selectedGallery.length})`
                                                : t('send'), children: [_jsx(IconSendArrow, { size: 20 }), selectedGallery.length ? (_jsx("span", { className: "composer-send-badge", children: selectedGallery.length })) : null] })) : recording ? (_jsxs("button", { type: "button", className: "composer-icon-btn mic is-recording", onClick: () => stopRecording(true), "aria-label": t('stopRecording'), children: [recordSecs, "s"] })) : (_jsx("button", { type: "button", className: "composer-icon-btn mic", "aria-label": t('recordVoice'), disabled: !props.peerId, onClick: () => void startRecording(), children: _jsx(IconMic, { size: 22 }) }))] })] })] })) }), cameraOpen ? (_jsxs("div", { className: "camera-capture-overlay", role: "dialog", "aria-modal": "true", children: [_jsxs("header", { className: "camera-capture-top", children: [_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: closeCamera, children: t('close') }), _jsx("strong", { children: t('takePhoto') }), _jsx("span", {})] }), _jsxs("div", { className: "camera-capture-stage", children: [cameraShot ? (_jsx("img", { src: cameraShot.url, alt: "", className: "camera-capture-preview" })) : (_jsx("video", { ref: cameraVideoRef, className: "camera-capture-video", playsInline: true, muted: true, autoPlay: true })), _jsx("canvas", { ref: cameraCanvasRef, className: "sr-only" })] }), _jsx("div", { className: "camera-capture-actions", children: cameraShot ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "button button-ghost", disabled: cameraBusy, onClick: () => void retakeCameraPhoto(), children: t('retakePhoto') }), _jsx("button", { type: "button", className: "button", disabled: cameraBusy, onClick: () => void sendCameraPhoto(), children: cameraBusy ? '…' : t('send') })] })) : (_jsx("button", { type: "button", className: "camera-shutter", "aria-label": t('takePhoto'), onClick: captureCameraPhoto })) })] })) : null, shareFor ? (_jsx("div", { className: "sheet-backdrop", onClick: () => (!shareBusy ? setShareFor(null) : undefined), children: _jsxs("div", { className: "sheet wa-share-sheet", onClick: (e) => e.stopPropagation(), children: [_jsx("h3", { children: t('share') }), _jsx("div", { className: "wa-share-tabs", role: "tablist", children: [
                                ['users', t('shareToUsers')],
                                ['groups', t('shareToGroups')],
                                ['channels', t('shareToChannels')]
                            ].map(([id, label]) => (_jsx("button", { type: "button", role: "tab", "aria-selected": shareTab === id, className: `button button-compact ${shareTab === id ? '' : 'button-ghost'}`, disabled: shareBusy, onClick: () => {
                                    setShareTab(id);
                                    setSharePending(null);
                                }, children: label }, id))) }), shareTab === 'users' ? (_jsx("input", { value: shareQ, onChange: (e) => setShareQ(e.target.value), placeholder: t('shareSearchHint'), dir: "auto", disabled: shareBusy })) : (_jsx("input", { value: shareQ, onChange: (e) => setShareQ(e.target.value), placeholder: t('shareSearchHint'), dir: "auto", disabled: shareBusy })), shareFeedback ? _jsx("p", { className: "wa-share-feedback", children: shareFeedback }) : null, sharePending ? (_jsxs("div", { className: "wa-share-confirm", children: [_jsxs("p", { children: [t('shareConfirmSend'), _jsx("br", {}), _jsx("strong", { children: sharePending.title })] }), _jsxs("div", { className: "wa-share-confirm-actions", children: [_jsx("button", { type: "button", className: "button button-ghost button-compact", disabled: shareBusy, onClick: () => setSharePending(null), children: t('cancel') }), _jsx("button", { type: "button", className: "button button-compact", disabled: shareBusy, onClick: () => void confirmShareSend(), children: shareBusy ? '…' : t('send') })] })] })) : null, _jsxs("div", { className: "wa-share-list", children: [shareTab === 'users'
                                    ? sharePeople.map((u) => (_jsxs("button", { type: "button", className: "list-row", disabled: shareBusy, onClick: () => setSharePending({
                                            kind: 'user',
                                            id: u.id,
                                            title: `@${u.username || u.displayName || u.id}`
                                        }), children: ["@", u.username || u.id] }, u.id)))
                                    : null, shareTab === 'groups'
                                    ? shareGroups
                                        .filter((g) => {
                                        const q = shareQ.trim().toLowerCase();
                                        if (!q)
                                            return true;
                                        return String(g.name || '').toLowerCase().includes(q);
                                    })
                                        .map((g) => (_jsx("button", { type: "button", className: "list-row", disabled: shareBusy, onClick: () => setSharePending({
                                            kind: 'group',
                                            id: g.id,
                                            title: g.name || t('groups')
                                        }), children: g.name || g.id }, g.id)))
                                    : null, shareTab === 'channels'
                                    ? shareChannels
                                        .filter((c) => {
                                        const q = shareQ.trim().toLowerCase();
                                        if (!q)
                                            return true;
                                        return String(c.name || '').toLowerCase().includes(q);
                                    })
                                        .map((c) => (_jsx("button", { type: "button", className: "list-row", disabled: shareBusy, onClick: () => setSharePending({
                                            kind: 'channel',
                                            id: c.id,
                                            title: c.name || t('channels')
                                        }), children: c.name || c.id }, c.id)))
                                    : null] }), _jsx("button", { type: "button", className: "button button-ghost button-compact", disabled: shareBusy, onClick: () => setShareFor(null), children: t('close') })] }) })) : null, viewer ? (_jsxs("div", { className: "ephemeral-viewer album-viewer", role: "dialog", "aria-modal": "true", children: [_jsxs("div", { className: "ephemeral-viewer-bar", children: [_jsxs("div", { className: "album-viewer-meta", children: [viewer.mode === 'timed' ? _jsxs("span", { children: [viewerLeft, "s"] }) : null, viewer.items.length > 1 ? (_jsxs("span", { children: [viewer.index + 1, "/", viewer.items.length] })) : null] }), _jsxs("div", { className: "album-viewer-actions", children: [viewer.mode === 'normal' ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => {
                                                    const cur = viewer.items[viewer.index];
                                                    if (cur)
                                                        void downloadUrl(cur.url, `chat-${cur.mediaId}.jpg`);
                                                }, children: t('saveCurrent') }), viewer.items.length > 1 ? (_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => {
                                                    void (async () => {
                                                        for (let i = 0; i < viewer.items.length; i++) {
                                                            const it = viewer.items[i];
                                                            if (!it)
                                                                continue;
                                                            await downloadUrl(it.url, `chat-${it.mediaId}-${i + 1}.jpg`);
                                                        }
                                                    })();
                                                }, children: t('saveAll') })) : null] })) : null, _jsx("button", { type: "button", className: "icon-btn", onClick: () => closeViewer(viewer.mode === 'once'), "aria-label": t('close'), children: "\u00D7" })] })] }), _jsxs("div", { className: "album-viewer-stage", children: [viewer.items.length > 1 ? (_jsx("button", { type: "button", className: "album-nav album-nav-prev", "aria-label": t('back'), disabled: viewer.index <= 0, onClick: () => setViewer((v) => (v ? { ...v, index: Math.max(0, v.index - 1) } : v)), children: "\u2039" })) : null, _jsx("img", { src: viewer.items[viewer.index]?.url, alt: "" }), viewer.items.length > 1 ? (_jsx("button", { type: "button", className: "album-nav album-nav-next", "aria-label": t('loadMore'), disabled: viewer.index >= viewer.items.length - 1, onClick: () => setViewer((v) => (v ? { ...v, index: Math.min(v.items.length - 1, v.index + 1) } : v)), children: "\u203A" })) : null] }), viewer.items.length > 1 ? (_jsx("div", { className: "album-thumbs", children: viewer.items.map((it, i) => (_jsx("button", { type: "button", className: `album-thumb ${i === viewer.index ? 'is-active' : ''}`, onClick: () => setViewer((v) => (v ? { ...v, index: i } : v)), children: _jsx("img", { src: it.url, alt: "" }) }, it.mediaId))) })) : null] })) : null] }));
}
function MessageAttachment({ att, blurred, onOpen }) {
    const { t } = useI18n();
    const { session } = useAuth();
    const [url, setUrl] = useState(null);
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
                if (!alive)
                    return;
                if (!canAutoDownloadMedia(session?.user?.id)) {
                    setBlockedAuto(true);
                    return;
                }
                void fetchMediaUrl(att.mediaId)
                    .then((r) => {
                    if (!alive)
                        return;
                    const next = resolveMediaUrl(r.secureUrl);
                    if (next) {
                        setUrl(next);
                        recordDataUsage(session?.user?.id, 'in', 64 * 1024);
                        void import('./focus/focusPrefs').then(({ loadStoragePrefs }) => {
                            const sp = loadStoragePrefs(session?.user?.id);
                            if (!sp.saveGalleryPrivate)
                                return;
                            const a = document.createElement('a');
                            a.href = next;
                            a.download = `securechat-${att.mediaId}`;
                            a.rel = 'noopener';
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                        });
                    }
                    else
                        setFailed(true);
                })
                    .catch(() => {
                    if (alive)
                        setFailed(true);
                });
            });
            return () => {
                alive = false;
            };
        }
        void fetchMediaUrl(att.mediaId)
            .then((r) => {
            if (!alive)
                return;
            const next = resolveMediaUrl(r.secureUrl);
            if (next)
                setUrl(next);
            else
                setFailed(true);
        })
            .catch(() => {
            if (alive)
                setFailed(true);
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
            }
            else
                setFailed(true);
        }
        catch {
            setFailed(true);
        }
    }
    if (blockedAuto && !url) {
        return (_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => void loadManually(), children: t('downloadMedia') }));
    }
    if (isAudio) {
        if (failed && !url) {
            return _jsx("div", { className: "wa-media-missing muted tiny", children: t('mediaMissing') });
        }
        if (!url) {
            return _jsx("div", { className: "wa-voice-loading", "aria-hidden": true });
        }
        return (_jsx("div", { className: "wa-voice-player", children: _jsx("audio", { controls: true, preload: "metadata", src: url, className: "bubble-audio" }) }));
    }
    if (failed && !url) {
        return _jsx("div", { className: "wa-media-missing muted tiny", children: t('mediaMissing') });
    }
    if (!url) {
        return (_jsx("div", { className: "wa-chat-img-loading", "aria-hidden": true, children: _jsx("span", { className: "shimmer" }) }));
    }
    if (blurred) {
        return (_jsxs("button", { type: "button", className: "wa-ephemeral-thumb", onClick: () => onOpen?.(url), children: [_jsx("img", { src: url, alt: "", className: "wa-chat-img" }), _jsx("span", { className: "wa-ephemeral-lock", children: "\u25CC" })] }));
    }
    if (isVideo) {
        return (_jsx("div", { className: "wa-media-open", children: _jsx("video", { src: url, controls: true, playsInline: true, className: "wa-chat-img", preload: "metadata" }) }));
    }
    return (_jsx("button", { type: "button", className: "wa-media-open", onClick: () => onOpen?.(url), children: _jsx("img", { src: url, alt: "", className: "wa-chat-img", loading: "eager", onError: () => setFailed(true) }) }));
}
