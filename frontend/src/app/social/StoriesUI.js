import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteStory, fetchStoryInsights, reactToStory, replyToStory, viewStory } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { MediaFrame } from '../ui/MediaFrame';
import { UserAvatar } from '../ui/UserAvatar';
import { useToast } from '../ui/Toast';
import { StoryStudio } from './StoryStudio';
const STORY_MS = 5000;
const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🔥', '👏'];
export function StoriesRail({ stories, onChanged }) {
    const { t } = useI18n();
    const { push } = useToast();
    const me = getSessionSnapshot()?.user?.id;
    const meUser = getSessionSnapshot()?.user;
    const [composeOpen, setComposeOpen] = useState(false);
    const [viewer, setViewer] = useState(null);
    const [error, setError] = useState('');
    const [paused, setPaused] = useState(false);
    const [progress, setProgress] = useState(0);
    const [seenIds, setSeenIds] = useState(() => new Set());
    const [sheetOpen, setSheetOpen] = useState(false);
    const [insights, setInsights] = useState(null);
    const [insightsLoading, setInsightsLoading] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [replyBusy, setReplyBusy] = useState(false);
    const [stickersOpen, setStickersOpen] = useState(false);
    const timerRef = useRef(null);
    const startedAt = useRef(0);
    const remainRef = useRef(STORY_MS);
    const touchStartY = useRef(null);
    const grouped = useMemo(() => {
        const map = new Map();
        for (const s of stories) {
            const key = s.authorId || s.author?.id;
            if (!key)
                continue;
            const list = map.get(key) ?? [];
            list.push(s);
            map.set(key, list);
        }
        return [...map.entries()].map(([authorId, list]) => {
            // Instagram-style: oldest → newest within an author's stack
            const ordered = [...list].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
            return {
                authorId,
                author: ordered[0]?.author,
                stories: ordered,
                unseen: ordered.some((x) => !seenIds.has(x.id) &&
                    (!Array.isArray(x.views) ||
                        x.views.length === 0 ||
                        !x.views.some((v) => v.viewerId === me)))
            };
        });
    }, [stories, seenIds, me]);
    const activeGroup = viewer ? grouped.find((g) => g.authorId === viewer.authorId) : null;
    const stack = activeGroup?.stories ?? [];
    const active = viewer != null ? stack[viewer.index] : null;
    const isOwner = Boolean(me && active && active.authorId === me);
    const viewCount = insights?.viewCount ?? active?._count?.views ?? (Array.isArray(active?.views) ? active.views.length : 0);
    async function markViewed(story) {
        if (!story?.id)
            return;
        setSeenIds((prev) => new Set(prev).add(story.id));
        try {
            await viewStory(story.id);
        }
        catch {
            /* expired */
        }
    }
    async function loadInsights(storyId) {
        setInsightsLoading(true);
        try {
            setInsights(await fetchStoryInsights(storyId));
        }
        catch {
            setInsights(null);
        }
        finally {
            setInsightsLoading(false);
        }
    }
    async function openAuthor(authorId) {
        setSheetOpen(false);
        setInsights(null);
        setReplyText('');
        setStickersOpen(false);
        setViewer({ authorId, index: 0 });
        setProgress(0);
        remainRef.current = STORY_MS;
        setPaused(false);
        const g = grouped.find((x) => x.authorId === authorId);
        const first = g?.stories?.[0];
        await markViewed(first);
        if (me && first?.authorId === me)
            void loadInsights(first.id);
    }
    function clearTimer() {
        if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }
    useEffect(() => {
        if (!viewer || paused || sheetOpen || !active) {
            clearTimer();
            return;
        }
        startedAt.current = Date.now();
        clearTimer();
        timerRef.current = window.setInterval(() => {
            const elapsed = Date.now() - startedAt.current;
            const left = remainRef.current - elapsed;
            const pct = Math.min(100, ((remainRef.current - left) / remainRef.current) * 100);
            setProgress(pct);
            if (left <= 0) {
                clearTimer();
                remainRef.current = STORY_MS;
                setProgress(0);
                advanceStory();
            }
        }, 50);
        return clearTimer;
    }, [viewer?.authorId, viewer?.index, paused, sheetOpen, active?.id, grouped, me]);
    useEffect(() => {
        if (!active?.id || !isOwner)
            return;
        void loadInsights(active.id);
    }, [active?.id, isOwner]);
    function hold(down) {
        if (sheetOpen)
            return;
        if (down) {
            const elapsed = Date.now() - startedAt.current;
            remainRef.current = Math.max(200, remainRef.current - elapsed);
            setPaused(true);
        }
        else {
            setPaused(false);
        }
    }
    /** Newer story / next author (physical left in RTL story UI). */
    function advanceStory() {
        setProgress(0);
        remainRef.current = STORY_MS;
        setViewer((v) => {
            if (!v)
                return null;
            const gi = grouped.findIndex((x) => x.authorId === v.authorId);
            const g = gi >= 0 ? grouped[gi] : null;
            if (!g)
                return null;
            if (v.index < g.stories.length - 1) {
                const next = g.stories[v.index + 1];
                void markViewed(next);
                if (me && next?.authorId === me)
                    void loadInsights(next.id);
                return { ...v, index: v.index + 1 };
            }
            const nextGroup = grouped[gi + 1];
            if (!nextGroup?.stories.length)
                return null;
            const first = nextGroup.stories[0];
            void markViewed(first);
            if (me && first?.authorId === me)
                void loadInsights(first.id);
            return { authorId: nextGroup.authorId, index: 0 };
        });
    }
    /** Older story / previous author (physical right). */
    function retreatStory() {
        setProgress(0);
        remainRef.current = STORY_MS;
        setViewer((v) => {
            if (!v)
                return null;
            const gi = grouped.findIndex((x) => x.authorId === v.authorId);
            const g = gi >= 0 ? grouped[gi] : null;
            if (!g)
                return null;
            if (v.index > 0) {
                const prev = g.stories[v.index - 1];
                void markViewed(prev);
                if (me && prev?.authorId === me)
                    void loadInsights(prev.id);
                return { ...v, index: v.index - 1 };
            }
            const prevGroup = grouped[gi - 1];
            if (!prevGroup?.stories.length)
                return null;
            const lastIdx = prevGroup.stories.length - 1;
            const last = prevGroup.stories[lastIdx];
            void markViewed(last);
            if (me && last?.authorId === me)
                void loadInsights(last.id);
            return { authorId: prevGroup.authorId, index: lastIdx };
        });
    }
    async function removeActive() {
        if (!active)
            return;
        try {
            await deleteStory(active.id);
            setViewer(null);
            onChanged();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    async function sendReply(e) {
        e?.preventDefault();
        if (!active?.id || !replyText.trim())
            return;
        setReplyBusy(true);
        try {
            await replyToStory(active.id, replyText.trim());
            setReplyText('');
            push(t('storyReplySent'), 'success');
            if (isOwner)
                await loadInsights(active.id);
        }
        catch (err) {
            push(err instanceof Error ? err.message : t('errorGeneric'), 'error');
        }
        finally {
            setReplyBusy(false);
        }
    }
    async function sendReaction(emoji) {
        if (!active?.id)
            return;
        try {
            await reactToStory(active.id, emoji);
            setStickersOpen(false);
            push(t('storyReacted'), 'success');
            if (isOwner)
                await loadInsights(active.id);
        }
        catch (err) {
            push(err instanceof Error ? err.message : t('errorGeneric'), 'error');
        }
    }
    function openSheet() {
        if (!isOwner || !active)
            return;
        setSheetOpen(true);
        setPaused(true);
        void loadInsights(active.id);
    }
    function closeSheet() {
        setSheetOpen(false);
        setPaused(false);
    }
    return (_jsxs("section", { className: "stories-row-wrap ig-stories", children: [_jsxs("div", { className: "stories-row", children: [_jsxs("button", { type: "button", className: "story-chip own", onClick: () => setComposeOpen(true), children: [_jsxs("span", { className: "story-avatar-wrap", children: [_jsx(UserAvatar, { size: "lg", name: meUser?.displayName ?? meUser?.username, username: meUser?.username ?? null, avatarUrl: meUser?.avatarUrl ?? null }), _jsx("span", { className: "story-add-badge", children: "+" })] }), _jsx("span", { children: t('yourStory') })] }), grouped.map((g) => (_jsxs("button", { type: "button", className: `story-chip ${g.unseen ? 'unseen' : 'seen'}`, onClick: () => void openAuthor(g.authorId), children: [_jsx(UserAvatar, { size: "lg", name: g.author?.displayName, username: g.author?.username, avatarUrl: g.author?.avatarUrl, ring: g.unseen ? 'story' : 'story-seen' }), _jsxs("span", { children: ["@", g.author?.username || 'user'] })] }, g.authorId)))] }), error && !composeOpen ? _jsx("p", { className: "auth-error", children: error }) : null, composeOpen ? (_jsx("div", { className: "story-compose-sheet story-studio-overlay", role: "dialog", "aria-modal": "true", children: _jsx(StoryStudio, { onCancel: () => setComposeOpen(false), onDone: () => {
                        push(t('storyUploaded'), 'success');
                        setComposeOpen(false);
                        onChanged();
                    } }) })) : null, active ? (_jsxs("div", { className: "ig-story-viewer", role: "dialog", "aria-modal": "true", onTouchStart: (e) => {
                    touchStartY.current = e.touches[0]?.clientY ?? null;
                }, onTouchEnd: (e) => {
                    const start = touchStartY.current;
                    touchStartY.current = null;
                    if (start == null || !isOwner)
                        return;
                    const end = e.changedTouches[0]?.clientY ?? start;
                    if (start - end > 70)
                        openSheet();
                }, children: [_jsxs("div", { className: "ig-story-stage", children: [_jsx("div", { className: "story-progress-bars ig-story-progress", children: stack.map((s, i) => (_jsx("div", { className: "story-progress-seg", children: _jsx("div", { className: "story-progress-fill", style: {
                                            width: viewer != null && i < viewer.index
                                                ? '100%'
                                                : i === viewer?.index
                                                    ? `${progress}%`
                                                    : '0%'
                                        } }) }, s.id || i))) }), _jsxs("div", { className: "ig-story-top", children: [_jsxs("div", { className: "story-nav-user", children: [_jsx(UserAvatar, { size: "sm", name: active.author?.displayName, username: active.author?.username, avatarUrl: active.author?.avatarUrl }), _jsxs("strong", { children: ["@", active.author?.username] })] }), _jsxs("div", { className: "inline-actions", children: [isOwner ? (_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => void removeActive(), children: t('delete') })) : null, _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setViewer(null), children: t('close') })] })] }), _jsx("div", { className: "ig-story-media", onPointerDown: () => hold(true), onPointerUp: () => hold(false), onPointerLeave: () => hold(false), onClick: (e) => {
                                    if (sheetOpen)
                                        return;
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const x = e.clientX - rect.left;
                                    // Left → newer / next author; Right → older / previous author
                                    if (x < rect.width * 0.5)
                                        advanceStory();
                                    else
                                        retreatStory();
                                }, children: _jsx(MediaFrame, { mediaId: active.media?.id, secureUrl: active.media?.secureUrl, mimeType: active.media?.mimeType, processingStatus: active.media?.processingStatus, variant: "story", eager: true, controls: false, autoPlay: true, muted: false }) }), isOwner ? (_jsxs("button", { type: "button", className: "ig-story-views-bar", onClick: openSheet, children: [_jsx("span", { children: "\u25B4" }), _jsxs("strong", { children: [viewCount, " ", t('views')] }), _jsx("span", { className: "muted tiny", children: t('storySwipeUpHint') })] })) : (_jsxs("div", { className: "ig-story-viewer-footer", children: [stickersOpen ? (_jsx("div", { className: "sticker-library ig-story-stickers", children: REACTION_EMOJIS.map((e) => (_jsx("button", { type: "button", className: "sticker-btn", onClick: () => void sendReaction(e), children: e }, e))) })) : null, _jsxs("form", { className: "ig-story-reply-row", onSubmit: (e) => void sendReply(e), children: [_jsx("button", { type: "button", className: "composer-icon-btn", "aria-label": t('stickers'), onClick: () => setStickersOpen((v) => !v), children: "\uD83D\uDE0A" }), _jsx("input", { value: replyText, onChange: (e) => setReplyText(e.target.value), placeholder: t('storyReplyPlaceholder'), dir: "auto", onFocus: () => setPaused(true), onBlur: () => {
                                                    if (!sheetOpen)
                                                        setPaused(false);
                                                } }), _jsx("button", { className: "button button-compact", type: "submit", disabled: replyBusy || !replyText.trim(), children: t('send') })] })] }))] }), sheetOpen && isOwner ? (_jsxs("div", { className: "ig-story-sheet", role: "dialog", "aria-modal": "true", children: [_jsx("button", { type: "button", className: "ig-sheet-handle", onClick: closeSheet, "aria-label": t('close'), children: _jsx("span", {}) }), _jsxs("div", { className: "ig-sheet-head", children: [_jsxs("strong", { children: [viewCount, " ", t('views')] }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: closeSheet, children: t('close') })] }), insightsLoading ? _jsx("p", { className: "muted pad-inline", children: t('loading') }) : null, _jsxs("div", { className: "ig-sheet-section", children: [_jsx("h3", { children: t('storyViewers') }), (insights?.viewers || []).length === 0 ? (_jsx("p", { className: "muted tiny", children: t('noStoryViewers') })) : ((insights?.viewers || []).map((v) => (_jsxs("div", { className: "ig-viewer-row", children: [_jsx(UserAvatar, { size: "sm", name: v.user?.displayName, username: v.user?.username, avatarUrl: v.user?.avatarUrl }), _jsx("span", { className: "ig-viewer-meta", children: _jsxs("strong", { children: ["@", v.user?.username] }) }), v.reaction ? _jsx("span", { className: "ig-viewer-react", children: v.reaction }) : null] }, v.id))))] }), _jsxs("div", { className: "ig-sheet-section", children: [_jsx("h3", { children: t('storyReplies') }), (insights?.replies || []).length === 0 ? (_jsx("p", { className: "muted tiny", children: t('noStoryReplies') })) : ((insights?.replies || []).map((r) => (_jsxs("div", { className: "ig-reply-row", children: [_jsx(UserAvatar, { size: "sm", name: r.author?.displayName, username: r.author?.username, avatarUrl: r.author?.avatarUrl }), _jsxs("div", { children: [_jsxs("strong", { children: ["@", r.author?.username] }), _jsx("p", { dir: "auto", children: r.body })] })] }, r.id))))] })] })) : null] })) : null] }));
}
