import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  blockUser,
  bookmarkPost,
  createComment,
  deleteComment,
  deletePost,
  fetchComments,
  likePost,
  unbookmarkPost,
  unlikePost,
  viewPost
} from '@/api/social';
import {
  archivePost,
  recordContentSignal,
  requestDownloadUrl,
  setPostCommentsDisabled
} from '@/api/content';
import { upsertStoreProduct } from '@/api/accounts';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import {
  IconBookmark,
  IconComment,
  IconEye,
  IconHeart,
  IconMore,
  IconSend
} from '../ui/Icons';
import { CommentThread } from '../ui/CommentThread';
import { ContentEditModal } from '../ui/ContentEditModal';
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

function PostMedia({ post }: { post: any }) {
  const items = Array.isArray(post.media) ? post.media : [];
  if (!items.length) return null;
  const status = post.moderationStatus || 'APPROVED';
  const quarantined =
    !['APPROVED', 'RESTORED'].includes(status) ||
    items.some((row: any) => row?.media?.mediaRedacted);
  const hasPreview = items.some((row: any) => row?.media?.secureUrl || row?.media?.posterUrl);
  if (quarantined && !hasPreview) {
    const label =
      post.moderation?.badge ||
      (status === 'PENDING_REVIEW'
        ? 'قيد المراجعة'
        : status === 'HIDDEN' || status === 'REMOVED'
          ? 'محتوى محظور'
          : 'غير متاح للعرض');
    return (
      <div className="post-media moderation-grid-tile" dir="rtl" style={{ aspectRatio: 'auto', minHeight: 180 }}>
        <span className="moderation-grid-label">{label}</span>
      </div>
    );
  }
  const label =
    quarantined
      ? post.moderation?.badge ||
        (status === 'PENDING_REVIEW'
          ? 'قيد المراجعة'
          : status === 'HIDDEN' || status === 'REMOVED'
            ? 'محتوى محظور'
            : status === 'REVIEW_FAILED'
              ? 'فشل الفحص — قيد الانتظار'
              : 'مقيّد')
      : null;
  return (
    <div className={`post-media post-media-carousel${quarantined ? ' moderation-preview-wrap' : ''}`}>
      <FeedMediaPlayer items={items} mode="post" aspectRatio={post.aspectRatio} />
      {label ? (
        <span className="moderation-preview-badge" dir="rtl">
          {label}
        </span>
      ) : null}
    </div>
  );
}

export function PostCard({
  post,
  onChange,
  onRemoved,
  compact
}: {
  post: any;
  onChange: (next: any) => void;
  onRemoved?: (id: string) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { push } = useToast();
  const me = getSessionSnapshot()?.user?.id;
  const liked = Array.isArray(post.likes) && post.likes.length > 0;
  const bookmarked = Array.isArray(post.bookmarks) && post.bookmarks.length > 0;
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[] | null>(null);
  const [commentText, setCommentText] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [catalogPrice, setCatalogPrice] = useState('');
  const [error, setError] = useState('');
  const isOwner = Boolean(me && post.authorId === me);

  const authorName = post.author?.username || 'user';
  const display = post.author?.displayName || authorName;
  const hashtags = (post.hashtags || []).map((h: any) => h.hashtag?.tag || h.tag).filter(Boolean);
  const viewCount = post.viewCount ?? post._count?.views ?? 0;
  const viewedRef = useRef(false);

  useEffect(() => {
    if (!post?.id || viewedRef.current) return;
    viewedRef.current = true;
    void viewPost(post.id)
      .then((res) => {
        if (typeof res?.viewCount === 'number') {
          onChange({ ...post, viewCount: res.viewCount });
        }
      })
      .catch(() => undefined);
    // Intentionally once per mount / post id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  async function toggleLike() {
    const prev = post;
    const nextLiked = !liked;
    onChange({
      ...post,
      likes: nextLiked ? [{ id: 'local' }] : [],
      _count: {
        ...post._count,
        likes: Math.max(0, (post._count?.likes ?? 0) + (nextLiked ? 1 : -1))
      }
    });
    try {
      if (liked) await unlikePost(post.id);
      else await likePost(post.id);
    } catch (err) {
      onChange(prev);
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function toggleBookmark() {
    const prev = post;
    onChange({ ...post, bookmarks: bookmarked ? [] : [{ id: 'local' }] });
    try {
      if (bookmarked) await unbookmarkPost(post.id);
      else await bookmarkPost(post.id);
      push(bookmarked ? t('unsave') : t('save'), 'success');
    } catch (err) {
      onChange(prev);
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function openComments() {
    setShowComments(true);
    setError('');
    try {
      setComments(await fetchComments(post.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
      setComments([]);
    }
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    setBusy(true);
    setError('');
    try {
      const created = await createComment(post.id, commentText.trim(), replyToId || undefined);
      setComments((prev) => [...(prev ?? []), created]);
      setCommentText('');
      setReplyToId(null);
      onChange({
        ...post,
        _count: { ...post._count, comments: (post._count?.comments ?? 0) + 1 }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function removeComment(commentId: string) {
    setBusy(true);
    setError('');
    try {
      await deleteComment(post.id, commentId);
      setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId));
      onChange({
        ...post,
        _count: { ...post._count, comments: Math.max(0, (post._count?.comments ?? 1) - 1) }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function removePost() {
    setBusy(true);
    setMenuOpen(false);
    setConfirmDelete(false);
    try {
      await deletePost(post.id);
      onRemoved?.(post.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  function onShareOpen() {
    setShareOpen(true);
    setShowComments(false);
    setMenuOpen(false);
  }

  const postedAt = formatPostDate(post.createdAt);

  const ownerModBadge = isOwner
    ? post.moderation?.badge ||
      (post.moderationStatus === 'PENDING_REVIEW'
        ? 'قيد المراجعة'
        : post.moderationStatus === 'HIDDEN' || post.moderationStatus === 'REMOVED'
          ? 'محتوى محظور'
          : post.moderationStatus === 'REVIEW_FAILED'
            ? 'فشل الفحص — قيد الانتظار'
            : null)
    : null;

  return (
    <article className={`post-card feed-edge ${compact ? 'post-card-compact' : ''}`}>
      {ownerModBadge ? (
        <div className="moderation-owner-badge" dir="rtl">
          {ownerModBadge}
        </div>
      ) : null}
      <header className="post-header">
        <Link to={`/u/${authorName}`} className="post-author">
          <UserAvatar
            size="md"
            name={display}
            username={authorName}
            avatarUrl={post.author?.avatarUrl}
          />
          <span className="post-author-text">
            <strong className="post-display-name">{display}</strong>
            <span className="muted tiny post-username">@{authorName}</span>
          </span>
        </Link>
        <div className="post-header-end">
          {postedAt ? <time className="post-date muted tiny">{postedAt}</time> : null}
          <div className="post-menu-wrap">
          <button type="button" className="icon-btn" aria-label={t('more')} onClick={() => setMenuOpen((v) => !v)}>
            <IconMore size={18} />
          </button>
          {menuOpen ? (
            <div className="post-menu">
              {isOwner ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMenuOpen(false);
                      setEditOpen(true);
                    }}
                  >
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void setPostCommentsDisabled(post.id, !post.commentsDisabled)
                        .then(() => {
                          onChange({ ...post, commentsDisabled: !post.commentsDisabled });
                          setMenuOpen(false);
                        })
                        .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                    }
                  >
                    {post.commentsDisabled ? t('enableComments') : t('disableComments')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void archivePost(post.id, true)
                        .then(() => {
                          push(t('archived'), 'success');
                          onRemoved?.(post.id);
                          window.dispatchEvent(
                            new CustomEvent('content:archived', {
                              detail: { kind: 'post', id: post.id }
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
                    disabled={busy}
                    onClick={() =>
                      void requestDownloadUrl('post', post.id)
                        .then(({ secureUrl }) => {
                          const a = document.createElement('a');
                          a.href = secureUrl;
                          a.download = '';
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
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDelete(true);
                    }}
                  >
                    {t('delete')}
                  </button>
                  <div className="post-menu-catalog">
                    <input
                      type="number"
                      min={1}
                      value={catalogPrice}
                      onChange={(e) => setCatalogPrice(e.target.value)}
                      placeholder={t('setPriceIqd')}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      type="button"
                      disabled={busy || !catalogPrice}
                      onClick={() =>
                        void upsertStoreProduct({
                          postId: post.id,
                          priceIqd: Math.round(Number(catalogPrice))
                        })
                          .then(() => {
                            push(t('addToCatalog'), 'success');
                            setMenuOpen(false);
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                      }
                    >
                      {t('addToCatalog')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    <ReportContentButton targetType="post" targetId={post.id} compact />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void blockUser(post.authorId)
                        .then(() => {
                          push(t('blocked'), 'success');
                          setMenuOpen(false);
                          onRemoved?.(post.id);
                        })
                        .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
                    }
                  >
                    {t('block')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void recordContentSignal({
                        targetType: 'post',
                        targetId: post.id,
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
                        targetType: 'post',
                        targetId: post.id,
                        signal: 'not_interested'
                      }).then(() => {
                        push(t('preferenceSaved'), 'success');
                        setMenuOpen(false);
                      })
                    }
                  >
                    {t('notInterested')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void requestDownloadUrl('post', post.id)
                        .then(({ secureUrl }) => {
                          const a = document.createElement('a');
                          a.href = secureUrl;
                          a.download = '';
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
            </div>
          ) : null}
          </div>
        </div>
      </header>
      <PostMedia post={post} />
      <div className="post-footer-block">
        <div className="post-actions ig-post-actions">
          <div className="post-actions-start">
            <button
              className={`action-btn ${liked ? 'active like' : ''}`}
              type="button"
              aria-label={t('like')}
              aria-pressed={liked}
              onClick={() => void toggleLike()}
            >
              <IconHeart size={24} filled={liked} />
              <span className="action-count">{post._count?.likes ?? 0}</span>
            </button>
            <button
              className={`action-btn${post.commentsDisabled ? ' is-disabled' : ''}`}
              type="button"
              aria-label={post.commentsDisabled ? t('commentsOffBtn') : t('comment')}
              disabled={post.commentsDisabled}
              title={post.commentsDisabled ? t('commentsOff') : undefined}
              onClick={() => {
                if (post.commentsDisabled) return;
                setShareOpen(false);
                if (showComments) setShowComments(false);
                else void openComments();
              }}
            >
              <IconComment size={24} />
              <span className="action-count">{post._count?.comments ?? 0}</span>
            </button>
            <button
              className="action-btn"
              type="button"
              aria-label={t('share')}
              onClick={() => onShareOpen()}
            >
              <IconSend size={24} />
              <span className="action-count">{post.shareCount ?? 0}</span>
            </button>
          </div>
          <div className="post-actions-end">
            <button
              className={`action-btn action-bookmark ${bookmarked ? 'active' : ''}`}
              type="button"
              aria-label={t('save')}
              aria-pressed={bookmarked}
              onClick={() => void toggleBookmark()}
            >
              <IconBookmark size={24} filled={bookmarked} />
            </button>
          </div>
        </div>
        <div className="post-views-row" aria-label={t('views')}>
          <IconEye size={16} />
          <span>{viewCount}</span>
        </div>
        {post.caption ? <p className="post-caption">{post.caption}</p> : null}
        {hashtags.length ? (
          <p className="post-hashtags">{hashtags.map((h: string) => `#${h}`).join(' ')}</p>
        ) : null}
      </div>
      {error ? <p className="auth-error">{error}</p> : null}
      {editOpen ? (
        <ContentEditModal
          kind="post"
          item={post}
          onClose={() => setEditOpen(false)}
          onSaved={(next) => {
            onChange(next);
            push(t('changesSaved'), 'success');
          }}
        />
      ) : null}
      {confirmDelete ? (
        <div className="confirm-panel" role="dialog" aria-modal="true">
          <p>{t('confirmDeletePost')}</p>
          <div className="inline-actions">
            <button type="button" className="button button-ghost button-compact" onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </button>
            <button type="button" className="button button-compact" disabled={busy} onClick={() => void removePost()}>
              {t('delete')}
            </button>
          </div>
        </div>
      ) : null}
      {shareOpen && !showComments ? (
        <div className="sheet-overlay" role="dialog" aria-modal="true">
          <SharePeoplePanel
            targetType="post"
            targetId={post.id}
            className="sheet-dialog reel-share-panel"
            onClose={() => setShareOpen(false)}
            onShared={(shareCount) => {
              if (typeof shareCount !== 'number') return;
              onChange({ ...post, shareCount });
            }}
          />
        </div>
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
            {post.commentsDisabled ? <p className="muted">{t('commentsOff')}</p> : null}
            {comments === null ? <p className="muted">{t('loading')}</p> : null}
            {comments && comments.length === 0 ? <p className="muted">{t('emptyComments')}</p> : null}
            {comments && comments.length > 0 ? (
              <CommentThread
                comments={comments}
                {...(me ? { me } : {})}
                {...(typeof post.authorId === 'string' ? { ownerId: post.authorId } : {})}
                {...(typeof post.commentsDisabled === 'boolean'
                  ? { commentsDisabled: post.commentsDisabled }
                  : {})}
                busy={busy}
                onReply={(parentId, username) => {
                  setReplyToId(parentId);
                  setCommentText(`@${username} `);
                }}
                onDelete={(id) => void removeComment(id)}
              />
            ) : null}
            {!post.commentsDisabled ? (
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
                  maxLength={1000}
                />
                <button className="button button-compact" type="submit" disabled={busy || !commentText.trim()}>
                  {t('send')}
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
