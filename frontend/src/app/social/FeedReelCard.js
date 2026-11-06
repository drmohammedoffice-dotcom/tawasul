import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createReelComment, deleteReelComment, fetchReelComments, likeReel, unlikeReel, viewReel } from '@/api/social';
import { archiveReel, recordContentSignal, requestDownloadUrl, setReelCommentsDisabled } from '@/api/content';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { isReelSaved, toggleSavedReel } from '@/lib/savedReels';
import { CommentThread } from '../ui/CommentThread';
import { ContentEditModal } from '../ui/ContentEditModal';
import { IconBookmark, IconComment, IconEye, IconHeart, IconMore, IconSend } from '../ui/Icons';
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
/** Compact reel card for Home / Explore scroll — mirrors PostCard layout. */
export function FeedReelCard({ reel, onChange, onRemoved }) {
    const { t } = useI18n();
    const { push } = useToast();
    const me = getSessionSnapshot()?.user?.id;
    const liked = Array.isArray(reel.likes) && reel.likes.length > 0;
    const [showComments, setShowComments] = useState(false);
    const [comments, setComments] = useState(null);
    const [commentText, setCommentText] = useState('');
    const [replyToId, setReplyToId] = useState(null);
    const [busy, setBusy] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [saved, setSaved] = useState(() => isReelSaved(reel.id));
    const [error, setError] = useState('');
    const isOwner = Boolean(me && reel.authorId === me);
    const viewed = useRef(false);
    const rootRef = useRef(null);
    useEffect(() => {
        setSaved(isReelSaved(reel.id));
    }, [reel.id]);
    const authorName = reel.author?.username || 'user';
    const display = reel.author?.displayName || authorName;
    const media = reel.media;
    const viewCount = reel.viewCount ?? 0;
    useEffect(() => {
        const node = rootRef.current;
        if (!node || viewed.current)
            return;
        const io = new IntersectionObserver((entries) => {
            if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.55))
                return;
            if (viewed.current)
                return;
            viewed.current = true;
            void viewReel(reel.id)
                .then(() => onChange({ ...reel, viewCount: (reel.viewCount ?? 0) + 1 }))
                .catch(() => undefined);
        }, { threshold: [0.55] });
        io.observe(node);
        return () => io.disconnect();
    }, [reel, onChange]);
    async function toggleLike() {
        if (busy)
            return;
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
            }
            else {
                await likeReel(reel.id);
                onChange({
                    ...reel,
                    likes: [{ id: 'me' }],
                    _count: { ...reel._count, likes: (reel._count?.likes ?? 0) + 1 }
                });
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function openComments() {
        setShowComments(true);
        if (comments)
            return;
        try {
            const rows = await fetchReelComments(reel.id);
            setComments(Array.isArray(rows) ? rows : []);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
            setComments([]);
        }
    }
    async function submitComment(e) {
        e.preventDefault();
        if (!commentText.trim() || busy || reel.commentsDisabled)
            return;
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function removeComment(commentId) {
        if (busy)
            return;
        setBusy(true);
        try {
            await deleteReelComment(reel.id, commentId);
            setComments((list) => (list || []).filter((c) => c.id !== commentId));
            onChange({
                ...reel,
                _count: { ...reel._count, comments: Math.max(0, (reel._count?.comments ?? 1) - 1) }
            });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    const postedAt = formatPostDate(reel.createdAt);
    return (_jsxs("article", { ref: rootRef, className: "post-card feed-reel-card feed-edge", children: [_jsxs("header", { className: "post-header", children: [_jsxs(Link, { to: `/u/${authorName}`, className: "post-author", children: [_jsx(UserAvatar, { size: "md", name: display, username: authorName, avatarUrl: reel.author?.avatarUrl }), _jsxs("span", { className: "post-author-text", children: [_jsx("strong", { className: "post-display-name", children: display }), _jsxs("span", { className: "muted tiny post-username", children: ["@", authorName, " \u00B7 ", t('reels')] })] })] }), _jsxs("div", { className: "post-header-end", children: [postedAt ? _jsx("time", { className: "post-date muted tiny", children: postedAt }) : null, _jsxs("div", { className: "post-menu-wrap", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": t('more'), onClick: () => setMenuOpen((v) => !v), children: _jsx(IconMore, { size: 18 }) }), menuOpen ? (_jsxs("div", { className: "post-menu", role: "menu", children: [isOwner ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => {
                                                            setMenuOpen(false);
                                                            setEditOpen(true);
                                                        }, children: t('edit') }), _jsx("button", { type: "button", onClick: () => void setReelCommentsDisabled(reel.id, !reel.commentsDisabled)
                                                            .then(() => {
                                                            onChange({ ...reel, commentsDisabled: !reel.commentsDisabled });
                                                            setMenuOpen(false);
                                                        })
                                                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: reel.commentsDisabled ? t('enableComments') : t('disableComments') }), _jsx("button", { type: "button", onClick: () => void archiveReel(reel.id, true)
                                                            .then(() => {
                                                            push(t('archived'), 'success');
                                                            setMenuOpen(false);
                                                            onRemoved?.(reel.id);
                                                            window.dispatchEvent(new CustomEvent('content:archived', {
                                                                detail: { kind: 'reel', id: reel.id }
                                                            }));
                                                        })
                                                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('archive') }), _jsx("button", { type: "button", onClick: () => void requestDownloadUrl('reel', reel.id)
                                                            .then(({ secureUrl }) => {
                                                            const a = document.createElement('a');
                                                            a.href = secureUrl;
                                                            a.download = `reel-${reel.id}.mp4`;
                                                            a.rel = 'noopener';
                                                            a.target = '_blank';
                                                            a.click();
                                                            setMenuOpen(false);
                                                        })
                                                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('download') })] })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => void recordContentSignal({
                                                            targetType: 'reel',
                                                            targetId: reel.id,
                                                            signal: 'more_like_this'
                                                        })
                                                            .then(() => {
                                                            push(t('preferenceSaved'), 'success');
                                                            setMenuOpen(false);
                                                        })
                                                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('showMoreLikeThis') }), _jsx("button", { type: "button", onClick: () => void recordContentSignal({
                                                            targetType: 'reel',
                                                            targetId: reel.id,
                                                            signal: 'not_interested'
                                                        })
                                                            .then(() => {
                                                            push(t('preferenceSaved'), 'success');
                                                            setMenuOpen(false);
                                                            onRemoved?.(reel.id);
                                                        })
                                                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('notInterested') }), _jsx("button", { type: "button", onClick: () => void requestDownloadUrl('reel', reel.id)
                                                            .then(({ secureUrl }) => {
                                                            const a = document.createElement('a');
                                                            a.href = secureUrl;
                                                            a.download = `reel-${reel.id}.mp4`;
                                                            a.rel = 'noopener';
                                                            a.target = '_blank';
                                                            a.click();
                                                            setMenuOpen(false);
                                                        })
                                                            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric'))), children: t('download') })] })), _jsx("button", { type: "button", onClick: () => setMenuOpen(false), children: t('close') })] })) : null] })] })] }), _jsx("div", { className: "post-media feed-reel-media", children: _jsx(FeedMediaPlayer, { mode: "reel", aspectRatio: reel.aspectRatio, items: [
                        {
                            mediaId: media?.id || reel.mediaId,
                            media: media
                                ? { ...media, mimeType: media.mimeType || 'video/mp4' }
                                : { id: reel.mediaId, mimeType: 'video/mp4' }
                        }
                    ] }) }), _jsxs("div", { className: "post-footer-block", children: [_jsxs("div", { className: "post-actions ig-post-actions", children: [_jsxs("div", { className: "post-actions-start", children: [_jsxs("button", { type: "button", className: `action-btn ${liked ? 'active like' : ''}`, onClick: () => void toggleLike(), disabled: busy, "aria-label": t('like'), children: [_jsx(IconHeart, { size: 24, filled: liked }), _jsx("span", { className: "action-count", children: reel._count?.likes ?? 0 })] }), _jsxs("button", { type: "button", className: `action-btn${reel.commentsDisabled ? ' is-disabled' : ''}`, disabled: reel.commentsDisabled, title: reel.commentsDisabled ? t('commentsOff') : undefined, onClick: () => {
                                            if (reel.commentsDisabled)
                                                return;
                                            setShareOpen(false);
                                            void openComments();
                                        }, "aria-label": reel.commentsDisabled ? t('commentsOffBtn') : t('comments'), children: [_jsx(IconComment, { size: 24 }), _jsx("span", { className: "action-count", children: reel._count?.comments ?? 0 })] }), _jsxs("button", { type: "button", className: "action-btn", onClick: () => {
                                            setShowComments(false);
                                            setShareOpen(true);
                                        }, "aria-label": t('share'), children: [_jsx(IconSend, { size: 24 }), _jsx("span", { className: "action-count", children: reel.shareCount ?? 0 })] })] }), _jsx("div", { className: "post-actions-end", children: _jsx("button", { type: "button", className: `action-btn action-bookmark ${saved ? 'active' : ''}`, "aria-label": t('save'), "aria-pressed": saved, onClick: () => {
                                        const next = toggleSavedReel(reel.id);
                                        setSaved(next);
                                        push(next ? t('save') : t('unsave'), 'success');
                                    }, children: _jsx(IconBookmark, { size: 24, filled: saved }) }) })] }), _jsxs("div", { className: "post-views-row", "aria-label": t('views'), children: [_jsx(IconEye, { size: 16 }), _jsx("span", { children: viewCount })] }), reel.caption ? _jsx("p", { className: "post-caption", children: reel.caption }) : null] }), error ? _jsx("p", { className: "form-error", children: error }) : null, editOpen ? (_jsx(ContentEditModal, { kind: "reel", item: reel, onClose: () => setEditOpen(false), onSaved: (next) => {
                    onChange(next);
                    push(t('changesSaved'), 'success');
                } })) : null, showComments && !shareOpen ? (_jsx("div", { className: "sheet-overlay", role: "dialog", "aria-modal": "true", children: _jsxs("div", { className: "share-panel sheet-dialog comments-sheet reel-comments-panel", children: [_jsxs("div", { className: "reel-sheet-head", children: [_jsx("strong", { children: t('comments') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setShowComments(false), children: t('close') })] }), comments && comments.length > 0 ? (_jsx(CommentThread, { comments: comments, ...(me ? { me } : {}), ...(typeof reel.authorId === 'string' ? { ownerId: reel.authorId } : {}), ...(typeof reel.commentsDisabled === 'boolean'
                                ? { commentsDisabled: reel.commentsDisabled }
                                : {}), busy: busy, onReply: (parentId, username) => {
                                setReplyToId(parentId);
                                setCommentText(`@${username} `);
                            }, onDelete: (id) => void removeComment(id) })) : null, !reel.commentsDisabled ? (_jsxs("form", { className: "reel-sheet-composer", onSubmit: (e) => void submitComment(e), children: [replyToId ? (_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setReplyToId(null), children: t('cancel') })) : null, _jsx("input", { value: commentText, onChange: (e) => setCommentText(e.target.value), placeholder: replyToId ? t('reply') : t('addComment'), maxLength: 500 }), _jsx("button", { type: "submit", className: "button button-compact", disabled: busy || !commentText.trim(), children: t('send') })] })) : null] }) })) : null, shareOpen && !showComments ? (_jsx("div", { className: "sheet-overlay", role: "dialog", "aria-modal": "true", children: _jsx(SharePeoplePanel, { targetType: "reel", targetId: reel.id, className: "sheet-dialog reel-share-panel", onClose: () => setShareOpen(false), onShared: (shareCount) => {
                        if (typeof shareCount !== 'number')
                            return;
                        onChange({ ...reel, shareCount });
                    } }) })) : null] }));
}
export function isFeedReel(item) {
    if (!item)
        return false;
    if (item.kind === 'reel')
        return true;
    if (item.kind === 'post')
        return false;
    return Boolean(item.mediaId && item.media && !Array.isArray(item.media));
}
