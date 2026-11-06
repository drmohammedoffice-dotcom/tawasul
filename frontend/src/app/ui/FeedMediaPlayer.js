import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiData } from '@/api/http';
import { resolveMediaUrl } from '@/api/social';
import { postFeedAspect, reelFeedAspect } from '@/lib/mediaAspect';
import { useI18n } from '@/i18n/I18nProvider';
import { IconScreenRotate } from './Icons';
function isVideoMime(mime, forceReel) {
    return forceReel || String(mime || '').startsWith('video/');
}
function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0)
        return '0:00';
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
}
async function refreshUrl(mediaId) {
    try {
        const data = await apiData(`/media/${mediaId}/url`);
        return resolveMediaUrl(data.secureUrl);
    }
    catch {
        return null;
    }
}
function resolveDims(media, natural) {
    if (media?.width && media?.height)
        return { w: media.width, h: media.height };
    if (natural?.w && natural?.h)
        return natural;
    return { w: 0, h: 0 };
}
function videoDuration(el, fallback) {
    if (!el)
        return fallback;
    const d = el.duration;
    if (Number.isFinite(d) && d > 0)
        return d;
    return fallback > 0 ? fallback : 0;
}
export function FeedMediaPlayer({ items: rawItems, mode = 'post', aspectRatio: storedAspect, className = '' }) {
    const { t } = useI18n();
    const items = [...rawItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const [idx, setIdx] = useState(0);
    const safeIdx = Math.min(idx, Math.max(0, items.length - 1));
    const row = items[safeIdx];
    const media = row?.media;
    const mediaId = row?.mediaId || media?.id;
    const forceReel = mode === 'reel';
    const video = isVideoMime(media?.mimeType, forceReel);
    const [url, setUrl] = useState(() => resolveMediaUrl(media?.secureUrl));
    const [poster, setPoster] = useState(() => resolveMediaUrl(media?.posterUrl || media?.thumbnailUrl));
    const [natural, setNatural] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(true);
    const [showTools, setShowTools] = useState(false);
    const [boosting, setBoosting] = useState(false);
    const [duration, setDuration] = useState(0);
    const [current, setCurrent] = useState(0);
    const [scrubbing, setScrubbing] = useState(false);
    const [scrubPreview, setScrubPreview] = useState(null);
    /** 0 = normal, -90 = rotated left once */
    const [rotationDeg, setRotationDeg] = useState(0);
    const videoRef = useRef(null);
    const stageRef = useRef(null);
    const seekBarRef = useRef(null);
    const toolsTimer = useRef(null);
    const wasPlaying = useRef(false);
    const scrubbingRef = useRef(false);
    const seekTargetRef = useRef(null);
    const swipe = useRef(null);
    const longPress = useRef({ timer: null, active: false });
    const rateBefore = useRef(1);
    const skipStageToggle = useRef(false);
    useEffect(() => {
        setUrl(resolveMediaUrl(media?.secureUrl));
        setPoster(resolveMediaUrl(media?.posterUrl || media?.thumbnailUrl));
        setNatural(null);
        setCurrent(0);
        setDuration(Number(media?.durationSeconds) || 0);
        setPlaying(false);
        setShowTools(false);
        setScrubbing(false);
        scrubbingRef.current = false;
        setScrubPreview(null);
        setBoosting(false);
        setRotationDeg(0);
        seekTargetRef.current = null;
    }, [media?.secureUrl, media?.posterUrl, media?.thumbnailUrl, media?.durationSeconds, mediaId, safeIdx]);
    useEffect(() => {
        if (!mediaId || resolveMediaUrl(media?.secureUrl))
            return;
        let cancelled = false;
        void refreshUrl(mediaId).then((next) => {
            if (!cancelled && next)
                setUrl(next);
        });
        return () => {
            cancelled = true;
        };
    }, [mediaId, media?.secureUrl]);
    const dims = resolveDims(media, natural);
    const aspect = mode === 'reel'
        ? reelFeedAspect(dims.w, dims.h, storedAspect)
        : postFeedAspect(dims.w, dims.h, storedAspect);
    const arCss = aspect.replace('/', ' / ');
    const revealTools = useCallback(() => {
        setShowTools(true);
        if (toolsTimer.current)
            window.clearTimeout(toolsTimer.current);
        toolsTimer.current = null;
    }, []);
    const hideTools = useCallback(() => {
        setShowTools(false);
        if (toolsTimer.current) {
            window.clearTimeout(toolsTimer.current);
            toolsTimer.current = null;
        }
    }, []);
    useEffect(() => {
        return () => {
            if (toolsTimer.current)
                window.clearTimeout(toolsTimer.current);
            if (longPress.current.timer)
                window.clearTimeout(longPress.current.timer);
        };
    }, []);
    // Keep mute in sync without remounting the IntersectionObserver (avoids seek resets).
    useEffect(() => {
        const el = videoRef.current;
        if (el)
            el.muted = muted;
    }, [muted]);
    // Viewport autoplay for videos / reels
    useEffect(() => {
        if (!video || !url)
            return;
        const el = videoRef.current;
        const stage = stageRef.current;
        if (!el || !stage)
            return;
        el.muted = muted;
        const io = new IntersectionObserver((entries) => {
            if (scrubbingRef.current)
                return;
            const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.55);
            if (visible) {
                el.muted = muted;
                void el
                    .play()
                    .then(() => {
                    // Re-apply seek target if a scrub just finished while IO raced.
                    if (seekTargetRef.current != null && Math.abs(el.currentTime - seekTargetRef.current) > 0.4) {
                        try {
                            el.currentTime = seekTargetRef.current;
                        }
                        catch {
                            /* ignore */
                        }
                    }
                    setPlaying(true);
                    hideTools();
                })
                    .catch(() => setPlaying(false));
            }
            else {
                el.pause();
                setPlaying(false);
                el.playbackRate = 1;
                setBoosting(false);
            }
        }, { threshold: [0, 0.55, 0.75], rootMargin: '40px' });
        io.observe(stage);
        return () => {
            io.disconnect();
            if (!scrubbingRef.current)
                el.pause();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- muted synced in separate effect
    }, [video, url, safeIdx, hideTools]);
    function togglePlay() {
        const el = videoRef.current;
        if (!el)
            return;
        if (el.paused) {
            void el
                .play()
                .then(() => {
                setPlaying(true);
                hideTools();
            })
                .catch(() => undefined);
        }
        else {
            el.pause();
            setPlaying(false);
            revealTools();
        }
    }
    function toggleMute(e) {
        e?.stopPropagation();
        const el = videoRef.current;
        const next = !muted;
        setMuted(next);
        if (el)
            el.muted = next;
        if (!playing)
            revealTools();
    }
    function toggleRotate(e) {
        e?.stopPropagation();
        setRotationDeg((d) => (d === 0 ? -90 : 0));
        if (!playing)
            revealTools();
    }
    function onStagePointerDown(e) {
        if (!video) {
            swipe.current = { x: e.clientX, y: e.clientY, t: Date.now() };
            return;
        }
        const stage = stageRef.current;
        if (!stage)
            return;
        const rect = stage.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;
        const fromRight = relX > 0.55;
        swipe.current = { x: e.clientX, y: e.clientY, t: Date.now() };
        if (fromRight && e.button === 0) {
            longPress.current.timer = window.setTimeout(() => {
                const el = videoRef.current;
                if (!el)
                    return;
                longPress.current.active = true;
                rateBefore.current = el.playbackRate || 1;
                el.playbackRate = 1.5;
                setBoosting(true);
                if (el.paused) {
                    void el
                        .play()
                        .then(() => {
                        setPlaying(true);
                        hideTools();
                    })
                        .catch(() => undefined);
                }
            }, 220);
        }
    }
    function clearBoost() {
        if (longPress.current.timer) {
            window.clearTimeout(longPress.current.timer);
            longPress.current.timer = null;
        }
        if (longPress.current.active) {
            const el = videoRef.current;
            if (el)
                el.playbackRate = rateBefore.current || 1;
            longPress.current.active = false;
            setBoosting(false);
        }
    }
    function onStagePointerUp(e) {
        const start = swipe.current;
        swipe.current = null;
        const boosted = longPress.current.active;
        clearBoost();
        if (!start)
            return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        const dt = Date.now() - start.t;
        if (boosted)
            return;
        if (items.length > 1 && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            if (dx < 0)
                setIdx((i) => Math.min(items.length - 1, i + 1));
            else
                setIdx((i) => Math.max(0, i - 1));
            return;
        }
        if (skipStageToggle.current) {
            skipStageToggle.current = false;
            return;
        }
        if (video && Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 450) {
            // Tap: show tools when pausing; hide when starting play (handled in togglePlay)
            if (!videoRef.current?.paused) {
                revealTools();
            }
            togglePlay();
        }
    }
    function onStagePointerCancel() {
        if (scrubbingRef.current)
            return;
        swipe.current = null;
        clearBoost();
    }
    function seekToClientX(clientX, bar) {
        const el = videoRef.current;
        if (!el || !bar)
            return;
        const dur = videoDuration(el, duration);
        if (!(dur > 0))
            return;
        // Prefer the visible track so padding on the hit area doesn't skew the ratio.
        const track = bar.querySelector('.feed-video-seek-track') || bar;
        const rect = track.getBoundingClientRect();
        if (!(rect.width > 0))
            return;
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const tsec = Math.min(dur - 0.05, Math.max(0, ratio * dur));
        seekTargetRef.current = tsec;
        try {
            el.currentTime = tsec;
        }
        catch {
            /* ignore seek errors while loading */
        }
        setScrubPreview(tsec);
        setCurrent(tsec);
        if (Number.isFinite(el.duration) && el.duration > 0)
            setDuration(el.duration);
    }
    function onSeekPointerDown(e) {
        e.stopPropagation();
        e.preventDefault();
        skipStageToggle.current = true;
        const el = videoRef.current;
        wasPlaying.current = Boolean(el && !el.paused);
        scrubbingRef.current = true;
        el?.pause();
        setPlaying(false);
        setScrubbing(true);
        revealTools();
        try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        catch {
            /* ignore */
        }
        seekToClientX(e.clientX, e.currentTarget);
    }
    function onSeekPointerMove(e) {
        if (!scrubbingRef.current)
            return;
        e.stopPropagation();
        e.preventDefault();
        seekToClientX(e.clientX, e.currentTarget);
    }
    function finishSeek(e) {
        if (!scrubbingRef.current)
            return;
        e.stopPropagation();
        e.preventDefault();
        seekToClientX(e.clientX, e.currentTarget);
        const el = videoRef.current;
        const target = seekTargetRef.current;
        setScrubbing(false);
        setScrubPreview(null);
        const resume = () => {
            scrubbingRef.current = false;
            if (!el) {
                revealTools();
                return;
            }
            if (target != null) {
                try {
                    if (Math.abs(el.currentTime - target) > 0.15)
                        el.currentTime = target;
                }
                catch {
                    /* ignore */
                }
                setCurrent(target);
            }
            if (!wasPlaying.current) {
                revealTools();
                return;
            }
            void el
                .play()
                .then(() => {
                if (target != null && Math.abs(el.currentTime - target) > 0.4) {
                    try {
                        el.currentTime = target;
                    }
                    catch {
                        /* ignore */
                    }
                }
                setPlaying(true);
                hideTools();
            })
                .catch(() => undefined);
        };
        if (el && target != null) {
            let done = false;
            const finish = () => {
                if (done)
                    return;
                done = true;
                el.removeEventListener('seeked', onSeeked);
                resume();
            };
            const onSeeked = () => finish();
            el.addEventListener('seeked', onSeeked);
            try {
                if (Math.abs(el.currentTime - target) > 0.05)
                    el.currentTime = target;
                else
                    finish();
            }
            catch {
                finish();
            }
            window.setTimeout(finish, 800);
        }
        else {
            resume();
        }
    }
    if (!items.length)
        return null;
    const displayTime = scrubPreview ?? current;
    const durForUi = videoDuration(videoRef.current, duration);
    const progress = durForUi > 0 ? (displayTime / durForUi) * 100 : 0;
    const swapped = rotationDeg !== 0;
    const mediaTransform = rotationDeg ? `rotate(${rotationDeg}deg)` : undefined;
    const toolsVisible = showTools || (!playing && video);
    return (_jsx("div", { className: `feed-media-player aspect-${aspect.replace('/', '-')} ${mode} ${swapped ? 'is-rotated-swap' : ''} ${className}`.trim(), style: { aspectRatio: aspect, ['--feed-ar']: arCss }, children: _jsxs("div", { ref: stageRef, className: `feed-media-stage ${video ? 'is-video' : 'is-image'} ${boosting ? 'is-boost' : ''}`, onPointerDown: onStagePointerDown, onPointerUp: onStagePointerUp, onPointerCancel: onStagePointerCancel, onPointerLeave: onStagePointerCancel, children: [items.length > 1 ? (_jsxs("span", { className: "feed-carousel-count", "aria-live": "polite", children: [safeIdx + 1, "/", items.length] })) : null, !url ? (_jsx("div", { className: "media-skeleton shimmer", "aria-hidden": true })) : video ? (_jsxs(_Fragment, { children: [_jsx("video", { ref: videoRef, src: url, poster: poster || undefined, playsInline: true, muted: muted, loop: mode === 'reel', preload: "auto", style: mediaTransform ? { transform: mediaTransform } : undefined, onLoadedMetadata: (e) => {
                                const v = e.currentTarget;
                                setNatural({ w: v.videoWidth, h: v.videoHeight });
                                if (v.duration && Number.isFinite(v.duration))
                                    setDuration(v.duration);
                            }, onDurationChange: (e) => {
                                const d = e.currentTarget.duration;
                                if (d && Number.isFinite(d))
                                    setDuration(d);
                            }, onTimeUpdate: (e) => {
                                if (!scrubbingRef.current)
                                    setCurrent(e.currentTarget.currentTime);
                            }, onPlay: () => {
                                setPlaying(true);
                                hideTools();
                            }, onPause: () => {
                                if (!scrubbingRef.current)
                                    setPlaying(false);
                            }, onEnded: () => setPlaying(false), onError: () => {
                                if (mediaId)
                                    void refreshUrl(mediaId).then((n) => n && setUrl(n));
                            } }), !playing ? (_jsx("button", { type: "button", className: "feed-video-play", "aria-label": t('play'), onPointerDown: (e) => {
                                e.stopPropagation();
                                skipStageToggle.current = true;
                            }, onPointerUp: (e) => e.stopPropagation(), onClick: (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                skipStageToggle.current = true;
                                togglePlay();
                            }, children: "\u25B6" })) : null, _jsxs("div", { className: `feed-video-tools${toolsVisible ? ' is-visible' : ''}`, children: [_jsx("button", { type: "button", className: "feed-video-mute", "aria-label": muted ? t('unmute') : t('mute'), onPointerDown: (e) => e.stopPropagation(), onPointerUp: (e) => e.stopPropagation(), onClick: toggleMute, children: muted ? '🔇' : '🔊' }), _jsx("button", { type: "button", className: `feed-video-rotate${rotationDeg ? ' is-on' : ''}`, "aria-label": t('rotateVideo'), title: t('rotateVideo'), onPointerDown: (e) => e.stopPropagation(), onPointerUp: (e) => e.stopPropagation(), onClick: toggleRotate, children: _jsx(IconScreenRotate, { size: 20 }) })] }), boosting ? _jsx("span", { className: "feed-video-boost", children: "1.5\u00D7" }) : null, _jsxs("div", { ref: seekBarRef, className: `feed-video-seek ${scrubbing ? 'scrubbing' : ''}`, onPointerDown: onSeekPointerDown, onPointerMove: onSeekPointerMove, onPointerUp: finishSeek, onPointerCancel: finishSeek, role: "slider", "aria-valuemin": 0, "aria-valuemax": Math.round(durForUi), "aria-valuenow": Math.round(displayTime), "aria-label": t('videoSeek'), children: [_jsxs("div", { className: "feed-video-seek-track", children: [_jsx("div", { className: "feed-video-seek-fill", style: { width: `${progress}%` } }), _jsx("div", { className: "feed-video-seek-thumb", style: { left: `${progress}%` } })] }), (scrubbing || showTools) && durForUi > 0 ? (_jsxs("div", { className: "feed-video-time", children: [formatTime(displayTime), " / ", formatTime(durForUi)] })) : null] })] })) : (_jsx("img", { src: url, alt: "", draggable: false, loading: "eager", decoding: "async", style: mediaTransform ? { transform: mediaTransform } : undefined, onLoad: (e) => {
                        const img = e.currentTarget;
                        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                    }, onError: () => {
                        if (mediaId)
                            void refreshUrl(mediaId).then((n) => n && setUrl(n));
                    } }, url)), items.length > 1 ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "feed-carousel-arrow prev", disabled: safeIdx === 0, "aria-label": t('previous'), onClick: (e) => {
                                e.stopPropagation();
                                setIdx((i) => Math.max(0, i - 1));
                            }, children: "\u2039" }), _jsx("button", { type: "button", className: "feed-carousel-arrow next", disabled: safeIdx >= items.length - 1, "aria-label": t('next'), onClick: (e) => {
                                e.stopPropagation();
                                setIdx((i) => Math.min(items.length - 1, i + 1));
                            }, children: "\u203A" }), _jsx("div", { className: "feed-carousel-dots", "aria-hidden": true, children: items.map((_, i) => (_jsx("span", { className: i === safeIdx ? 'on' : '' }, i))) })] })) : null] }) }));
}
