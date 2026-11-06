import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  createReelComment,
  deleteReelComment,
  fetchReel,
  fetchReelComments,
  fetchReelsFeed,
  likeReel,
  resolveMediaUrl,
  unlikeReel,
  viewReel
} from '@/api/social';
import { recommendationEventId, trackRecommendation } from '@/lib/recommendationEvents';
import {
  archiveReel,
  recordContentSignal,
  requestDownloadUrl,
  setReelCommentsDisabled
} from '@/api/content';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { loadSavedReels, persistSavedReels } from '@/lib/savedReels';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import {
  IconBookmark,
  IconComment,
  IconHeart,
  IconMore,
  IconMute,
  IconScreenRotate,
  IconSend,
  IconVolume
} from '../ui/Icons';
import { CommentThread } from '../ui/CommentThread';
import { ContentEditModal } from '../ui/ContentEditModal';
import { SharePeoplePanel } from '../ui/SharePeoplePanel';
import { UserAvatar } from '../ui/UserAvatar';
import { useToast } from '../ui/Toast';

const REEL_STICKERS = ['🔥', '😂', '❤️', '👏', '😮', '😍', '💯', '✨'];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function ReelsPage() {
  const { t } = useI18n();
  const { push } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusReelId = searchParams.get('id');
  const me = getSessionSnapshot()?.user?.id;
  const [items, setItems] = useState<any[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ bottom: number; left: number } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [bursts, setBursts] = useState<Array<{ id: number; emoji: string }>>([]);
  const [saved, setSaved] = useState<Set<string>>(() => loadSavedReels());
  /** One sticker-comment per reel per user — maps reelId → commentId */
  const stickerCommentIds = useRef<Map<string, string>>(new Map());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const viewed = useRef<Set<string>>(new Set());
  const touchY = useRef<number | null>(null);
  const lastTap = useRef(0);
  const burstId = useRef(0);
  const longPressTimer = useRef<number | null>(null);
  const wasPlayingBeforeScrub = useRef(false);
  const scrubbingRef = useRef(false);
  const rateBeforeBoost = useRef(1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchReelsFeed();
        let list = Array.isArray(data) ? data : [];
        if (focusReelId) {
          const existing = list.findIndex((r) => r.id === focusReelId);
          if (existing >= 0) {
            const focused = list[existing];
            list = [focused, ...list.filter((r) => r.id !== focusReelId)];
          } else {
            try {
              const one = await fetchReel(focusReelId);
              if (one?.id) list = [one, ...list.filter((r) => r.id !== one.id)];
            } catch {
              /* keep feed */
            }
          }
        }
        if (!cancelled) {
          setItems(list);
          setIndex(0);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('errorGeneric'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
    };
  }, [t, focusReelId]);

  useEffect(() => {
    if (!menuOpen || !menuBtnRef.current) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const r = menuBtnRef.current?.getBoundingClientRect();
      if (!r) return;
      const menuW = 200;
      /* Open to the RIGHT of the ⋯ button (flipped from previous left placement) */
      const preferred = r.right + 10;
      const clamped = Math.min(preferred, window.innerWidth - menuW - 8);
      setMenuPos({
        bottom: Math.max(8, window.innerHeight - r.bottom),
        left: Math.max(8, clamped)
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: Event) => {
      const target = e.target as Node | null;
      if (menuBtnRef.current?.contains(target)) return;
      const menuEl = document.querySelector('.reel-menu-portal');
      if (menuEl?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [menuOpen]);

  const active = items[index];
  const next = items[index + 1];

  useEffect(() => {
    setCaptionOpen(false);
    setStickersOpen(false);
    setMenuOpen(false);
    setCommentsOpen(false);
    setShareOpen(false);
    setReplyToId(null);
    setCommentDraft('');
  }, [active?.id]);

  useEffect(() => {
    setRotationDeg(0);
  }, [active?.id]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !active) return;
    setMediaError('');
    setProgress(0);
    setDurationSec(0);
    setPlaying(false);
    el.pause();
    if (!active.playable || !active.media?.secureUrl) return;
    const nextUrl = resolveMediaUrl(active.media.secureUrl);
    if (!nextUrl) return;
    el.src = nextUrl;
    el.muted = muted;
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    if (!viewed.current.has(active.id)) {
      viewed.current.add(active.id);
      trackRecommendation({
        eventId: recommendationEventId('imp', active.id),
        eventType: 'impression',
        contentType: 'reel',
        contentId: active.id,
        surface: 'reels'
      });
      void viewReel(active.id)
        .then(() => {
          setItems((prev) =>
            prev.map((r) => (r.id === active.id ? { ...r, viewCount: (r.viewCount ?? 0) + 1 } : r))
          );
        })
        .catch(() => undefined);
    }
    let qualifiedSent = false;
    let playbackStarted = false;
    const sendQualified = () => {
      if (qualifiedSent || !playbackStarted) return;
      const current = el.currentTime || 0;
      if (current < 2) return;
      qualifiedSent = true;
      trackRecommendation({
        eventId: recommendationEventId('qv', active.id),
        eventType: 'qualified_view',
        contentType: 'reel',
        contentId: active.id,
        surface: 'reels',
        dwellMs: Math.min(180000, Math.round(current * 1000))
      });
    };
    const onTime = () => {
      if (scrubbingRef.current) return;
      const current = el.currentTime || 0;
      setProgress(current);
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      if (duration > 0 && current / duration >= 0.9) {
        trackRecommendation({
          eventId: recommendationEventId('done', active.id),
          eventType: 'video_complete',
          contentType: 'reel',
          contentId: active.id,
          surface: 'reels',
          dwellMs: Math.min(180000, Math.round(current * 1000)),
          progress: Math.min(1, current / duration)
        });
      }
    };
    const onMeta = () => setDurationSec(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => {
      setPlaying(true);
      if (playbackStarted) return;
      playbackStarted = true;
      trackRecommendation({
        eventId: recommendationEventId('start', active.id),
        eventType: 'video_start',
        contentType: 'reel',
        contentId: active.id,
        surface: 'reels'
      });
    };
    const onPause = () => {
      setPlaying(false);
      sendQualified();
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    return () => {
      const current = el.currentTime || 0;
      if (playbackStarted && current < 2) {
        trackRecommendation({
          eventId: recommendationEventId('skip', active.id),
          eventType: 'video_skip',
          contentType: 'reel',
          contentId: active.id,
          surface: 'reels',
          dwellMs: Math.min(180000, Math.round(current * 1000))
        });
      } else {
        sendQualified();
      }
      el.pause();
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
    };
    // Intentionally not depending on `muted` — toggling mute must not reload src (resets seek).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (!next?.playable || !next.media?.secureUrl) return;
    const url = resolveMediaUrl(next.media.secureUrl);
    if (!url) return;
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'video';
    link.href = url;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [next?.id]);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(items.length - 1, 0)));
    },
    [items.length]
  );

  async function loadComments(reelId: string) {
    setCommentsBusy(true);
    try {
      const rows = await fetchReelComments(reelId);
      const list = Array.isArray(rows) ? rows : [];
      setComments(list);
      if (me) {
        const mineSticker = list.find(
          (c) => c.authorId === me && String(c.body || '').startsWith('[sticker]') && !c.parentId
        );
        if (mineSticker) stickerCommentIds.current.set(reelId, mineSticker.id);
        else stickerCommentIds.current.delete(reelId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
      setComments([]);
    } finally {
      setCommentsBusy(false);
    }
  }

  async function submitComment(text?: string, parentId?: string | null) {
    const body = (text ?? commentDraft).trim();
    if (!active || !body || commentsBusy || active.commentsDisabled) return;
    setCommentsBusy(true);
    try {
      const created = await createReelComment(active.id, body, parentId || undefined);
      setComments((list) => [...list, created]);
      if (!text) {
        setCommentDraft('');
        setReplyToId(null);
      }
      setItems((list) =>
        list.map((r) =>
          r.id === active.id
            ? { ...r, _count: { ...r._count, comments: (r._count?.comments ?? 0) + 1 } }
            : r
        )
      );
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
      return null;
    } finally {
      setCommentsBusy(false);
    }
  }

  async function removeComment(commentId: string) {
    if (!active || commentsBusy) return;
    setCommentsBusy(true);
    try {
      await deleteReelComment(active.id, commentId);
      setComments((list) => list.filter((c) => c.id !== commentId && c.parentId !== commentId));
      if (stickerCommentIds.current.get(active.id) === commentId) {
        stickerCommentIds.current.delete(active.id);
      }
      setItems((list) =>
        list.map((r) =>
          r.id === active.id
            ? {
                ...r,
                _count: { ...r._count, comments: Math.max(0, (r._count?.comments ?? 1) - 1) }
              }
            : r
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setCommentsBusy(false);
    }
  }

  async function toggleLike() {
    if (!active || busy) return;
    setBusy(true);
    const liked = Array.isArray(active.likes) && active.likes.length > 0;
    const prev = active;
    setItems((list) =>
      list.map((r) =>
        r.id === active.id
          ? {
              ...r,
              likes: liked ? [] : [{ id: 'local' }],
              _count: {
                ...r._count,
                likes: Math.max(0, (r._count?.likes ?? 0) + (liked ? -1 : 1))
              }
            }
          : r
      )
    );
    try {
      if (liked) await unlikeReel(active.id);
      else await likeReel(active.id);
    } catch (err) {
      setItems((list) => list.map((r) => (r.id === prev.id ? prev : r)));
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  function toggleSave() {
    if (!active) return;
    setSaved((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(active.id)) {
        nextSet.delete(active.id);
        push(t('unsave'), 'success');
      } else {
        nextSet.add(active.id);
        push(t('save'), 'success');
      }
      persistSavedReels(nextSet);
      return nextSet;
    });
  }

  function spawnBurst(emoji: string) {
    const id = ++burstId.current;
    setBursts((list) => [...list, { id, emoji }]);
    window.setTimeout(() => {
      setBursts((list) => list.filter((b) => b.id !== id));
    }, 900);
  }

  async function onSticker(emoji: string) {
    spawnBurst(emoji);
    setStickersOpen(false);
    if (!active || active.commentsDisabled || commentsBusy) return;
    const body = `[sticker]${emoji}`;
    setCommentsBusy(true);
    try {
      let rows = comments;
      if (!rows.length) {
        rows = await fetchReelComments(active.id);
        setComments(Array.isArray(rows) ? rows : []);
      }
      const prevId =
        stickerCommentIds.current.get(active.id) ||
        rows.find(
          (c: any) => c.authorId === me && String(c.body || '').startsWith('[sticker]') && !c.parentId
        )?.id;
      let delta = 1;
      if (prevId) {
        await deleteReelComment(active.id, prevId);
        setComments((list) => list.filter((c) => c.id !== prevId));
        stickerCommentIds.current.delete(active.id);
        delta = 0;
      }
      const created = (await createReelComment(active.id, body)) as { id: string };
      stickerCommentIds.current.set(active.id, created.id);
      setComments((list) => [...list.filter((c) => c.id !== prevId), created]);
      if (delta) {
        setItems((list) =>
          list.map((r) =>
            r.id === active.id
              ? { ...r, _count: { ...r._count, comments: (r._count?.comments ?? 0) + 1 } }
              : r
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setCommentsBusy(false);
    }
  }

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }

  function onStagePointer(e: MouseEvent | TouchEvent) {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      spawnBurst('❤️');
      if (!(Array.isArray(active?.likes) && active.likes.length > 0)) void toggleLike();
      return;
    }
    lastTap.current = now;
    if ('touches' in e) return;
    window.setTimeout(() => {
      if (Date.now() - lastTap.current >= 260) togglePlay();
    }, 280);
  }

  function clearBoost() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (boosting) {
      const el = videoRef.current;
      if (el) el.playbackRate = rateBeforeBoost.current || 1;
      setBoosting(false);
    }
  }

  function onProgressPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    const el = videoRef.current;
    wasPlayingBeforeScrub.current = Boolean(el && !el.paused);
    scrubbingRef.current = true;
    el?.pause();
    setPlaying(false);
    setScrubbing(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    seekFromClientX(e.clientX, e.currentTarget);
  }

  function seekFromClientX(clientX: number, bar: HTMLElement) {
    const el = videoRef.current;
    if (!el) return;
    const dur =
      Number.isFinite(el.duration) && el.duration > 0
        ? el.duration
        : durationSec > 0
          ? durationSec
          : 0;
    if (!(dur > 0)) return;
    const rect = bar.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t = ratio * dur;
    try {
      el.currentTime = t;
    } catch {
      /* ignore */
    }
    setProgress(t);
    if (Number.isFinite(el.duration) && el.duration > 0) {
      /* keep durationSec in sync if metadata arrived late */
    }
  }

  function onProgressPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!scrubbing) return;
    e.stopPropagation();
    seekFromClientX(e.clientX, e.currentTarget);
  }

  function onProgressPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!scrubbing && !scrubbingRef.current) return;
    e.stopPropagation();
    seekFromClientX(e.clientX, e.currentTarget);
    scrubbingRef.current = false;
    setScrubbing(false);
    const el = videoRef.current;
    if (el && wasPlayingBeforeScrub.current) {
      void el.play().then(() => setPlaying(true)).catch(() => undefined);
    }
  }

  function onStagePointerDown(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    // Long-press toward progress direction (right half) → 1.5×
    if (relX > 0.55 && e.button === 0) {
      longPressTimer.current = window.setTimeout(() => {
        const el = videoRef.current;
        if (!el) return;
        rateBeforeBoost.current = el.playbackRate || 1;
        el.playbackRate = 1.5;
        setBoosting(true);
        if (el.paused) void el.play().then(() => setPlaying(true)).catch(() => undefined);
      }, 220);
    }
  }

  if (loading) return <PageLoader />;
  if (error && items.length === 0) return <ErrorBanner message={error} />;
  if (items.length === 0) {
    return (
      <EmptyState
        title={t('emptyReels')}
        description={t('emptyReelsHint')}
        action={
          <Link className="button button-compact" to="/create">
            {t('create')}
          </Link>
        }
      />
    );
  }

  const liked = Array.isArray(active?.likes) && active.likes.length > 0;
  const isSaved = active ? saved.has(active.id) : false;
  const url = active?.playable ? resolveMediaUrl(active.media?.secureUrl) : null;
  const processing =
    active?.media?.processingStatus === 'processing' || active?.media?.processingStatus === 'uploaded';
  const isOwner = Boolean(me && active?.authorId === me);
  const tags = (active?.hashtags || []).map((h: any) => h.hashtag?.tag || h.tag).filter(Boolean);
  const authorName = active?.author?.username || 'user';
  const display = active?.author?.displayName || authorName;
  const caption = String(active?.caption || '');
  const progressPct = durationSec > 0 ? Math.min(100, (progress / durationSec) * 100) : 0;

  return (
    <div className="reels-page reels-page-tt">
      {error ? <ErrorBanner message={error} /> : null}
      <button
        type="button"
        className="button button-ghost button-compact reel-back-btn"
        onClick={() => {
          if (window.history.length > 1) navigate(-1);
          else navigate('/feed');
        }}
      >
        ← {t('back')}
      </button>
      <div
        className={`reel-stage ${boosting ? 'is-boost' : ''}`}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) < 28) return;
          go(e.deltaY > 0 ? 1 : -1);
        }}
        onTouchStart={(e) => {
          touchY.current = e.touches[0]?.clientY ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchY.current;
          touchY.current = null;
          if (start == null) return;
          const end = e.changedTouches[0]?.clientY ?? start;
          const dy = start - end;
          if (Math.abs(dy) < 56) return;
          go(dy > 0 ? 1 : -1);
        }}
        onPointerDown={onStagePointerDown}
        onPointerUp={() => clearBoost()}
        onPointerCancel={() => clearBoost()}
        onPointerLeave={() => clearBoost()}
      >
        <div
          className={`reel-progress interactive ${scrubbing ? 'scrubbing' : ''}`}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationSec)}
          aria-valuenow={Math.round(progress)}
          onPointerDown={onProgressPointerDown}
          onPointerMove={onProgressPointerMove}
          onPointerUp={onProgressPointerUp}
          onPointerCancel={onProgressPointerUp}
        >
          <span style={{ width: `${progressPct}%` }} />
          {(scrubbing || boosting) && durationSec > 0 ? (
            <em className="reel-progress-time">
              {Math.floor(progress)}s / {Math.floor(durationSec)}s{boosting ? ' · 1.5×' : ''}
            </em>
          ) : null}
        </div>

        {!active?.playable || !url ? (
          <div className="reel-placeholder">
            <p>{processing ? t('reelProcessing') : mediaError || t('mediaMissing')}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="reel-video"
            playsInline
            loop
            muted={muted}
            preload="metadata"
            data-testid="reel-video"
            style={rotationDeg ? { transform: `rotate(${rotationDeg}deg)` } : undefined}
            onClick={(e) => onStagePointer(e)}
            onError={() => {
              setMediaError(t('mediaMissing'));
              setPlaying(false);
            }}
          />
        )}

        {url && !mediaError && !playing ? (
          <button
            type="button"
            className="reel-play-hint"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            aria-label={t('play')}
          >
            ▶
          </button>
        ) : null}

        {bursts.map((b) => (
          <span key={b.id} className="reel-burst" aria-hidden>
            {b.emoji}
          </span>
        ))}

        {/* TikTok / IG right action rail */}
        <aside className="reel-rail" aria-label={t('reels')}>
          <Link to={`/u/${authorName}`} className="reel-rail-avatar" onClick={(e) => e.stopPropagation()}>
            <UserAvatar size="md" name={display} username={authorName} avatarUrl={active?.author?.avatarUrl} />
          </Link>

          <button
            type="button"
            className={`reel-rail-btn ${liked ? 'is-liked' : ''}`}
            disabled={busy}
            onClick={() => void toggleLike()}
            aria-label={t('likes')}
          >
            <IconHeart size={28} filled={liked} />
            <span>{formatCount(active?._count?.likes ?? 0)}</span>
          </button>

          <button
            type="button"
            className={`reel-rail-btn${active?.commentsDisabled ? ' is-disabled' : ''}`}
            data-testid="reel-comments-toggle"
            disabled={Boolean(active?.commentsDisabled)}
            title={active?.commentsDisabled ? t('commentsOff') : undefined}
            onClick={() => {
              if (active?.commentsDisabled) return;
              const nextOpen = !commentsOpen;
              setCommentsOpen(nextOpen);
              setShareOpen(false);
              setStickersOpen(false);
              if (nextOpen && active?.id) void loadComments(active.id);
            }}
            aria-label={active?.commentsDisabled ? t('commentsOffBtn') : t('comments')}
          >
            <IconComment size={28} />
            <span>{formatCount(active?._count?.comments ?? 0)}</span>
          </button>

          <button
            type="button"
            className="reel-rail-btn"
            onClick={() => {
              setShareOpen(true);
              setCommentsOpen(false);
              setStickersOpen(false);
              setMenuOpen(false);
            }}
            aria-label={t('share')}
          >
            <IconSend size={26} />
            <span>{formatCount(active?.shareCount ?? 0)}</span>
          </button>

          <button
            type="button"
            className={`reel-rail-btn ${isSaved ? 'is-saved' : ''}`}
            onClick={toggleSave}
            aria-label={t('save')}
          >
            <IconBookmark size={26} filled={isSaved} />
            <span>{t('save')}</span>
          </button>

          <button
            type="button"
            className="reel-rail-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => !m);
            }}
            aria-label={muted ? t('unmute') : t('mute')}
          >
            {muted ? <IconMute size={26} /> : <IconVolume size={26} />}
            <span>{muted ? t('unmute') : t('mute')}</span>
          </button>

          <div className="reel-menu-anchor">
            <button
              ref={menuBtnRef}
              type="button"
              className="reel-rail-btn"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
                setShareOpen(false);
                setCommentsOpen(false);
                setStickersOpen(false);
              }}
              aria-label={t('more')}
              aria-expanded={menuOpen}
            >
              <IconMore size={24} />
            </button>
            {menuOpen && active && menuPos
              ? createPortal(
                  <div
                    className="post-menu reel-menu reel-menu-portal"
                    role="menu"
                    style={
                      {
                        ['--reel-menu-left' as string]: `${menuPos.left}px`,
                        ['--reel-menu-bottom' as string]: `${menuPos.bottom}px`
                      } as CSSProperties
                    }
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isOwner ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            setEditOpen(true);
                          }}
                        >
                          {t('edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void setReelCommentsDisabled(active.id, !active.commentsDisabled).then(() => {
                              setItems((list) =>
                                list.map((r) =>
                                  r.id === active.id
                                    ? { ...r, commentsDisabled: !active.commentsDisabled }
                                    : r
                                )
                              );
                              setMenuOpen(false);
                            })
                          }
                        >
                          {active.commentsDisabled ? t('enableComments') : t('disableComments')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void archiveReel(active.id, true).then(() => {
                              push(t('archived'), 'success');
                              setItems((list) => list.filter((r) => r.id !== active.id));
                              setMenuOpen(false);
                              window.dispatchEvent(
                                new CustomEvent('content:archived', {
                                  detail: { kind: 'reel', id: active.id }
                                })
                              );
                            })
                          }
                        >
                          {t('archive')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void requestDownloadUrl('reel', active.id).then(({ secureUrl }) => {
                              const a = document.createElement('a');
                              a.href = secureUrl;
                              a.download = `reel-${active.id}.mp4`;
                              a.rel = 'noopener';
                              a.target = '_blank';
                              a.click();
                              setMenuOpen(false);
                            })
                          }
                        >
                          {t('download')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void recordContentSignal({
                              targetType: 'reel',
                              targetId: active.id,
                              signal: 'more_like_this'
                            }).then(() => {
                              push(t('preferenceSaved'), 'success');
                              setMenuOpen(false);
                            })
                          }
                        >
                          {t('showMoreLikeThis')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void recordContentSignal({
                              targetType: 'reel',
                              targetId: active.id,
                              signal: 'not_interested'
                            }).then(() => {
                              push(t('preferenceSaved'), 'success');
                              setItems((list) => list.filter((r) => r.id !== active.id));
                              setMenuOpen(false);
                            })
                          }
                        >
                          {t('notInterested')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void requestDownloadUrl('reel', active.id).then(({ secureUrl }) => {
                              const a = document.createElement('a');
                              a.href = secureUrl;
                              a.download = `reel-${active.id}.mp4`;
                              a.rel = 'noopener';
                              a.target = '_blank';
                              a.click();
                              setMenuOpen(false);
                            })
                          }
                        >
                          {t('download')}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setStickersOpen(true);
                        setMenuOpen(false);
                      }}
                    >
                      {t('stickers')}
                    </button>
                    <button type="button" onClick={() => setMenuOpen(false)}>
                      {t('close')}
                    </button>
                  </div>,
                  document.body
                )
              : null}
          </div>
        </aside>

        {/* Bottom publisher + caption */}
        <div className={`reel-video-tools${playing ? '' : ' is-visible'}`}>
          <button
            type="button"
            className="reel-tool-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => !m);
            }}
            aria-label={muted ? t('unmute') : t('mute')}
          >
            {muted ? <IconMute size={20} /> : <IconVolume size={20} />}
          </button>
          <button
            type="button"
            className={`reel-tool-btn reel-rotate-btn ${rotationDeg ? 'on' : ''}`}
            aria-label={t('rotateVideo')}
            title={t('rotateVideo')}
            onClick={(e) => {
              e.stopPropagation();
              setRotationDeg((d) => (d === 0 ? -90 : 0));
            }}
          >
            <IconScreenRotate size={20} />
          </button>
        </div>

        <div className="reel-meta">
          <Link to={`/u/${authorName}`} className="reel-author">
            <UserAvatar size="sm" name={display} username={authorName} avatarUrl={active?.author?.avatarUrl} />
            <div className="reel-author-text">
              <strong>{display}</strong>
              <span>@{authorName}</span>
            </div>
          </Link>

          {caption || tags.length ? (
            <button
              type="button"
              className={`reel-caption ${captionOpen ? 'is-open' : ''}`}
              onClick={() => setCaptionOpen((v) => !v)}
            >
              {caption ? <span className="reel-caption-text">{caption}</span> : null}
              {tags.length ? (
                <span className="reel-caption-tags">{tags.map((h: string) => `#${h}`).join(' ')}</span>
              ) : null}
              {!captionOpen && (caption.length > 48 || tags.length > 2) ? (
                <span className="reel-caption-more">{t('more')}</span>
              ) : null}
            </button>
          ) : null}

          <p className="reel-views muted tiny">
            {formatCount(active?.viewCount ?? 0)} {t('views')}
          </p>
        </div>

        {stickersOpen ? (
          <div className="reel-sticker-tray" role="listbox" aria-label={t('stickers')}>
            {REEL_STICKERS.map((e) => (
              <button key={e} type="button" className="sticker-btn" onClick={() => void onSticker(e)}>
                {e}
              </button>
            ))}
          </div>
        ) : null}

        {commentsOpen && active && !shareOpen ? (
          <div className="share-panel reel-comments-panel sheet-dialog" data-testid="reel-comments-panel">
            <div className="reel-sheet-head">
              <strong>{t('comments')}</strong>
              <button type="button" className="button button-ghost button-compact" onClick={() => setCommentsOpen(false)}>
                {t('close')}
              </button>
            </div>
            {active.commentsDisabled ? <p className="muted">{t('commentsOff')}</p> : null}
            {commentsBusy && !comments.length ? <p className="muted">{t('loading')}</p> : null}
            <CommentThread
              comments={comments}
              {...(typeof me === 'string' && me ? { me } : {})}
              {...(typeof active.authorId === 'string' ? { ownerId: active.authorId } : {})}
              {...(typeof active.commentsDisabled === 'boolean'
                ? { commentsDisabled: active.commentsDisabled }
                : {})}
              busy={commentsBusy}
              onReply={(parentId, username) => {
                setReplyToId(parentId);
                setCommentDraft(`@${username} `);
              }}
              onDelete={(id) => void removeComment(id)}
            />
            {!active.commentsDisabled ? (
              <div className="reel-sheet-composer">
                {replyToId ? (
                  <button
                    type="button"
                    className="button button-ghost button-compact"
                    onClick={() => {
                      setReplyToId(null);
                      setCommentDraft('');
                    }}
                  >
                    {t('cancel')}
                  </button>
                ) : null}
                <input
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder={replyToId ? t('reply') : t('writeComment')}
                  maxLength={1000}
                  disabled={commentsBusy}
                  dir="auto"
                />
                <button
                  type="button"
                  className="button button-compact"
                  disabled={commentsBusy || !commentDraft.trim()}
                  onClick={() => void submitComment(undefined, replyToId)}
                >
                  {t('send')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {shareOpen && active && !commentsOpen ? (
          <SharePeoplePanel
            className="reel-share-panel sheet-dialog"
            targetType="reel"
            targetId={active.id}
            onClose={() => setShareOpen(false)}
            onShared={(shareCount) => {
              if (typeof shareCount !== 'number') return;
              setItems((list) =>
                list.map((r) => (r.id === active.id ? { ...r, shareCount } : r))
              );
            }}
          />
        ) : null}

        {editOpen && active ? (
          <ContentEditModal
            kind="reel"
            item={active}
            onClose={() => setEditOpen(false)}
            onSaved={(next) => {
              setItems((list) => list.map((r) => (r.id === next.id ? { ...r, ...next } : r)));
              push(t('changesSaved'), 'success');
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
