import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
const STAGE = 320;
const MIN_BOX = 40;
const PAD = 8;
/** Matches `.avatar-crop-mask { margin: 8% }` */
const CIRCLE_INSET = 0.08;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ASPECT_PRESETS = [
    { id: 'free', label: 'Free', ratio: null },
    { id: '9:16', label: '9:16', ratio: 9 / 16 },
    { id: '16:9', label: '16:9', ratio: 16 / 9 },
    { id: '1:1', label: '1:1', ratio: 1 },
    { id: '4:3', label: '4:3', ratio: 4 / 3 },
    { id: '3:4', label: '3:4', ratio: 3 / 4 }
];
function AspectIcon({ id }) {
    const map = {
        free: { w: 18, h: 14 },
        '9:16': { w: 10, h: 18 },
        '16:9': { w: 18, h: 10 },
        '1:1': { w: 14, h: 14 },
        '4:3': { w: 16, h: 12 },
        '3:4': { w: 12, h: 16 }
    };
    const s = map[id];
    return (_jsx("span", { className: "crop-aspect-icon", "aria-hidden": true, children: _jsx("span", { style: { width: s.w, height: s.h } }) }));
}
function pointerDist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}
/** Circle crop for avatars; free = full-image rectangular crop with aspect presets. */
export function AvatarCrop({ file, onCancel, onConfirm, variant = 'circle' }) {
    const { t } = useI18n();
    const imgRef = useRef(null);
    const circleStageRef = useRef(null);
    const [url, setUrl] = useState('');
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [natural, setNatural] = useState({ w: 0, h: 0 });
    const [stagePx, setStagePx] = useState(STAGE);
    const [box, setBox] = useState({ x: PAD, y: PAD, w: STAGE - PAD * 2, h: STAGE - PAD * 2 });
    const [aspect, setAspect] = useState('free');
    const drag = useRef(null);
    const pointers = useRef(new Map());
    useEffect(() => {
        const u = URL.createObjectURL(file);
        setUrl(u);
        setOffset({ x: 0, y: 0 });
        setZoom(1);
        setAspect('free');
        return () => URL.revokeObjectURL(u);
    }, [file]);
    useEffect(() => {
        if (variant !== 'circle')
            return;
        const el = circleStageRef.current;
        if (!el)
            return;
        const measure = () => {
            const w = el.clientWidth || STAGE;
            setStagePx(w);
        };
        measure();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        return () => ro?.disconnect();
    }, [variant, url]);
    /** Fit entire image inside stage (contain), no zoom-in. */
    const fit = (() => {
        if (!natural.w || !natural.h)
            return { scale: 1, dispW: STAGE, dispH: STAGE, left: 0, top: 0 };
        const scale = Math.min((STAGE - PAD * 2) / natural.w, (STAGE - PAD * 2) / natural.h);
        const dispW = natural.w * scale;
        const dispH = natural.h * scale;
        const left = (STAGE - dispW) / 2 + offset.x;
        const top = (STAGE - dispH) / 2 + offset.y;
        return { scale, dispW, dispH, left, top };
    })();
    const circleLayout = (() => {
        const stage = stagePx || STAGE;
        const nw = natural.w || 1;
        const nh = natural.h || 1;
        const circleD = stage * (1 - 2 * CIRCLE_INSET);
        const base = Math.max(circleD / nw, circleD / nh);
        const scale = base * zoom;
        const dispW = nw * scale;
        const dispH = nh * scale;
        const left = (stage - dispW) / 2 + offset.x;
        const top = (stage - dispH) / 2 + offset.y;
        const circleLeft = (stage - circleD) / 2;
        const circleTop = (stage - circleD) / 2;
        return { stage, circleD, base, scale, dispW, dispH, left, top, circleLeft, circleTop };
    })();
    function clampCircleOffset(ox, oy, nextZoom) {
        const stage = stagePx || STAGE;
        const nw = natural.w || 1;
        const nh = natural.h || 1;
        const circleD = stage * (1 - 2 * CIRCLE_INSET);
        const base = Math.max(circleD / nw, circleD / nh);
        const scale = base * Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
        const dispW = nw * scale;
        const dispH = nh * scale;
        const r = circleD / 2;
        const cx = stage / 2;
        const cy = stage / 2;
        // Keep circle fully covered by the image
        const minOx = cx + r - ((stage - dispW) / 2 + dispW);
        const maxOx = cx - r - (stage - dispW) / 2;
        const minOy = cy + r - ((stage - dispH) / 2 + dispH);
        const maxOy = cy - r - (stage - dispH) / 2;
        return {
            x: Math.min(maxOx, Math.max(minOx, ox)),
            y: Math.min(maxOy, Math.max(minOy, oy))
        };
    }
    function clampBox(next, ratio = aspectRatio(aspect)) {
        const imgLeft = fit.left;
        const imgTop = fit.top;
        const imgRight = fit.left + fit.dispW;
        const imgBottom = fit.top + fit.dispH;
        let { x, y, w, h } = next;
        if (ratio != null && ratio > 0) {
            if (w / h > ratio)
                w = h * ratio;
            else
                h = w / ratio;
        }
        w = Math.max(MIN_BOX, Math.min(w, fit.dispW));
        h = Math.max(MIN_BOX, Math.min(h, fit.dispH));
        if (ratio != null && ratio > 0) {
            if (w / h > ratio)
                w = h * ratio;
            else
                h = w / ratio;
            w = Math.max(MIN_BOX, Math.min(w, fit.dispW));
            h = Math.max(MIN_BOX, Math.min(h, fit.dispH));
        }
        x = Math.max(imgLeft, Math.min(x, imgRight - w));
        y = Math.max(imgTop, Math.min(y, imgBottom - h));
        return { x, y, w, h };
    }
    function aspectRatio(a) {
        return ASPECT_PRESETS.find((p) => p.id === a)?.ratio ?? null;
    }
    function fullImageBox() {
        return clampBox({ x: fit.left, y: fit.top, w: fit.dispW, h: fit.dispH }, null);
    }
    function applyAspect(next) {
        setAspect(next);
        const ratio = aspectRatio(next);
        if (ratio == null) {
            setBox(fullImageBox());
            return;
        }
        let w = fit.dispW;
        let h = w / ratio;
        if (h > fit.dispH) {
            h = fit.dispH;
            w = h * ratio;
        }
        const x = fit.left + (fit.dispW - w) / 2;
        const y = fit.top + (fit.dispH - h) / 2;
        setBox(clampBox({ x, y, w, h }, ratio));
    }
    function onImgLoad() {
        const img = imgRef.current;
        if (!img)
            return;
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        setNatural({ w, h });
        setOffset({ x: 0, y: 0 });
        setZoom(1);
        if (variant === 'free') {
            const scale = Math.min((STAGE - PAD * 2) / w, (STAGE - PAD * 2) / h);
            const dispW = w * scale;
            const dispH = h * scale;
            const left = (STAGE - dispW) / 2;
            const top = (STAGE - dispH) / 2;
            setBox({ x: left, y: top, w: dispW, h: dispH });
            setAspect('free');
        }
    }
    function onBoxPointerDown(e) {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { kind: 'move', px: e.clientX, py: e.clientY, box: { ...box } };
    }
    function onHandlePointerDown(handle, e) {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { kind: 'resize', handle, px: e.clientX, py: e.clientY, box: { ...box } };
    }
    function onStagePointerDown(e) {
        if (e.target.closest('.avatar-crop-rect'))
            return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { kind: 'pan', px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    }
    function onCirclePointerDown(e) {
        const stage = circleStageRef.current;
        if (!stage)
            return;
        stage.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
            const pts = [...pointers.current.values()];
            drag.current = {
                kind: 'pinch',
                startDist: pointerDist(pts[0], pts[1]),
                startZoom: zoom,
                ox: offset.x,
                oy: offset.y
            };
            return;
        }
        drag.current = { kind: 'pan', px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    }
    function onCirclePointerMove(e) {
        if (pointers.current.has(e.pointerId)) {
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        const d = drag.current;
        if (!d)
            return;
        if (d.kind === 'pinch' && pointers.current.size >= 2) {
            const pts = [...pointers.current.values()];
            const dist = pointerDist(pts[0], pts[1]);
            if (d.startDist <= 0)
                return;
            const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, d.startZoom * (dist / d.startDist)));
            setZoom(nextZoom);
            setOffset(clampCircleOffset(d.ox, d.oy, nextZoom));
            return;
        }
        if (d.kind === 'pan') {
            const dx = e.clientX - d.px;
            const dy = e.clientY - d.py;
            setOffset(clampCircleOffset(d.ox + dx, d.oy + dy, zoom));
        }
    }
    function onCirclePointerUp(e) {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2 && drag.current?.kind === 'pinch') {
            const rem = [...pointers.current.entries()][0];
            if (rem) {
                drag.current = {
                    kind: 'pan',
                    px: rem[1].x,
                    py: rem[1].y,
                    ox: offset.x,
                    oy: offset.y
                };
            }
            else {
                drag.current = null;
            }
            return;
        }
        if (pointers.current.size === 0)
            drag.current = null;
    }
    function onCircleWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.92 : 1.08;
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
        setZoom(nextZoom);
        setOffset((o) => clampCircleOffset(o.x, o.y, nextZoom));
    }
    function bumpZoom(dir) {
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + dir * 0.2));
        setZoom(nextZoom);
        setOffset((o) => clampCircleOffset(o.x, o.y, nextZoom));
    }
    function onPointerMove(e) {
        const d = drag.current;
        if (!d || d.kind === 'pinch')
            return;
        const dx = e.clientX - d.px;
        const dy = e.clientY - d.py;
        const ratio = aspectRatio(aspect);
        if (d.kind === 'pan') {
            setOffset({ x: d.ox + dx, y: d.oy + dy });
            return;
        }
        if (d.kind === 'move') {
            setBox(clampBox({ ...d.box, x: d.box.x + dx, y: d.box.y + dy }, ratio));
            return;
        }
        const b = { ...d.box };
        const h = d.handle;
        if (ratio == null) {
            if (h.includes('e'))
                b.w = d.box.w + dx;
            if (h.includes('s'))
                b.h = d.box.h + dy;
            if (h.includes('w')) {
                b.x = d.box.x + dx;
                b.w = d.box.w - dx;
            }
            if (h.includes('n')) {
                b.y = d.box.y + dy;
                b.h = d.box.h - dy;
            }
        }
        else {
            const fromCorner = (h.includes('n') || h.includes('s')) && (h.includes('e') || h.includes('w'));
            if (fromCorner || h === 'e' || h === 'w') {
                b.w = d.box.w + dx * (h.includes('w') ? -1 : 1);
                b.h = b.w / ratio;
                if (h.includes('w'))
                    b.x = d.box.x + (d.box.w - b.w);
                if (h.includes('n'))
                    b.y = d.box.y + (d.box.h - b.h);
            }
            else {
                b.h = d.box.h + dy * (h.includes('n') ? -1 : 1);
                b.w = b.h * ratio;
                if (h.includes('n'))
                    b.y = d.box.y + (d.box.h - b.h);
                b.x = d.box.x + (d.box.w - b.w) / 2;
            }
        }
        setBox(clampBox(b, ratio));
    }
    function onPointerUp() {
        drag.current = null;
    }
    async function confirmCircle() {
        const img = imgRef.current;
        if (!img || !natural.w || !natural.h)
            return;
        const { scale, left, top, circleLeft, circleTop, circleD } = circleLayout;
        if (!(scale > 0) || !(circleD > 0))
            return;
        const sx = (circleLeft - left) / scale;
        const sy = (circleTop - top) / scale;
        const sw = circleD / scale;
        const sh = circleD / scale;
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, size, size);
        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
        ctx.restore();
        canvas.toBlob((blob) => blob && onConfirm(blob), 'image/jpeg', 0.92);
    }
    async function confirmFree() {
        const img = imgRef.current;
        if (!img || !natural.w)
            return;
        const sx = (box.x - fit.left) / fit.scale;
        const sy = (box.y - fit.top) / fit.scale;
        const sw = box.w / fit.scale;
        const sh = box.h / fit.scale;
        const outW = Math.max(1, Math.round(sw));
        const outH = Math.max(1, Math.round(sh));
        const maxSide = 1920;
        const fitOut = Math.min(1, maxSide / Math.max(outW, outH));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(outW * fitOut));
        canvas.height = Math.max(1, Math.round(outH * fitOut));
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => blob && onConfirm(blob), 'image/jpeg', 0.92);
    }
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    return (_jsx("div", { className: "avatar-crop-modal", role: "dialog", "aria-modal": "true", children: _jsxs("div", { className: `avatar-crop-card ${variant === 'free' ? 'is-free' : ''}`, children: [_jsx("h2", { children: t('cropAvatar') }), _jsx("p", { className: "muted tiny", children: variant === 'free' ? t('cropFreeHint') : t('cropAvatarHint') }), variant === 'circle' ? (_jsxs(_Fragment, { children: [_jsxs("div", { ref: circleStageRef, className: "avatar-crop-stage", onPointerDown: onCirclePointerDown, onPointerMove: onCirclePointerMove, onPointerUp: onCirclePointerUp, onPointerCancel: onCirclePointerUp, onWheel: onCircleWheel, children: [url ? (_jsx("img", { ref: imgRef, src: url, alt: "", style: {
                                        width: circleLayout.dispW || undefined,
                                        height: circleLayout.dispH || undefined,
                                        left: circleLayout.left,
                                        top: circleLayout.top,
                                        transform: 'none'
                                    }, draggable: false, onLoad: onImgLoad })) : null, _jsx("div", { className: "avatar-crop-mask", "aria-hidden": true })] }), _jsxs("div", { className: "avatar-crop-zoom-row", children: [_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => bumpZoom(-1), children: "\u2212" }), _jsx("input", { type: "range", min: MIN_ZOOM, max: MAX_ZOOM, step: 0.01, value: zoom, "aria-label": t('cropAvatar'), onChange: (e) => {
                                        const nextZoom = Number(e.target.value);
                                        setZoom(nextZoom);
                                        setOffset((o) => clampCircleOffset(o.x, o.y, nextZoom));
                                    } }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => bumpZoom(1), children: "+" })] })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "crop-aspect-row", role: "toolbar", "aria-label": t('cropAspect'), children: ASPECT_PRESETS.map((p) => (_jsxs("button", { type: "button", className: `crop-aspect-btn ${aspect === p.id ? 'is-active' : ''}`, onClick: () => applyAspect(p.id), title: p.label, children: [_jsx(AspectIcon, { id: p.id }), _jsx("span", { children: p.id === 'free' ? t('cropFree') : p.label })] }, p.id))) }), _jsxs("div", { className: "avatar-crop-stage avatar-crop-stage-free", style: { width: STAGE, height: STAGE }, onPointerDown: onStagePointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, children: [url ? (_jsx("img", { ref: imgRef, src: url, alt: "", className: "avatar-crop-free-img", style: {
                                        width: fit.dispW || undefined,
                                        height: fit.dispH || undefined,
                                        left: fit.left,
                                        top: fit.top,
                                        transform: 'none'
                                    }, draggable: false, onLoad: onImgLoad })) : null, _jsx("div", { className: "avatar-crop-dim", "aria-hidden": true }), _jsx("div", { className: "avatar-crop-rect", style: { left: box.x, top: box.y, width: box.w, height: box.h }, onPointerDown: onBoxPointerDown, children: handles.map((h) => (_jsx("span", { className: `avatar-crop-handle avatar-crop-handle-${h}`, onPointerDown: (e) => onHandlePointerDown(h, e) }, h))) })] })] })), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: "button button-ghost", onClick: onCancel, children: t('cancel') }), _jsx("button", { type: "button", className: "button", onClick: () => void (variant === 'free' ? confirmFree() : confirmCircle()), children: t('usePhoto') })] })] }) }));
}
