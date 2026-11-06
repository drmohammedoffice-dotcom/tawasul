import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiData, resolveApiBaseUrl } from '@/api/http';
import { resolveMediaUrl } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
async function refreshSecureUrl(mediaId) {
    try {
        const data = await apiData(`/media/${mediaId}/url`);
        return resolveMediaUrl(data.secureUrl);
    }
    catch {
        return null;
    }
}
export function MediaFrame({ mediaId, secureUrl, posterUrl, mimeType, alt = '', eager = false, variant = 'feed', processingStatus, playable = true, controls = true, muted = true, autoPlay = false, className = '', onMediaReady }) {
    const { t } = useI18n();
    const [url, setUrl] = useState(() => resolveMediaUrl(secureUrl));
    const [poster, setPoster] = useState(() => resolveMediaUrl(posterUrl));
    const [phase, setPhase] = useState(() => {
        if (processingStatus && processingStatus !== 'ready' && !playable)
            return 'processing';
        if (!secureUrl && !mediaId)
            return 'error';
        return 'loading';
    });
    const retried = useRef(false);
    const videoRef = useRef(null);
    useEffect(() => {
        setUrl(resolveMediaUrl(secureUrl));
        setPoster(resolveMediaUrl(posterUrl));
        retried.current = false;
        if (processingStatus && processingStatus !== 'ready' && !playable) {
            setPhase('processing');
        }
        else if (secureUrl || mediaId) {
            setPhase('loading');
        }
        else {
            setPhase('error');
        }
    }, [secureUrl, posterUrl, mediaId, processingStatus, playable]);
    // Proactively resolve signed URL when only mediaId is known (avoid false "unavailable").
    useEffect(() => {
        if (!mediaId || resolveMediaUrl(secureUrl))
            return;
        let cancelled = false;
        void (async () => {
            const next = await refreshSecureUrl(mediaId);
            if (cancelled)
                return;
            if (next) {
                setUrl(next);
                setPhase('loading');
            }
            else if (!secureUrl) {
                setPhase('error');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [mediaId, secureUrl]);
    const fail = useCallback(async () => {
        if (mediaId && !retried.current) {
            retried.current = true;
            const next = await refreshSecureUrl(mediaId);
            if (next) {
                setUrl(next);
                setPhase('loading');
                return;
            }
        }
        setPhase('error');
    }, [mediaId]);
    const isVideo = String(mimeType || '').startsWith('video/') || variant === 'reel';
    const gridVideo = isVideo && variant === 'grid';
    const gridAutoplay = gridVideo && autoPlay;
    const viewportAutoplay = (gridAutoplay || (autoPlay && (variant === 'reel' || variant === 'feed') && isVideo)) && !!url;
    useEffect(() => {
        if (!viewportAutoplay)
            return;
        const el = videoRef.current;
        if (!el)
            return;
        const threshold = gridAutoplay ? 0.45 : 0.55;
        const io = new IntersectionObserver((entries) => {
            const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= threshold);
            if (visible) {
                el.muted = muted || gridAutoplay;
                void el.play().catch(() => undefined);
            }
            else {
                el.pause();
            }
        }, { threshold: [0, threshold, 0.75], rootMargin: '40px' });
        io.observe(el);
        return () => {
            io.disconnect();
            el.pause();
        };
    }, [viewportAutoplay, gridAutoplay, url, muted]);
    if (phase === 'processing') {
        return (_jsx("div", { className: `media-frame media-${variant} media-processing ${className}`.trim(), children: _jsxs("div", { className: "media-status", children: [_jsx("div", { className: "spinner" }), _jsx("span", { children: t('reelProcessing') })] }) }));
    }
    if (phase === 'error') {
        return (_jsxs("div", { className: `media-frame media-${variant} media-fallback ${className}`.trim(), children: [isVideo ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "media-video-badge", "aria-hidden": true, children: "\u25B6" }), _jsx("span", { children: t('videoUnavailable') })] })) : (_jsx("span", { children: t('mediaMissing') })), mediaId ? (_jsx("button", { type: "button", className: "button button-compact button-ghost", onClick: () => {
                        retried.current = false;
                        setPhase('loading');
                        void (async () => {
                            const next = await refreshSecureUrl(mediaId);
                            if (next)
                                setUrl(next);
                            else
                                setPhase('error');
                        })();
                    }, children: t('retry') })) : null] }));
    }
    if (!url) {
        return (_jsx("div", { className: `media-frame media-${variant} is-loading ${className}`.trim(), children: _jsx("div", { className: "media-skeleton shimmer", "aria-hidden": true }) }));
    }
    return (_jsxs("div", { className: `media-frame media-${variant} ${phase === 'loading' ? 'is-loading' : ''} ${gridVideo ? 'media-grid-video' : ''} ${className}`.trim(), children: [phase === 'loading' ? _jsx("div", { className: "media-skeleton shimmer", "aria-hidden": true }) : null, isVideo ? (_jsxs(_Fragment, { children: [poster && gridVideo && !gridAutoplay ? (_jsx("img", { className: "media-poster", src: poster, alt: alt, loading: "eager", decoding: "async", onLoad: () => setPhase('ready'), onError: () => setPoster(null) })) : (_jsx("video", { ref: videoRef, src: url, poster: poster || undefined, controls: controls && !gridVideo, playsInline: true, muted: muted || gridAutoplay, loop: gridAutoplay, autoPlay: autoPlay && !gridVideo, preload: gridAutoplay ? 'auto' : 'metadata', onLoadedData: (e) => {
                            setPhase('ready');
                            onMediaReady?.(e.currentTarget);
                        }, onError: () => void fail() }, url)), gridVideo ? (_jsx("span", { className: "media-video-badge", "aria-hidden": true, children: "\u25B6" })) : null] })) : (_jsx("img", { src: url, alt: alt, loading: eager || variant === 'feed' || variant === 'grid' ? 'eager' : 'lazy', decoding: "async", onLoad: (e) => {
                    setPhase('ready');
                    onMediaReady?.(e.currentTarget);
                }, onError: () => void fail() }, url))] }));
}
export function absoluteApiUrl(path) {
    if (/^https?:\/\//i.test(path))
        return path;
    const origin = resolveApiBaseUrl().replace(/\/api\/?$/, '');
    return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}
