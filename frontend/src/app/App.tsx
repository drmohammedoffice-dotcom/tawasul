import { FormEvent, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import {
  getConversation,
  getSmartReplies,
  listConversations,
  login,
  register,
  verifyMfaLogin,
  submitFeedback,
  type ConversationSummary
} from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { getOrCreateDeviceId } from '@/lib/session';
import { trackEvent } from '@/lib/analytics';
import { getRealtimeSocket } from '@/lib/realtime';
import { consumePendingDmPeer } from '@/lib/pushClient';
import type { PrivateMessage } from '@/types/api';
import './styles.css';
import { CallOverlay, type IncomingCall } from './calls/CallOverlay';
import { notifyFocusMessage } from './focus/focusNotify';

function messagingSpace(): 'browse' | 'focus' {
  return window.location.pathname.startsWith('/focus') ? 'focus' : 'browse';
}

const AuthScreen = lazy(() => import('./AuthScreen'));
const ChatScreen = lazy(() => import('./ChatScreen'));
const LandingPage = lazy(() => import('./LandingPage'));
const FeedbackWidget = lazy(() => import('./FeedbackWidget'));
const OnboardingModal = lazy(() => import('./OnboardingModal'));
const PAGE_SIZE = 30;
const ONBOARDING_KEY = 'onboarding-v1-complete';

type ActiveCallState = {
  callId: string;
  kind: 'audio' | 'video';
  peerUserId: string;
  peerLabel: string;
  role: 'caller' | 'callee';
  status: 'ringing' | 'connecting' | 'connected' | 'ended' | 'failed';
};

type AppProps = {
  /** When set (Focus DM), open this peer thread and hide the inbox list. */
  embeddedPeerId?: string;
  onEmbeddedBack?: () => void;
};

export function App({ embeddedPeerId, onEmbeddedBack }: AppProps = {}) {
  const { session, setSession, logout: authLogout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const chatSpace = location.pathname.startsWith('/focus') ? 'focus' : 'browse';
  const isEmbedded = Boolean(embeddedPeerId);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = window.localStorage.getItem('chat-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [isLandingMode, setIsLandingMode] = useState(true);
  const [peerId, setPeerId] = useState('');
  const [draft, setDraft] = useState('');
  const [typingHint, setTypingHint] = useState('');
  const [messagesByPeer, setMessagesByPeer] = useState<Record<string, PrivateMessage[]>>({});
  const [hasMoreByPeer, setHasMoreByPeer] = useState<Record<string, boolean>>({});
  const [onlineByUser, setOnlineByUser] = useState<Record<string, boolean>>({});
  const [authError, setAuthError] = useState('');
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [smartRepliesByPeer, setSmartRepliesByPeer] = useState<Record<string, string[]>>({});
  const [smartReplyLoading, setSmartReplyLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationsError, setConversationsError] = useState('');
  const [peerMeta, setPeerMeta] = useState<
    Record<string, { username?: string; displayName?: string | null; avatarUrl?: string | null }>
  >({});
  const [reconnecting, setReconnecting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const typingTimeout = useRef<number | null>(null);
  const activePeerRef = useRef('');
  const conversationLoadedAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    activePeerRef.current = peerId.trim();
  }, [peerId]);

  useEffect(() => {
    const pending = consumePendingDmPeer();
    if (pending) setPeerId(pending);
  }, []);

  useEffect(() => {
    if (!session || !peerId.trim()) return;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const peer = activePeerRef.current;
      if (!peer) return;
      markInboundRead(peer, messagesByPeer[peer] ?? []);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, peerId, messagesByPeer]);

  async function refreshConversations() {
    if (!session) return;
    setConversationsLoading(true);
    setConversationsError('');
    try {
      const rows = await listConversations(session.accessToken, messagingSpace());
      setConversations(rows);
      setPeerMeta((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          next[row.peer.id] = { username: row.peer.username, displayName: row.peer.displayName };
        }
        return next;
      });
    } catch (err) {
      setConversationsError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setConversationsLoading(false);
    }
  }

  useEffect(() => {
    if (!session) return;
    // Separate Focus vs Browse conversation caches when switching modes.
    setMessagesByPeer({});
    conversationLoadedAtRef.current = {};
    setPeerId('');
    void refreshConversations().finally(() => {
      if (embeddedPeerId) void openChat(embeddedPeerId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, chatSpace]);

  useEffect(() => {
    if (!session || !embeddedPeerId) return;
    void openChat(embeddedPeerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embeddedPeerId, session?.accessToken]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('chat-theme', theme);
  }, [theme]);

  useEffect(() => {
    trackEvent('app_loaded');
  }, []);

  useEffect(() => {
    // Nested under SocialRoot — skip legacy chat landing onboarding.
    window.localStorage.setItem(ONBOARDING_KEY, 'true');
    setOnboardingOpen(false);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const socket = getRealtimeSocket();
    if (!socket) return;
    socketRef.current = socket;

    const onMessageNew = (msg: PrivateMessage & { appSpace?: string }) => {
      const space = messagingSpace();
      if ((msg.appSpace || 'browse') !== space) return;
      const peer = msg.senderId === session.user.id ? msg.receiverId : msg.senderId;
      setMessagesByPeer((prev) => {
        const current = prev[peer] ?? [];
        if (current.some((existing) => existing.id === msg.id)) {
          return prev;
        }
        return { ...prev, [peer]: [...current, msg] };
      });
      void refreshConversations();
      if (msg.receiverId === session.user.id) {
        const viewingPeer =
          activePeerRef.current === msg.senderId &&
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible';
        if (viewingPeer) {
          socket.emit('message:read', { messageId: msg.id });
        } else if (messagingSpace() === 'focus') {
          const preview = (msg.encryptedContent || '').slice(0, 80);
          notifyFocusMessage({
            userId: session.user.id,
            kind: 'private',
            title: 'SecureChat',
            body: preview.startsWith('[') ? '📎' : preview || '•',
            silent: false,
            tag: `dm-${msg.senderId}`
          });
        }
      }
    };

    const onMessageUpdate = (msg: PrivateMessage) => {
      const peer = msg.senderId === session.user.id ? msg.receiverId : msg.senderId;
      setMessagesByPeer((prev) => ({
        ...prev,
        [peer]: (prev[peer] ?? []).map((item) => (item.id === msg.id ? { ...item, ...msg } : item))
      }));
    };

    const onMessageDelete = (msg: PrivateMessage) => {
      const peer = msg.senderId === session.user.id ? msg.receiverId : msg.senderId;
      setMessagesByPeer((prev) => ({
        ...prev,
        [peer]: (prev[peer] ?? []).map((item) =>
          item.id === msg.id ? { ...item, ...msg, isDeleted: true } : item
        )
      }));
    };

    const onPresence = (event: { userId: string; status: 'online' | 'offline' }) => {
      setOnlineByUser((prev) => ({ ...prev, [event.userId]: event.status === 'online' }));
    };

    const onTyping = (event: { senderId: string; receiverId: string; isTyping: boolean }) => {
      if (event.senderId === activePeerRef.current && event.receiverId === session.user.id) {
        setTypingHint(event.isTyping ? 'typing...' : '');
      }
    };

    const onCallIncoming = (payload: IncomingCall) => setIncomingCall(payload);
    const onCallAccepted = (payload: { callId: string }) => {
      setActiveCall((prev) =>
        prev && prev.callId === payload.callId ? { ...prev, status: 'connecting' } : prev
      );
    };
    const onCallEnded = (payload: { callId: string }) => {
      setActiveCall((prev) => (prev && prev.callId === payload.callId ? null : prev));
      setIncomingCall((prev) => (prev && prev.callId === payload.callId ? null : prev));
    };
    const onReconnectAttempt = () => setReconnecting(true);
    const onReconnect = () => setReconnecting(false);
    const onConnect = () => setReconnecting(false);
    const onDisconnect = () => setReconnecting(true);

    socket.on('message:new', onMessageNew);
    socket.on('message:update', onMessageUpdate);
    socket.on('message:delete', onMessageDelete);
    socket.on('presence:updated', onPresence);
    socket.on('user:typing', onTyping);
    socket.on('call:incoming', onCallIncoming);
    socket.on('call:accepted', onCallAccepted);
    socket.on('call:ended', onCallEnded);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect', onReconnect);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('message:new', onMessageNew);
      socket.off('message:update', onMessageUpdate);
      socket.off('message:delete', onMessageDelete);
      socket.off('presence:updated', onPresence);
      socket.off('user:typing', onTyping);
      socket.off('call:incoming', onCallIncoming);
      socket.off('call:accepted', onCallAccepted);
      socket.off('call:ended', onCallEnded);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect', onReconnect);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socketRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const targetPeer = peerId.trim();
    if (!targetPeer) {
      setSmartRepliesByPeer({});
      return;
    }

    const activeConversation = messagesByPeer[targetPeer] ?? [];
    if (activeConversation.length === 0) return;
    const inboundLatest = [...activeConversation]
      .reverse()
      .find((item) => item.senderId === targetPeer && !item.isDeleted);
    if (!inboundLatest?.encryptedContent) return;
    if (draft.trim()) return;

    let canceled = false;
    const timer = window.setTimeout(async () => {
      setSmartReplyLoading(true);
      try {
        const recentMessages = activeConversation
          .slice(-8)
          .filter((item) => !item.isDeleted)
          .map((item) =>
            `${item.senderId === session.user.id ? 'me' : 'peer'}: ${item.encryptedContent}`
          );
        const result = await getSmartReplies(session.accessToken, {
          latestMessage: inboundLatest.encryptedContent,
          recentMessages,
          maxSuggestions: 3
        });
        if (canceled) return;
        setSmartRepliesByPeer((prev) => ({ ...prev, [targetPeer]: result.suggestions }));
      } catch {
        if (canceled) return;
        setSmartRepliesByPeer((prev) => ({ ...prev, [targetPeer]: [] }));
      } finally {
        if (!canceled) {
          setSmartReplyLoading(false);
        }
      }
    }, 280);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [session, peerId, messagesByPeer, draft]);

  function markInboundRead(peer: string, list: PrivateMessage[]) {
    const socket = socketRef.current;
    if (!session || !socket || !peer) return;
    for (const msg of list) {
      if (
        msg.receiverId === session.user.id &&
        msg.senderId === peer &&
        !msg.isDeleted &&
        msg.status !== 'read'
      ) {
        socket.emit('message:read', { messageId: msg.id });
      }
    }
  }

  async function openChat(targetPeerId?: string) {
    const resolvedPeer = (targetPeerId ?? peerId).trim();
    if (!session || !resolvedPeer) return;
    const lastLoaded = conversationLoadedAtRef.current[resolvedPeer] ?? 0;
    if (Date.now() - lastLoaded < 20_000 && messagesByPeer[resolvedPeer]?.length) {
      setPeerId(resolvedPeer);
      markInboundRead(resolvedPeer, messagesByPeer[resolvedPeer] ?? []);
      return;
    }
    setIsOpeningChat(true);
    setTypingHint('');
    setPeerId(resolvedPeer);
    try {
      const list = await getConversation(session.accessToken, resolvedPeer, {
        limit: PAGE_SIZE,
        space: messagingSpace()
      });
      setMessagesByPeer((prev) => ({ ...prev, [resolvedPeer]: list }));
      setHasMoreByPeer((prev) => ({ ...prev, [resolvedPeer]: list.length >= PAGE_SIZE }));
      conversationLoadedAtRef.current[resolvedPeer] = Date.now();
      markInboundRead(resolvedPeer, list);
      trackEvent('chat_opened', { peerId: resolvedPeer, messageCount: list.length });
    } finally {
      setIsOpeningChat(false);
    }
  }

  // Open DM directly from profile Message button (?peer=userId)
  useEffect(() => {
    if (!session) return;
    const peer = searchParams.get('peer')?.trim();
    if (!peer) return;
    void openChat(peer).finally(() => {
      const next = new URLSearchParams(searchParams);
      next.delete('peer');
      setSearchParams(next, { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, searchParams.get('peer')]);

  function sendMessage(opts?: {
    mediaIds?: string[];
    text?: string;
    replyToMessageId?: string;
    forwardFromMessageId?: string;
    toUserId?: string;
  }) {
    if (!session) return;
    const target = (opts?.toUserId || peerId).trim();
    if (!target) return;
    const text = (opts?.text ?? draft).trim();
    const mediaIds = opts?.mediaIds;
    if (!text && !(mediaIds && mediaIds.length)) return;
    const payload = {
      receiverId: target,
      encryptedContent: text || '[media]',
      appSpace: messagingSpace(),
      ...(mediaIds?.length ? { mediaIds } : {}),
      ...(opts?.replyToMessageId ? { replyToMessageId: opts.replyToMessageId } : {}),
      ...(opts?.forwardFromMessageId ? { forwardFromMessageId: opts.forwardFromMessageId } : {})
    };
    socketRef.current?.emit(
      'message:send',
      payload,
      (ack?: { success?: boolean; message?: string; data?: PrivateMessage }) => {
        if (!ack) return;
        if (ack.success === false) {
          setConversationsError(ack.message || 'Send failed');
          return;
        }
        // Ensure media-bearing messages appear even if pub/sub is delayed
        if (ack.data?.id) {
          const msg = ack.data;
          const peer = msg.senderId === session.user.id ? msg.receiverId : msg.senderId;
          setMessagesByPeer((prev) => {
            const current = prev[peer] ?? [];
            if (current.some((m) => m.id === msg.id)) {
              return {
                ...prev,
                [peer]: current.map((m) => (m.id === msg.id ? { ...m, ...msg } : m))
              };
            }
            return { ...prev, [peer]: [...current, msg] };
          });
        }
      }
    );
    // Clear composer after any explicit send (text and/or media), except forwards to another user.
    if (!opts?.toUserId) setDraft('');
    trackEvent('message_sent', { peerId: target });
    socketRef.current?.emit('user:typing', { receiverId: target, isTyping: false });
  }

  function editMessage(messageId: string, encryptedContent: string) {
    socketRef.current?.emit('message:edit', { messageId, encryptedContent });
  }

  function deleteMessage(messageId: string) {
    socketRef.current?.emit('message:delete', { messageId });
  }

  async function loadOlderMessages() {
    if (!session || !peerId.trim()) return;
    const existing = messagesByPeer[peerId] ?? [];
    if (existing.length === 0) return;
    const oldest = existing[0];
    if (!oldest) return;
    const older = await getConversation(session.accessToken, peerId.trim(), {
      before: oldest.timestamp,
      limit: PAGE_SIZE,
      space: messagingSpace()
    });
    setMessagesByPeer((prev) => ({
      ...prev,
      [peerId]: [...older, ...(prev[peerId] ?? [])]
    }));
    setHasMoreByPeer((prev) => ({ ...prev, [peerId]: older.length >= PAGE_SIZE }));
  }

  function handleTyping(text: string) {
    setDraft(text);
    if (!peerId.trim()) return;
    socketRef.current?.emit('user:typing', { receiverId: peerId.trim(), isTyping: true });
    if (typingTimeout.current) {
      window.clearTimeout(typingTimeout.current);
    }
    typingTimeout.current = window.setTimeout(() => {
      socketRef.current?.emit('user:typing', { receiverId: peerId.trim(), isTyping: false });
    }, 1200);
  }

  function useSmartReply(suggestion: string) {
    setDraft(suggestion);
    trackEvent('smart_reply_used', { peerId: peerId.trim() });
    if (!peerId.trim()) return;
    socketRef.current?.emit('user:typing', { receiverId: peerId.trim(), isTyping: true });
  }

  function selectChat(id: string) {
    const next = id.trim();
    if (!next) return;
    setPeerId(next);
    if (!messagesByPeer[next]) {
      void openChat(next);
    }
  }

  async function submitAuth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setAuthError('');
    try {
      if (mfaToken) {
        const code = String(form.get('mfaCode') ?? mfaCode).trim();
        if (code.length < 6) {
          setAuthError('Enter your authenticator or recovery code.');
          return;
        }
        const payload = await verifyMfaLogin({ mfaToken, code, deviceId });
        setMfaToken(null);
        setMfaCode('');
        setSession(payload);
        setIsLandingMode(false);
        trackEvent('auth_success', { mode: 'mfa' });
        return;
      }
      const username = String(form.get('username') ?? '').trim();
      const password = String(form.get('password') ?? '');
      if (!username || !password) {
        setAuthError('Enter a username and password.');
        return;
      }
      if (authMode === 'register') {
        if (username.length < 1 || username.length > 30) {
          setAuthError('Username must be 1–30 characters.');
          return;
        }
        if (!/^[a-zA-Z0-9._]+$/.test(username)) {
          setAuthError('Username can only use letters, numbers, dot, and underscore (_).');
          return;
        }
        if (password.length < 8) {
          setAuthError('Password must be at least 8 characters.');
          return;
        }
        const payload = await register({ username, password, deviceId });
        setSession(payload);
      } else {
        if (password.length < 8) {
          setAuthError('Password must be at least 8 characters.');
          return;
        }
        const result = await login({ identifier: username, password, deviceId });
        if ('requiresMfa' in result && result.requiresMfa) {
          setMfaToken(result.mfaToken);
          return;
        }
        setSession(result);
      }
      setIsLandingMode(false);
      trackEvent('auth_success', { mode: authMode });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setAuthError(message || 'Authentication failed. Check credentials and try again.');
    }
  }

  async function logout() {
    await authLogout();
    setMessagesByPeer({});
    setPeerId('');
    setIsLandingMode(true);
  }

  function startOnboarding() {
    setIsLandingMode(false);
    setAuthMode('register');
    trackEvent('landing_get_started_click');
  }

  function nextOnboardingStep() {
    if (onboardingStep >= 2) {
      window.localStorage.setItem(ONBOARDING_KEY, 'true');
      setOnboardingOpen(false);
      trackEvent('onboarding_completed');
      return;
    }
    setOnboardingStep((step) => step + 1);
  }

  function skipOnboarding() {
    window.localStorage.setItem(ONBOARDING_KEY, 'true');
    setOnboardingOpen(false);
    trackEvent('onboarding_skipped');
  }

  async function handleFeedback(input: {
    email?: string;
    category: string;
    message: string;
    rating?: number;
  }) {
    await submitFeedback(session?.accessToken ?? null, input);
    trackEvent('feedback_submitted', { category: input.category, rating: input.rating ?? null });
  }

  if (!session) {
    if (isLandingMode) {
      return (
        <Suspense fallback={<div className="auth-wrap"><p className="muted">Loading...</p></div>}>
          <LandingPage
            theme={theme}
            onStart={startOnboarding}
            onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          />
          <FeedbackWidget
            open={showFeedback}
            authenticated={false}
            onToggle={() => setShowFeedback((v) => !v)}
            onSubmit={handleFeedback}
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<div className="auth-wrap"><p className="muted">Loading...</p></div>}>
        <AuthScreen
          theme={theme}
          authMode={authMode}
          authError={authError}
          mfaRequired={Boolean(mfaToken)}
          onSubmit={submitAuth}
          onCancelMfa={() => {
            setMfaToken(null);
            setMfaCode('');
            setAuthError('');
          }}
          onToggleMode={() => {
            setMfaToken(null);
            setAuthMode((m) => (m === 'login' ? 'register' : 'login'));
          }}
          onBackToLanding={() => setIsLandingMode(true)}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        />
        <FeedbackWidget
          open={showFeedback}
          authenticated={false}
          onToggle={() => setShowFeedback((v) => !v)}
          onSubmit={handleFeedback}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="auth-wrap"><p className="muted">Loading...</p></div>}>
      <ChatScreen
        username={session.user.username}
        userRole={session.user.role ?? 'free'}
        theme={theme}
        isOpeningChat={isOpeningChat}
        currentUserId={session.user.id}
        peerId={peerId || embeddedPeerId || ''}
        draft={draft}
        typingHint={typingHint}
        onlineByUser={onlineByUser}
        messagesByPeer={messagesByPeer}
        conversations={conversations}
        conversationsLoading={conversationsLoading}
        conversationsError={conversationsError}
        peerMeta={peerMeta}
        hasMoreByPeer={hasMoreByPeer}
        smartReplies={smartRepliesByPeer[peerId || embeddedPeerId || ''] ?? []}
        smartReplyLoading={smartReplyLoading}
        {...(isEmbedded
          ? { embedded: true as const, ...(onEmbeddedBack ? { onEmbeddedBack } : {}) }
          : {})}
        onPeerChange={(id) => {
          if (!id && isEmbedded && onEmbeddedBack) {
            onEmbeddedBack();
            return;
          }
          setPeerId(id);
        }}
        onOpenChat={openChat}
        onSelectChat={selectChat}
        onDraftChange={handleTyping}
        onUseSmartReply={useSmartReply}
        onSend={sendMessage}
        onEditMessage={editMessage}
        onDeleteMessage={deleteMessage}
        onLoadOlder={loadOlderMessages}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onRefreshConversations={() => void refreshConversations()}
        uploadProgress={uploadProgress}
        reconnecting={reconnecting}
        socket={socketRef.current}
        onStartCall={(kind) => {
          const target = (peerId || embeddedPeerId || '').trim();
          if (!target || !socketRef.current) return;
          const peer =
            conversations.find((c) => c.peer.id === target)?.peer ||
            ({
              id: target,
              username: peerMeta[target]?.username || target.slice(0, 8),
              displayName: peerMeta[target]?.displayName
            } as ConversationSummary['peer']);
          socketRef.current.emit(
            'call:invite',
            { peerUserId: target, kind, scope: 'dm' },
            (ack: { success?: boolean; data?: { id: string } }) => {
              if (!ack?.data?.id) return;
              setActiveCall({
                callId: ack.data.id,
                kind,
                peerUserId: target,
                peerLabel: peer.displayName || peer.username,
                role: 'caller',
                status: 'connecting'
              });
            }
          );
        }}
      />
      <CallOverlay
        socket={socketRef.current}
        currentUserId={session.user.id}
        incoming={incomingCall}
        active={activeCall}
        onClearIncoming={() => setIncomingCall(null)}
        onActiveChange={setActiveCall}
      />
      {!isEmbedded ? (
        <>
          <OnboardingModal
            isOpen={onboardingOpen}
            step={onboardingStep}
            onNext={nextOnboardingStep}
            onSkip={skipOnboarding}
          />
          <FeedbackWidget
            open={showFeedback}
            authenticated={true}
            onToggle={() => setShowFeedback((v) => !v)}
            onSubmit={handleFeedback}
          />
        </>
      ) : null}
    </Suspense>
  );
}
