import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { blockUser, bookmarkPost, createComment, deleteComment, deletePost, fetchComments, likePost, unbookmarkPost, unlikePost, viewPost } from '@/api/social';
import { archivePost, recordContentSignal, requestDownloadUrl, setPostCommentsDisabled } from '@/api/content';
import { upsertStoreProduct } from '@/api/accounts';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { IconBookmark, IconComment, IconEye, IconHeart, IconMore, IconSend } from '../ui/Icons';
import { CommentThread } from '../ui/CommentThread';
import { ContentEditModal } from '../ui/ContentEditModal';
import { FeedMediaPlayer } from '../ui/FeedMediaPlayer';
import { SharePeoplePanel } from '../ui/SharePeoplePanel';
import { UserAvatar } from '../ui/UserAvatar';
import { useToast } from '../ui/Toast';
function formatPostDate(iso) {
    if (!iso)
        return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
function PostMedia({ post }) {
    const items = Array.isArray(post.media) ? post.media : [];
    if (!items.length)
        return null;
    return (_jsx("div", { className: "post-media post-media-carousel", children: _jsx(FeedMediaPlayer, { items: items, mode: "post", aspectRatio: post.aspectRatio }) }));
}
export function PostCard({ post, onChange, onRemoved, compact }) {
    const { t } = useI18n();
    const { push } = useToast();
    const me = getSessionSnapshot()?.user?.id;
    const liked = Array.isArray(post.likes) && post.likes.length > 0;
    const bookmarked = Array.isArray(post.bookmarks) && post.bookmarks.length > 0;
    const [showComments, setShowComments] = useState(false);
    const [comments, setComments] = useState(null);
    const [commentText, setCommentText] = useState('');
    const [replyToId, setReplyToId] = useState(null);
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
    const hashtags = (post.hashtags || []).map((h) => h.hashtag?.tag || h.tag).filter(Boolean);
    const viewCount = post.viewCount ?? post._count?.views ?? 0;
    const viewedRef = useRef(false);
    useEffect(() => {
        if (!post?.id || viewedRef.current)
            return;
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
            if (liked)
                await unlikePost(post.id);
            else
                await likePost(post.id);
        }
        catch (err) {
            onChange(prev);
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function toggleBookmark() {
        const prev = post;
        onChange({ ...post, bookmarks: bookmarked ? [] : [{ id: 'local' }] });
        try {
            if (bookmarked)
                await unbookmarkPost(post.id);
            else
                await bookmarkPost(post.id);
            push(bookmarked ? t('unsave') : t('save'), 'success');
        }
        catch (err) {
            onChange(prev);
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function openComments() {
        setShowComments(true);
        setError('');
        try {
            setComments(await fetchComments(post.id));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
            setComments([]);
        }
    }
    async function submitComment(e) {
        e.preventDefault();
        if (!commentText.trim())
            return;
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function removeComment(commentId) {
        setBusy(true);
        setError('');
        try {
            await deleteComment(post.id, commentId);
            setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId));
            onChange({
                ...post,
                _count: { ...post._count, comments: Math.max(0, (post._count?.comments ?? 1) - 1) }
            });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    function onShareOpen() {
        setShareOpen(true);
        setShowComments(false);
        setMenuOpen(false);
    }
    const postedAt = formatPostDate(post.createdAt);
    return (_jsxs("article", { className: `post-card feed-edge ${compact ? 'post-card-compact' : ''}`, children: [_jsxs("header", { className: "post-header", children: [_jsxs(Link, { to: `/u/${authorName}`, className: "post-author", children: [_jsx(UserAvatar, { size: "md", name: display, username: authorName, avatarUrl: post.author?.avatarUrl }), _jsxs("span", { className: "post-author-text", children: [_jsx("strong", { className: "post-display-name", children: display }), _jsxs("span", { className: "muted tiny post-username", children: ["@", authorName] })] })] }), _jsxs("div", { className: "post-header-end", children: [postedAt ? _jsx("time", { className: "post-date muted tiny", children: postedAt }) : null, _jsxs("div", { className: "post-menu-wrap", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": t('more'), onClick: () => setMenuOpen((v) => !v), children: _jsx(IconMore, { size: 18 }) }), menuOpen ? (_jsx("div", { className: "post-menu", children: isOwner ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", disabled: busy, onClick: () => {
                                                        setMenuOpen(false);
                                                        setEditOpen(true);
                                                    }, children: t('edit') }), _jsx("button", { type: "button", disabled: busy, onClick: () => void setPostCommentsDisabled(post.id, !post.commentsDisabled)
                                                        .then(() => {
                                                        onChange({ ...post, commentsDisabled: !post.commentsDisabled });
                                                        setMenuOpen(false);
                                                    })
                                                        .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: post.commentsDisabled ? t('enableComments') : t('disableComments') }), _jsx("button", { type: "button", disabled: busy, onClick: () => void archivePost(post.id, true)
                                                        .then(() => {
                                                        push(t('archived'), 'success');
                                                        onRemoved?.(post.id);
                                                        window.dispatchEvent(new CustomEvent('content:archived', {
                                                            detail: { kind: 'post', id: post.id }
                                                        }));
                                                    })
                                                        .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('archive') }), _jsx("button", { type: "button", disabled: busy, onClick: () => void requestDownloadUrl('post', post.id)
                                                        .then(({ secureUrl }) => {
                                                        const a = document.createElement('a');
                                                        a.href = secureUrl;
                                                        a.download = '';
                                                        a.rel = 'noopener';
                                                        a.target = '_blank';
                                                        a.click();
                                                        setMenuOpen(false);
                                                    })
                                                        .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('download') }), _jsx("button", { type: "button", disabled: busy, onClick: () => {
                                                        setMenuOpen(false);
                                                        setConfirmDelete(true);
                                                    }, children: t('delete') }), _jsxs("div", { className: "post-menu-catalog", children: [_jsx("input", { type: "number", min: 1, value: catalogPrice, onChange: (e) => setCatalogPrice(e.target.value), placeholder: t('setPriceIqd'), onClick: (e) => e.stopPropagation() }), _jsx("button", { type: "button", disabled: busy || !catalogPrice, onClick: () => void upsertStoreProduct({
                                                                postId: post.id,
                                                                priceIqd: Math.round(Number(catalogPrice))
                                                            })
                                                                .then(() => {
                                                                push(t('addToCatalog'), 'success');
                                                                setMenuOpen(false);
                                                            })
                                                                .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('addToCatalog') })] })] })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => void blockUser(post.authorId)
                                                        .then(() => {
                                                        push(t('blocked'), 'success');
                                                        setMenuOpen(false);
                                                        onRemoved?.(post.id);
                                                    })
                                                        .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('block') }), _jsx("button", { type: "button", onClick: () => void recordContentSignal({
                                                        targetType: 'post',
                                                        targetId: post.id,
                                                        signal: 'more_like_this'
                                                    }).then(() => {
                                                        push(t('preferenceSaved'), 'success');
                                                        setMenuOpen(false);
                                                    }), children: t('showMoreLikeThis') }), _jsx("button", { type: "button", onClick: () => void recordContentSignal({
                                                        targetType: 'post',
                                                        targetId: post.id,
                                                        signal: 'not_interested'
                                                    }).then(() => {
                                                        push(t('preferenceSaved'), 'success');
                                                        setMenuOpen(false);
                                                    }), children: t('notInterested') }), _jsx("button", { type: "button", onClick: () => void requestDownloadUrl('post', post.id)
                                                        .then(({ secureUrl }) => {
                                                        const a = document.createElement('a');
                                                        a.href = secureUrl;
                                                        a.download = '';
                                                        a.rel = 'noopener';
                                                        a.target = '_blank';
                                                        a.click();
                                                        setMenuOpen(false);
                                                    })
                                                        .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('download') })] })) })) : null] })] })] }), _jsx(PostMedia, { post: post }), _jsxs("div", { className: "post-footer-block", children: [_jsxs("div", { className: "post-actions ig-post-actions", children: [_jsxs("div", { className: "post-actions-start", children: [_jsxs("button", { className: `action-btn ${liked ? 'active like' : ''}`, type: "button", "aria-label": t('like'), "aria-pressed": liked, onClick: () => void toggleLike(), children: [_jsx(IconHeart, { size: 24, filled: liked }), _jsx("span", { className: "action-count", children: post._count?.likes ?? 0 })] }), _jsxs("button", { className: `action-btn${post.commentsDisabled ? ' is-disabled' : ''}`, type: "button", "aria-label": post.commentsDisabled ? t('commentsOffBtn') : t('comment'), disabled: post.commentsDisabled, title: post.commentsDisabled ? t('commentsOff') : undefined, onClick: () => {
                                            if (post.commentsDisabled)
                                                return;
                                            setShareOpen(false);
                                            if (showComments)
                                                setShowComments(false);
                                            else
                                                void openComments();
                                        }, children: [_jsx(IconComment, { size: 24 }), _jsx("span", { className: "action-count", children: post._count?.comments ?? 0 })] }), _jsxs("button", { className: "action-btn", type: "button", "aria-label": t('share'), onClick: () => onShareOpen(), children: [_jsx(IconSend, { size: 24 }), _jsx("span", { className: "action-count", children: post.shareCount ?? 0 })] })] }), _jsx("div", { className: "post-actions-end", children: _jsx("button", { className: `action-btn action-bookmark ${bookmarked ? 'active' : ''}`, type: "button", "aria-label": t('save'), "aria-pressed": bookmarked, onClick: () => void toggleBookmark(), children: _jsx(IconBookmark, { size: 24, filled: bookmarked }) }) })] }), _jsxs("div", { className: "post-views-row", "aria-label": t('views'), children: [_jsx(IconEye, { size: 16 }), _jsx("span", { children: viewCount })] }), post.caption ? _jsx("p", { className: "post-caption", children: post.caption }) : null, hashtags.length ? (_jsx("p", { className: "post-hashtags", children: hashtags.map((h) => `#${h}`).join(' ') })) : null] }), error ? _jsx("p", { className: "auth-error", children: error }) : null, editOpen ? (_jsx(ContentEditModal, { kind: "post", item: post, onClose: () => setEditOpen(false), onSaved: (next) => {
                    onChange(next);
                    push(t('changesSaved'), 'success');
                } })) : null, confirmDelete ? (_jsxs("div", { className: "confirm-panel", role: "dialog", "aria-modal": "true", children: [_jsx("p", { children: t('confirmDeletePost') }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setConfirmDelete(false), children: t('cancel') }), _jsx("button", { type: "button", className: "button button-compact", disabled: busy, onClick: () => void removePost(), children: t('delete') })] })] })) : null, shareOpen && !showComments ? (_jsx("div", { className: "sheet-overlay", role: "dialog", "aria-modal": "true", children: _jsx(SharePeoplePanel, { targetType: "post", targetId: post.id, className: "sheet-dialog reel-share-panel", onClose: () => setShareOpen(false), onShared: (shareCount) => {
                        if (typeof shareCount !== 'number')
                            return;
                        onChange({ ...post, shareCount });
                    } }) })) : null, showComments && !shareOpen ? (_jsx("div", { className: "sheet-overlay", role: "dialog", "aria-modal": "true", children: _jsxs("div", { className: "share-panel sheet-dialog comments-sheet reel-comments-panel", children: [_jsxs("div", { className: "reel-sheet-head", children: [_jsx("strong", { children: t('comments') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setShowComments(false), children: t('close') })] }), post.commentsDisabled ? _jsx("p", { className: "muted", children: t('commentsOff') }) : null, comments === null ? _jsx("p", { className: "muted", children: t('loading') }) : null, comments && comments.length === 0 ? _jsx("p", { className: "muted", children: t('emptyComments') }) : null, comments && comments.length > 0 ? (_jsx(CommentThread, { comments: comments, ...(me ? { me } : {}), ...(typeof post.authorId === 'string' ? { ownerId: post.authorId } : {}), ...(typeof post.commentsDisabled === 'boolean'
                                ? { commentsDisabled: post.commentsDisabled }
                                : {}), busy: busy, onReply: (parentId, username) => {
                                setReplyToId(parentId);
                                setCommentText(`@${username} `);
                            }, onDelete: (id) => void removeComment(id) })) : null, !post.commentsDisabled ? (_jsxs("form", { className: "reel-sheet-composer", onSubmit: (e) => void submitComment(e), children: [replyToId ? (_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setReplyToId(null), children: t('cancel') })) : null, _jsx("input", { value: commentText, onChange: (e) => setCommentText(e.target.value), placeholder: replyToId ? t('reply') : t('addComment'), maxLength: 1000 }), _jsx("button", { className: "button button-compact", type: "submit", disabled: busy || !commentText.trim(), children: t('send') })] })) : null] }) })) : null] }));
}
