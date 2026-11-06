import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
const THUMBS = 12;
async function captureThumbs(file, duration) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('video load failed'));
    });
    const canvas = document.createElement('canvas');
    const w = 72;
    const h = 128;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        URL.revokeObjectURL(url);
        return [];
    }
    const out = [];
    const total = Math.max(0.1, duration);
    for (let i = 0; i < THUMBS; i++) {
        const t = Math.min(total - 0.05, (i / Math.max(1, THUMBS - 1)) * total);
        video.currentTime = Math.max(0, t);
        await new Promise((resolve) => {
            const done = () => resolve();
            video.onseeked = done;
            window.setTimeout(done, 400);
        });
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);
        const vw = video.videoWidth || 1;
        const vh = video.videoHeight || 1;
        const scale = Math.max(w / vw, h / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
        out.push(canvas.toDataURL('image/jpeg', 0.7));
    }
    URL.revokeObjectURL(url);
    return out;
}
export function VideoFilmstripTrim({ file, duration, start, end, maxClip = 60, onChange }) {
    const trackRef = useRef(null);
    const [thumbs, setThumbs] = useState([]);
    const [playhead, setPlayhead] = useState(start);
    const drag = useRef(null);
    const dragOrigin = useRef({ x: 0, start: 0, end: 0 });
    useEffect(() => {
        let cancelled = false;
        void captureThumbs(file, duration)
            .then((rows) => {
            if (!cancelled)
                setThumbs(rows);
        })
            .catch(() => {
            if (!cancelled)
                setThumbs([]);
        });
        return () => {
            cancelled = true;
        };
    }, [file, duration]);
    useEffect(() => {
        setPlayhead(start);
    }, [start, file]);
    const leftPct = useMemo(() => (duration > 0 ? (start / duration) * 100 : 0), [start, duration]);
    const widthPct = useMemo(() => (duration > 0 ? ((end - start) / duration) * 100 : 100), [start, end, duration]);
    const headPct = useMemo(() => (duration > 0 ? (playhead / duration) * 100 : 0), [playhead, duration]);
    function clientToTime(clientX) {
        const el = trackRef.current;
        if (!el || duration <= 0)
            return 0;
        const rect = el.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return ratio * duration;
    }
    function clampRange(nextStart, nextEnd) {
        let s = Math.max(0, Math.min(nextStart, duration - 0.5));
        let e = Math.min(duration, Math.max(nextEnd, s + 0.5));
        if (e - s > maxClip) {
            if (drag.current === 'start')
                s = e - maxClip;
            else
                e = s + maxClip;
        }
        onChange({ start: s, end: e });
        setPlayhead((p) => Math.min(Math.max(p, s), e));
    }
    function onPointerDown(kind, e) {
        e.preventDefault();
        e.stopPropagation();
        drag.current = kind;
        dragOrigin.current = { x: e.clientX, start, end };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    function onPointerMove(e) {
        if (!drag.current)
            return;
        const t = clientToTime(e.clientX);
        if (drag.current === 'start') {
            clampRange(Math.min(t, end - 0.5), end);
        }
        else if (drag.current === 'end') {
            clampRange(start, Math.max(t, start + 0.5));
        }
        else if (drag.current === 'playhead') {
            const p = Math.min(end, Math.max(start, t));
            setPlayhead(p);
        }
        else if (drag.current === 'window') {
            const el = trackRef.current;
            if (!el)
                return;
            const dx = e.clientX - dragOrigin.current.x;
            const dt = (dx / el.getBoundingClientRect().width) * duration;
            const span = dragOrigin.current.end - dragOrigin.current.start;
            let s = dragOrigin.current.start + dt;
            let en = s + span;
            if (s < 0) {
                s = 0;
                en = span;
            }
            if (en > duration) {
                en = duration;
                s = duration - span;
            }
            onChange({ start: s, end: en });
            setPlayhead((p) => Math.min(Math.max(p, s), en));
        }
    }
    function onPointerUp() {
        drag.current = null;
    }
    return (_jsxs("div", { className: "filmstrip-trim", children: [_jsxs("p", { className: "muted tiny filmstrip-meta", children: [(end - start).toFixed(1), "s / ", maxClip, "s \u00B7 ", start.toFixed(1), "s \u2192 ", end.toFixed(1), "s"] }), _jsxs("div", { className: "filmstrip-row", onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerCancel: onPointerUp, children: [_jsx("button", { type: "button", className: "filmstrip-chevron", "aria-hidden": true, children: "\u2039" }), _jsxs("div", { ref: trackRef, className: "filmstrip-track", children: [_jsx("div", { className: "filmstrip-thumbs", children: (thumbs.length ? thumbs : Array.from({ length: THUMBS })).map((src, i) => typeof src === 'string' ? (_jsx("img", { src: src, alt: "", draggable: false }, i)) : (_jsx("span", { className: "filmstrip-ph" }, i))) }), _jsxs("div", { className: "filmstrip-window", style: { left: `${leftPct}%`, width: `${widthPct}%` }, onPointerDown: (e) => onPointerDown('window', e), children: [_jsx("span", { className: "filmstrip-handle start", onPointerDown: (e) => onPointerDown('start', e) }), _jsx("span", { className: "filmstrip-handle end", onPointerDown: (e) => onPointerDown('end', e) }), _jsx("span", { className: "filmstrip-playhead", style: { left: `${duration > 0 ? ((playhead - start) / Math.max(0.01, end - start)) * 100 : 0}%` }, onPointerDown: (e) => onPointerDown('playhead', e) })] })] }), _jsx("button", { type: "button", className: "filmstrip-chevron", "aria-hidden": true, children: "\u203A" })] }), _jsxs("div", { className: "filmstrip-seek-hint muted tiny", style: { ['--head']: `${headPct}%` }, children: ["\u25B6 ", playhead.toFixed(1), "s"] })] }));
}
