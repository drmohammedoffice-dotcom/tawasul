import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPost, fetchReel, resolveMediaUrl } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { IconMore, IconSendArrow } from './Icons';
import { UserAvatar } from './UserAvatar';
const SHARE_RE = /^\[share:(post|reel|story):([^\]]+)\]\s*(.*)$/s;
export function parseShareContent(text) {
    const m = String(text || '').match(SHARE_RE);
    if (!m)
        return null;
    const url = (m[3] || '').trim();
    return {
        targetType: m[1],
        targetId: m[2],
        ...(url ? { url } : {})
    };
}
export function sharePreviewLabel(text, sharedLabel) {
    const share = parseShareContent(text);
    if (!share)
        return null;
    return sharedLabel;
}
export function ShareContentBubble({ payload, mine, sentAt, showDate, onToggleDate, onReply, onDelete, onForward }) {
    const { t, locale } = useI18n();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [data, setData] = useState(null);
    const [posterFailed, setPosterFailed] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        setData(null);
        setPosterFailed(false);
        const run = payload.targetType === 'post'
            ? fetchPost(payload.targetId)
            : payload.targetType === 'reel'
                ? fetchReel(payload.targetId)
                : Promise.reject(new Error('unsupported'));
        void run
            .then((row) => {
            if (!cancelled)
                setData(row);
        })
            .catch((err) => {
            if (!cancelled)
                setError(err instanceof Error ? err.message : t('errorGeneric'));
        })
            .finally(() => {
            if (!cancelled)
                setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [payload.targetId, payload.targetType, t]);
    const author = data?.author;
    const username = author?.username || 'user';
    const display = author?.displayName || username;
    const media = payload.targetType === 'reel'
        ? data?.media
        : data?.media?.[0]?.media || data?.media?.[0];
    const mime = String(media?.mimeType || '');
    const isVideo = payload.targetType === 'reel' || mime.startsWith('video/');
    // Never use video secureUrl as <img> — causes broken-image glyph
    const posterCandidate = media?.posterUrl || media?.thumbnailUrl
        ? resolveMediaUrl(media?.posterUrl || media?.thumbnailUrl)
        : !isVideo && media?.secureUrl
            ? resolveMediaUrl(media.secureUrl)
            : null;
    const poster = posterFailed ? null : posterCandidate;
    const href = payload.targetType === 'reel'
        ? `/reels?id=${encodeURIComponent(payload.targetId)}`
        : payload.targetType === 'post'
            ? `/p/${encodeURIComponent(payload.targetId)}`
            : payload.url || '#';
    const dateLabel = (() => {
        if (!sentAt)
            return '';
        try {
            return new Date(sentAt).toLocaleString(locale, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        catch {
            return sentAt;
        }
    })();
    return (_jsxs("div", { className: `share-content-bubble${mine ? ' is-mine' : ''}${isVideo ? ' is-video' : ''}`, onClick: (e) => {
            // Empty frame / chrome (not media/link) → toggle send date
            if (e.target.closest('.share-content-media, .share-content-head, a, button')) {
                return;
            }
            e.stopPropagation();
            onToggleDate?.();
        }, children: [_jsxs("div", { className: "share-content-toolbar", children: [_jsx("button", { type: "button", className: "share-content-more", "aria-label": t('more'), onClick: (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMenuOpen((v) => !v);
                        }, children: _jsx(IconMore, { size: 18 }) }), menuOpen ? (_jsxs("div", { className: "share-content-menu", role: "menu", onClick: (e) => e.stopPropagation(), children: [onReply ? (_jsx("button", { type: "button", role: "menuitem", onClick: () => {
                                    setMenuOpen(false);
                                    onReply();
                                }, children: t('reply') })) : null, onDelete ? (_jsx("button", { type: "button", role: "menuitem", onClick: () => {
                                    setMenuOpen(false);
                                    onDelete();
                                }, children: t('delete') })) : null, _jsx("button", { type: "button", role: "menuitem", onClick: () => setMenuOpen(false), children: t('close') })] })) : null] }), _jsxs(Link, { to: `/u/${username}`, className: "share-content-head", onClick: (e) => e.stopPropagation(), children: [_jsx(UserAvatar, { size: "sm", name: display, username: username, avatarUrl: author?.avatarUrl }), _jsxs("div", { className: "share-content-author", children: [_jsx("strong", { children: display }), _jsxs("span", { children: ["@", username] })] })] }), _jsxs("div", { className: "share-content-media", children: [_jsxs(Link, { to: href, className: "share-content-media-link", onClick: (e) => e.stopPropagation(), children: [loading ? (_jsx("div", { className: "share-content-skeleton" })) : error || !poster ? (_jsx("div", { className: "share-content-fallback", children: payload.targetType === 'reel' ? t('reels') : t('posts') })) : (_jsx("img", { src: poster, alt: "", loading: "lazy", onError: () => setPosterFailed(true) })), isVideo && !loading ? (_jsx("span", { className: "share-content-play", "aria-hidden": true, children: "\u25B6" })) : null, payload.targetType === 'reel' ? (_jsx("span", { className: "share-content-reel-badge", "aria-hidden": true, children: "\u25B7" })) : null] }), onForward ? (_jsx("button", { type: "button", className: "share-content-forward", "aria-label": t('share'), title: t('share'), onClick: (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onForward();
                        }, children: _jsx(IconSendArrow, { size: 22 }) })) : null] }), data?.caption ? (_jsx("p", { className: "share-content-caption", children: String(data.caption).slice(0, 120) })) : null, showDate && dateLabel ? (_jsxs("p", { className: "share-content-sent muted tiny", children: [t('sendDate'), ": ", dateLabel] })) : null] }));
}
