import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createReelComment,
  deleteReelComment,
  fetchReelComments,
  likeReel,
  unlikeReel,
  viewReel
} from '@/api/social';
import {
  archiveReel,
  recordContentSignal,
  requestDownloadUrl,
  setReelCommentsDisabled
} from '@/api/content';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { isReelSaved, toggleSavedReel } from '@/lib/savedReels';
import { CommentThread } from '../ui/CommentThread';
import { ContentEditModal } from '../ui/ContentEditModal';
import {
  IconBookmark,
  IconComment,
  IconEye,
  IconHeart,
  IconMore,
  IconSend
} from '../ui/Icons';
import { FeedMediaPlayer } from '../ui/FeedMediaPlayer';
import { SharePeoplePanel } from '../ui/SharePeoplePanel';
import { UserAvatar } from '../ui/UserAvatar';
import { useToast } from '../ui/Toast';
import { ReportContentButton } from '../ui/ReportContentButton';

function formatPostDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Compact reel card for Home / Explore scroll — mirrors PostCard layout. */
export function FeedReelCard({
  reel,
  onChange,
  onRemoved
}: {
  reel: any;
  onChange: (next: any) => void;
  onRemoved?: (id: string) => void;
}) {
  const { t } = useI18n();
  const { push } = useToast();
  const me = getSessionSnapshot()?.user?.id;
  const liked = Array.isArray(reel.likes) && reel.likes.length > 0;
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[] | null>(null);
  const [commentText, setCommentText] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saved, setSaved] = useState(() => isReelSaved(reel.id));
  const [error, setError] = useState('');
  const isOwner = Boolean(me && reel.authorId === me);
  const viewed = useRef(false);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setSaved(isReelSaved(reel.id));
  }, [reel.id]);

  const authorName = reel.author?.username || 'user';
  const display = reel.author?.displayName || authorName;
  const media = reel.media;
  const viewCount = reel.viewCount ?? 0;

  useEffect(() => {
    const node = rootRef.current;
    if (!node || viewed.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.55)) return;
        if (viewed.current) return;
        viewed.current = true;
        void viewReel(reel.id)
          .then(() => onChange({ ...reel, viewCount: (reel.viewCount ?? 0) + 1 }))
          .catch(() => undefined);
      },
      { threshold: [0.55] }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reel, onChange]);

  async function toggleLike() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (liked) {
        await unlikeReel(reel.id);
        onChange({
          ...reel,
          likes: [],
          _count: { ...reel._count, likes: Math.max(0, (reel._count?.likes ?? 1) - 1) }
        });
      } else {
        await likeReel(reel.id);
        onChange({
          ...reel,
          likes: [{ id: 'me' }],
          _count: { ...reel._count, likes: (reel._count?.likes ?? 0) + 1 }
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function openComments() {
    setShowComments(true);
    if (comments) return;
    try {
      const rows = await fetchReelComments(reel.id);
      setComments(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
      setComments([]);
    }
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!commentText.trim() || busy || reel.commentsDisabled) return;
    setBusy(true);
    try {
      const created = await createReelComment(reel.id, commentText.trim(), replyToId || undefined);
      setComments((list) => [...(list || []), created]);
      setCommentText('');
      setReplyToId(null);
      onChange({
        ...reel,
        _count: { ...reel._count, comments: (reel._count?.comments ?? 0) + 1 }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function removeComment(commentId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await deleteReelComment(reel.id, commentId);
      setComments((list) => (list || []).filter((c) => c.id !== commentId));
      onChange({
        ...reel,
        _count: { ...reel._count, comments: Math.max(0, (reel._count?.comments ?? 1) - 1) }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  const postedAt = formatPostDate(reel.createdAt);

  return (
    <article ref={rootRef} className="post-card feed-reel-card feed-edge">
      <header className="post-header">
        <Link to={`/u/${authorName}`} className="post-author">
          <UserAvatar
            size="md"
            name={display}
            username={authorName}
            avatarUrl={reel.author?.avatarUrl}
          />
          <span className="post-author-text">
            <strong className="post-display-name">{display}</strong>
            <span className="muted tiny post-username">@{authorName} · {t('reels')}</span>
          </span>
        </Link>
        <div className="post-header-end">
          {postedAt ? <time className="post-date muted tiny">{postedAt}</time> : null}
          <div className="post-menu-wrap">
            <button
              type="button"
              className="icon-btn"
              aria-label={t('more')}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <IconMore size={18} />
            </button>
            {menuOpen ? (
              <div className="post-menu" role="menu">
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
                        void setReelCommentsDisabled(reel.id, !reel.commentsDisabled)
                          .then(() => {
                            onChange({ ...reel, commentsDisabled: !reel.commentsDisabled });
                            setMenuOpen(false);
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                      }
                    >
                      {reel.commentsDisabled ? t('enableComments') : t('disableComments')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void archiveReel(reel.id, true)
                          .then(() => {
                            push(t('archived'), 'success');
                            setMenuOpen(false);
                            onRemoved?.(reel.id);
                            window.dispatchEvent(
                              new CustomEvent('content:archived', {
                                detail: { kind: 'reel', id: reel.id }
                              })
                            );
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                      }
                    >
                      {t('archive')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void requestDownloadUrl('reel', reel.id)
                          .then(({ secureUrl }) => {
                            const a = document.createElement('a');
                            a.href = secureUrl;
                            a.download = `reel-${reel.id}.mp4`;
                            a.rel = 'noopener';
                            a.target = '_blank';
                            a.click();
                            setMenuOpen(false);
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                      }
                    >
                      {t('download')}
                    </button>
                  </>
                ) : (
                  <>
                    <div role="presentation" onClick={(e) => e.stopPropagation()}>
                      <ReportContentButton targetType="reel" targetId={reel.id} compact />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void recordContentSignal({
                          targetType: 'reel',
                          targetId: reel.id,
                          signal: 'more_like_this'
                        })
                          .then(() => {
                            push(t('preferenceSaved'), 'success');
                            setMenuOpen(false);
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                      }
                    >
                      {t('showMoreLikeThis')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void recordContentSignal({
                          targetType: 'reel',
                          targetId: reel.id,
                          signal: 'not_interested'
                        })
                          .then(() => {
                            push(t('preferenceSaved'), 'success');
                            setMenuOpen(false);
                            onRemoved?.(reel.id);
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                      }
                    >
                      {t('notInterested')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void requestDownloadUrl('reel', reel.id)
                          .then(({ secureUrl }) => {
                            const a = document.createElement('a');
                            a.href = secureUrl;
                            a.download = `reel-${reel.id}.mp4`;
                            a.rel = 'noopener';
                            a.target = '_blank';
                            a.click();
                            setMenuOpen(false);
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                      }
                    >
                      {t('download')}
                    </button>
                  </>
                )}
                <button type="button" onClick={() => setMenuOpen(false)}>
                  {t('close')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="post-media feed-reel-media">
        <FeedMediaPlayer
          mode="reel"
          aspectRatio={reel.aspectRatio}
          items={[
            {
              mediaId: media?.id || reel.mediaId,
              media: media
                ? { ...media, mimeType: media.mimeType || 'video/mp4' }
                : { id: reel.mediaId, mimeType: 'video/mp4' }
            }
          ]}
        />
      </div>

      <div className="post-footer-block">
        <div className="post-actions ig-post-actions">
          <div className="post-actions-start">
            <button
              type="button"
              className={`action-btn ${liked ? 'active like' : ''}`}
              onClick={() => void toggleLike()}
              disabled={busy}
              aria-label={t('like')}
            >
              <IconHeart size={24} filled={liked} />
              <span className="action-count">{reel._count?.likes ?? 0}</span>
            </button>
            <button
              type="button"
              className={`action-btn${reel.commentsDisabled ? ' is-disabled' : ''}`}
              disabled={reel.commentsDisabled}
              title={reel.commentsDisabled ? t('commentsOff') : undefined}
              onClick={() => {
                if (reel.commentsDisabled) return;
                setShareOpen(false);
                void openComments();
              }}
              aria-label={reel.commentsDisabled ? t('commentsOffBtn') : t('comments')}
            >
              <IconComment size={24} />
              <span className="action-count">{reel._count?.comments ?? 0}</span>
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={() => {
                setShowComments(false);
                setShareOpen(true);
              }}
              aria-label={t('share')}
            >
              <IconSend size={24} />
              <span className="action-count">{reel.shareCount ?? 0}</span>
            </button>
          </div>
          <div className="post-actions-end">
            <button
              type="button"
              className={`action-btn action-bookmark ${saved ? 'active' : ''}`}
              aria-label={t('save')}
              aria-pressed={saved}
              onClick={() => {
                const next = toggleSavedReel(reel.id);
                setSaved(next);
                push(next ? t('save') : t('unsave'), 'success');
              }}
            >
              <IconBookmark size={24} filled={saved} />
            </button>
          </div>
        </div>
        <div className="post-views-row" aria-label={t('views')}>
          <IconEye size={16} />
          <span>{viewCount}</span>
        </div>
        {reel.caption ? <p className="post-caption">{reel.caption}</p> : null}
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {editOpen ? (
        <ContentEditModal
          kind="reel"
          item={reel}
          onClose={() => setEditOpen(false)}
          onSaved={(next) => {
            onChange(next);
            push(t('changesSaved'), 'success');
          }}
        />
      ) : null}

      {showComments && !shareOpen ? (
        <div className="sheet-overlay" role="dialog" aria-modal="true">
          <div className="share-panel sheet-dialog comments-sheet reel-comments-panel">
            <div className="reel-sheet-head">
              <strong>{t('comments')}</strong>
              <button type="button" className="button button-ghost button-compact" onClick={() => setShowComments(false)}>
                {t('close')}
              </button>
            </div>
            {comments && comments.length > 0 ? (
              <CommentThread
                comments={comments}
                {...(me ? { me } : {})}
                {...(typeof reel.authorId === 'string' ? { ownerId: reel.authorId } : {})}
                {...(typeof reel.commentsDisabled === 'boolean'
                  ? { commentsDisabled: reel.commentsDisabled }
                  : {})}
                busy={busy}
                onReply={(parentId, username) => {
                  setReplyToId(parentId);
                  setCommentText(`@${username} `);
                }}
                onDelete={(id) => void removeComment(id)}
              />
            ) : null}
            {!reel.commentsDisabled ? (
              <form className="reel-sheet-composer" onSubmit={(e) => void submitComment(e)}>
                {replyToId ? (
                  <button
                    type="button"
                    className="button button-ghost button-compact"
                    onClick={() => setReplyToId(null)}
                  >
                    {t('cancel')}
                  </button>
                ) : null}
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={replyToId ? t('reply') : t('addComment')}
                  maxLength={500}
                />
                <button type="submit" className="button button-compact" disabled={busy || !commentText.trim()}>
                  {t('send')}
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      {shareOpen && !showComments ? (
        <div className="sheet-overlay" role="dialog" aria-modal="true">
          <SharePeoplePanel
            targetType="reel"
            targetId={reel.id}
            className="sheet-dialog reel-share-panel"
            onClose={() => setShareOpen(false)}
            onShared={(shareCount) => {
              if (typeof shareCount !== 'number') return;
              onChange({ ...reel, shareCount });
            }}
          />
        </div>
      ) : null}
    </article>
  );
}

export function isFeedReel(item: any): boolean {
  if (!item) return false;
  if (item.kind === 'reel') return true;
  if (item.kind === 'post') return false;
  return Boolean(item.mediaId && item.media && !Array.isArray(item.media));
}
