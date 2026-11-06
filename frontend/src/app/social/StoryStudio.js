import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createStory, fetchFollowing, searchAll, uploadMediaFileWithMeta } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { loadVideoDuration, trimVideoToBlob } from '@/lib/videoTrim';
import { AvatarCrop } from '../ui/AvatarCrop';
import { ErrorBanner } from '../ui/States';
import { UserAvatar } from '../ui/UserAvatar';
import { VideoFilmstripTrim } from '../ui/VideoFilmstripTrim';
import { useAuth } from '@/auth/AuthProvider';
const STICKERS = ['😀', '🔥', '❤️', '✨', '😂', '👏', '🎉', '💯', '🌟', '😎', '🙏', '💪'];
const MUSIC_TRACKS = ['Original audio', 'Trending beat', 'Chill vibes', 'Arabic pop', 'Lo-fi night'];
const COLORS = ['#ffffff', '#ff2d55', '#ffcc00', '#34c759', '#5ac8fa', '#af52de', '#000000'];
function uid() {
    return `ly_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function baseTransform() {
    return { x: 50, y: 50, scale: 1, rotation: 0, flipX: false, flipY: false };
}
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}
function layerCssTransform(layer) {
    const sx = (layer.flipX ? -1 : 1) * layer.scale;
    const sy = (layer.flipY ? -1 : 1) * layer.scale;
    return `translate(-50%, -50%) rotate(${layer.rotation}deg) scale(${sx}, ${sy})`;
}
/** Composite layers onto 1080×1920 — x/y are percentages 0–100 */
async function composeStoryBlob(layers, strokes) {
    const only = layers[0];
    const videoOnly = layers.length === 1 && only?.kind === 'media' && only.isVideo && strokes.length === 0;
    if (videoOnly && only?.kind === 'media') {
        return {
            blob: only.file,
            fileName: only.file.name || 'story.mp4',
            mime: only.file.type || 'video/mp4'
        };
    }
    const W = 1080;
    const H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        return null;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (const layer of layers) {
        const cx = (layer.x / 100) * W;
        const cy = (layer.y / 100) * H;
        if (layer.kind === 'media') {
            if (layer.isVideo)
                continue;
            try {
                const img = await loadImage(layer.url);
                // contain — full image visible at scale 1 (matches editor, no crop/zoom)
                const fit = Math.min(W / img.naturalWidth, H / img.naturalHeight);
                const dw = img.naturalWidth * fit * layer.scale;
                const dh = img.naturalHeight * fit * layer.scale;
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate((layer.rotation * Math.PI) / 180);
                ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
                ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
                ctx.restore();
            }
            catch {
                /* skip */
            }
        }
        else if (layer.kind === 'text' || layer.kind === 'mention') {
            const label = layer.kind === 'mention' ? `@${layer.username}` : layer.text;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((layer.rotation * Math.PI) / 180);
            ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
            ctx.fillStyle = layer.color;
            ctx.font = `bold ${Math.round(56 * layer.scale)}px Cairo, Tajawal, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,.55)';
            ctx.shadowBlur = 10;
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }
        else if (layer.kind === 'sticker') {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((layer.rotation * Math.PI) / 180);
            ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
            ctx.font = `${Math.round(110 * layer.scale)}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(layer.emoji, 0, 0);
            ctx.restore();
        }
    }
    for (const stroke of strokes) {
        const first = stroke.points[0];
        if (!first || stroke.points.length < 2)
            continue;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = Math.max(2, stroke.width * (W / 100));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo((first.x / 100) * W, (first.y / 100) * H);
        for (let i = 1; i < stroke.points.length; i++) {
            const pt = stroke.points[i];
            if (!pt)
                continue;
            ctx.lineTo((pt.x / 100) * W, (pt.y / 100) * H);
        }
        ctx.stroke();
    }
    const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
    if (!blob)
        return null;
    return { blob, fileName: 'story.jpg', mime: 'image/jpeg' };
}
export function StoryStudio({ onDone, onCancel }) {
    const { t } = useI18n();
    const { session } = useAuth();
    const user = session?.user;
    const fileRef = useRef(null);
    const addMoreRef = useRef(null);
    const stageRef = useRef(null);
    const [phase, setPhase] = useState('gallery');
    const [picked, setPicked] = useState([]);
    const [layers, setLayers] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [tool, setTool] = useState(null);
    const [drawColor, setDrawColor] = useState('#ffffff');
    const [strokes, setStrokes] = useState([]);
    const [drawing, setDrawing] = useState(false);
    const [commentsDisabled, setCommentsDisabled] = useState(false);
    const [musicLabel, setMusicLabel] = useState(null);
    const [error, setError] = useState('');
    const [pct, setPct] = useState(null);
    const [cropLayerId, setCropLayerId] = useState(null);
    const [textDraft, setTextDraft] = useState('');
    const [mentionQ, setMentionQ] = useState('');
    const [mentionPeople, setMentionPeople] = useState([]);
    const [editingTextId, setEditingTextId] = useState(null);
    const [pendingTrim, setPendingTrim] = useState(null);
    const [trimBusy, setTrimBusy] = useState(false);
    const dragRef = useRef(null);
    const rotateRef = useRef(null);
    const scaleRef = useRef(null);
    const meName = user?.displayName || user?.username || 'U';
    const me = getSessionSnapshot()?.user?.id;
    useEffect(() => {
        return () => {
            for (const l of layers) {
                if (l.kind === 'media')
                    URL.revokeObjectURL(l.url);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const selected = useMemo(() => layers.find((l) => l.id === selectedId) || null, [layers, selectedId]);
    useEffect(() => {
        if (tool !== 'mention')
            return;
        const handle = window.setTimeout(() => {
            void (async () => {
                try {
                    if (!mentionQ.trim()) {
                        const uname = getSessionSnapshot()?.user?.username;
                        if (!uname) {
                            setMentionPeople([]);
                            return;
                        }
                        const following = await fetchFollowing(uname);
                        const rows = (Array.isArray(following) ? following : []).map((f) => f.following || f.user || f);
                        setMentionPeople(rows.filter((u) => u?.id && u.id !== me).slice(0, 30));
                        return;
                    }
                    const res = await searchAll(mentionQ.trim());
                    setMentionPeople((res.users || []).filter((u) => u.id !== me).slice(0, 24));
                }
                catch {
                    setMentionPeople([]);
                }
            })();
        }, 280);
        return () => window.clearTimeout(handle);
    }, [tool, mentionQ, me]);
    function openGalleryPicker(multi = true) {
        const el = multi ? fileRef.current : addMoreRef.current;
        el?.click();
    }
    function makeMediaLayer(file, scale = 1) {
        return {
            id: uid(),
            kind: 'media',
            file,
            url: URL.createObjectURL(file),
            isVideo: file.type.startsWith('video/'),
            ...baseTransform(),
            scale
        };
    }
    function addMediaLayers(files, append) {
        if (!files.length)
            return;
        const layersNew = files.map((f, i) => makeMediaLayer(f, append || i > 0 ? 0.92 : 1));
        if (!append) {
            setPicked(files);
            setLayers(layersNew);
            setSelectedId(layersNew[0]?.id ?? null);
            setPhase('editor');
            setStrokes([]);
            setMusicLabel(null);
        }
        else {
            setPicked((p) => [...p, ...files]);
            setLayers((prev) => {
                if (layersNew[0])
                    setSelectedId(layersNew[0].id);
                return [...prev, ...layersNew];
            });
            setPhase('editor');
        }
    }
    async function beginVideoTrim(file, append, rest) {
        try {
            const duration = await loadVideoDuration(file);
            const end = Math.min(duration, 60);
            setPendingTrim({
                file,
                url: URL.createObjectURL(file),
                duration,
                start: 0,
                end,
                append,
                rest
            });
            setPhase('editor');
        }
        catch {
            setError(t('errorGeneric'));
        }
    }
    function ingestFiles(list, append) {
        if (!list || !list.length)
            return;
        const files = Array.from(list).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
        if (!files.length) {
            setError(t('invalidImageType'));
            return;
        }
        setError('');
        const images = files.filter((f) => f.type.startsWith('image/'));
        const videos = files.filter((f) => f.type.startsWith('video/'));
        const hasExisting = append && layers.length > 0;
        if (images.length) {
            addMediaLayers(images, hasExisting);
        }
        if (videos[0]) {
            void beginVideoTrim(videos[0], hasExisting || images.length > 0, videos.slice(1));
        }
        else if (!images.length) {
            setError(t('invalidImageType'));
        }
    }
    async function confirmVideoTrim() {
        if (!pendingTrim)
            return;
        setTrimBusy(true);
        setError('');
        try {
            const { file, start, end, append, rest, url } = pendingTrim;
            const trimmed = await trimVideoToBlob(file, start, end);
            const out = new File([trimmed.blob], `story-${Date.now()}.webm`, {
                type: trimmed.blob.type || 'video/webm'
            });
            URL.revokeObjectURL(url);
            addMediaLayers([out], append || layers.length > 0);
            setPendingTrim(null);
            if (rest[0]) {
                void beginVideoTrim(rest[0], true, rest.slice(1));
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setTrimBusy(false);
        }
    }
    function cancelVideoTrim() {
        if (!pendingTrim)
            return;
        URL.revokeObjectURL(pendingTrim.url);
        const { rest, append } = pendingTrim;
        setPendingTrim(null);
        if (rest[0])
            void beginVideoTrim(rest[0], append || layers.length > 0, rest.slice(1));
        else if (!layers.length)
            setPhase('gallery');
    }
    function updateLayer(id, patch) {
        setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    }
    function removeLayer(id) {
        setLayers((prev) => {
            const victim = prev.find((l) => l.id === id);
            if (victim?.kind === 'media')
                URL.revokeObjectURL(victim.url);
            return prev.filter((l) => l.id !== id);
        });
        if (selectedId === id)
            setSelectedId(null);
        if (editingTextId === id)
            setEditingTextId(null);
    }
    function duplicateLayer(id) {
        const src = layers.find((l) => l.id === id);
        if (!src)
            return;
        const copy = {
            ...src,
            id: uid(),
            x: Math.min(90, src.x + 4),
            y: Math.min(90, src.y + 4)
        };
        if (copy.kind === 'media') {
            copy.url = URL.createObjectURL(copy.file);
        }
        setLayers((prev) => [...prev, copy]);
        setSelectedId(copy.id);
    }
    function layerCenterClient(id) {
        const layer = layers.find((l) => l.id === id);
        const stage = stageRef.current;
        if (!layer || !stage)
            return null;
        const rect = stage.getBoundingClientRect();
        return {
            cx: rect.left + (layer.x / 100) * rect.width,
            cy: rect.top + (layer.y / 100) * rect.height
        };
    }
    function onPointerDownLayer(e, id) {
        if (tool === 'draw')
            return;
        e.stopPropagation();
        setSelectedId(id);
        const layer = layers.find((l) => l.id === id);
        if (!layer)
            return;
        dragRef.current = {
            id,
            ox: e.clientX,
            oy: e.clientY,
            lx: layer.x,
            ly: layer.y
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    function onRotatePointerDown(e, id) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedId(id);
        const center = layerCenterClient(id);
        const layer = layers.find((l) => l.id === id);
        if (!center || !layer)
            return;
        const startAngle = (Math.atan2(e.clientY - center.cy, e.clientX - center.cx) * 180) / Math.PI;
        rotateRef.current = {
            id,
            startAngle,
            startRot: layer.rotation,
            cx: center.cx,
            cy: center.cy
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    function onScalePointerDown(e, id) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedId(id);
        const center = layerCenterClient(id);
        const layer = layers.find((l) => l.id === id);
        if (!center || !layer)
            return;
        const dist = Math.hypot(e.clientX - center.cx, e.clientY - center.cy) || 1;
        scaleRef.current = {
            id,
            startDist: dist,
            startScale: layer.scale,
            cx: center.cx,
            cy: center.cy
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    function onPointerMove(e) {
        if (tool === 'draw' && drawing && stageRef.current) {
            const rect = stageRef.current.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            setStrokes((prev) => {
                const last = prev[prev.length - 1];
                if (!last)
                    return prev;
                return [...prev.slice(0, -1), { ...last, points: [...last.points, { x, y }] }];
            });
            return;
        }
        const rot = rotateRef.current;
        if (rot) {
            const angle = (Math.atan2(e.clientY - rot.cy, e.clientX - rot.cx) * 180) / Math.PI;
            let next = rot.startRot + (angle - rot.startAngle);
            next = ((next % 360) + 360) % 360;
            updateLayer(rot.id, { rotation: next });
            return;
        }
        const sc = scaleRef.current;
        if (sc) {
            const dist = Math.hypot(e.clientX - sc.cx, e.clientY - sc.cy) || 1;
            const next = Math.min(5, Math.max(0.15, sc.startScale * (dist / sc.startDist)));
            updateLayer(sc.id, { scale: next });
            return;
        }
        const d = dragRef.current;
        if (!d || !stageRef.current)
            return;
        const rect = stageRef.current.getBoundingClientRect();
        const dx = ((e.clientX - d.ox) / rect.width) * 100;
        const dy = ((e.clientY - d.oy) / rect.height) * 100;
        // Unconstrained — allow off-frame placement like IG
        updateLayer(d.id, {
            x: d.lx + dx,
            y: d.ly + dy
        });
    }
    function onPointerUp() {
        dragRef.current = null;
        rotateRef.current = null;
        scaleRef.current = null;
        setDrawing(false);
    }
    function startDraw(e) {
        if (tool === 'draw' && stageRef.current) {
            const rect = stageRef.current.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            setDrawing(true);
            setSelectedId(null);
            setStrokes((prev) => [...prev, { color: drawColor, width: 0.9, points: [{ x, y }] }]);
            return;
        }
        // Empty canvas click deselects (actions stay while selected)
        if (e.target === stageRef.current) {
            setSelectedId(null);
        }
    }
    function onWheelScale(e, id) {
        e.preventDefault();
        e.stopPropagation();
        const layer = layers.find((l) => l.id === id);
        if (!layer)
            return;
        const next = Math.min(5, Math.max(0.15, layer.scale + (e.deltaY < 0 ? 0.08 : -0.08)));
        updateLayer(id, { scale: next });
    }
    function addText(raw) {
        const text = raw.trim();
        if (!text)
            return;
        if (editingTextId) {
            const cur = layers.find((l) => l.id === editingTextId);
            if (cur?.kind === 'text') {
                updateLayer(editingTextId, { text });
                setEditingTextId(null);
                setTextDraft('');
                setTool(null);
                return;
            }
        }
        const id = uid();
        setLayers((prev) => [
            ...prev,
            { id, kind: 'text', text, color: '#ffffff', ...baseTransform(), y: 72 }
        ]);
        setSelectedId(id);
        setTextDraft('');
        setTool(null);
    }
    function addSticker(emoji) {
        const id = uid();
        setLayers((prev) => [...prev, { id, kind: 'sticker', emoji, ...baseTransform(), y: 40 }]);
        setSelectedId(id);
        setTool(null);
    }
    function addMention(username) {
        const clean = username.replace(/^@/, '').trim();
        if (!clean)
            return;
        const id = uid();
        setLayers((prev) => [
            ...prev,
            { id, kind: 'mention', username: clean, color: '#5ac8fa', ...baseTransform(), y: 65 }
        ]);
        setSelectedId(id);
        setTool(null);
        setMentionQ('');
    }
    async function exportDownload() {
        const composed = await composeStoryBlob(layers, strokes);
        if (!composed)
            return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(composed.blob);
        a.download = composed.fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    }
    async function publish(audience) {
        if (!layers.some((l) => l.kind === 'media')) {
            setError(t('chooseMedia'));
            return;
        }
        setPhase('publishing');
        setError('');
        setPct(0);
        try {
            const composed = await composeStoryBlob(layers, strokes);
            if (!composed)
                throw new Error(t('errorGeneric'));
            const file = new File([composed.blob], composed.fileName, { type: composed.mime });
            const mediaId = await uploadMediaFileWithMeta(file, 'story', { onProgress: setPct });
            await createStory(mediaId, audience, { commentsDisabled });
            onDone();
        }
        catch (err) {
            setPhase('editor');
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    const cropTarget = cropLayerId
        ? layers.find((l) => l.id === cropLayerId && l.kind === 'media' && !l.isVideo)
        : undefined;
    const onCropConfirm = useCallback((blob) => {
        if (!cropLayerId)
            return;
        const file = new File([blob], 'cropped.jpg', { type: blob.type || 'image/jpeg' });
        const url = URL.createObjectURL(file);
        setLayers((prev) => prev.map((l) => {
            if (l.id !== cropLayerId || l.kind !== 'media')
                return l;
            URL.revokeObjectURL(l.url);
            return { ...l, file, url, isVideo: false };
        }));
        setCropLayerId(null);
    }, [cropLayerId]);
    if (cropTarget) {
        return (_jsx(AvatarCrop, { file: cropTarget.file, variant: "free", onCancel: () => setCropLayerId(null), onConfirm: onCropConfirm }));
    }
    if (phase === 'gallery') {
        return (_jsxs("div", { className: "story-studio story-studio-gallery", dir: "rtl", children: [_jsxs("header", { className: "story-studio-top", children: [_jsx("button", { type: "button", className: "story-studio-x", onClick: onCancel, "aria-label": t('close'), children: "\u00D7" }), _jsx("strong", { children: t('addToStory') }), _jsx("span", { className: "story-studio-spacer" })] }), _jsxs("div", { className: "story-studio-shortcuts", children: [_jsxs("button", { type: "button", className: "story-shortcut", onClick: () => openGalleryPicker(true), children: [_jsx("span", { children: "\uD83D\uDCF7" }), t('chooseFromGallery')] }), _jsxs("button", { type: "button", className: "story-shortcut", onClick: () => setTool('music'), children: [_jsx("span", { children: "\uD83C\uDFB5" }), t('storyMusic')] }), _jsxs("button", { type: "button", className: "story-shortcut", onClick: () => openGalleryPicker(true), children: [_jsx("span", { children: "\u2728" }), t('storyEffects')] }), _jsxs("button", { type: "button", className: "story-shortcut", onClick: () => openGalleryPicker(true), children: [_jsx("span", { children: "\u25A6" }), t('storyCollage')] })] }), _jsxs("div", { className: "story-studio-recents-head", children: [_jsx("strong", { children: t('recents') }), _jsx("button", { type: "button", className: "linkish", onClick: () => openGalleryPicker(true), children: t('select') })] }), _jsxs("div", { className: "story-gallery-grid", children: [_jsx("button", { type: "button", className: "story-gallery-tile camera", onClick: () => openGalleryPicker(true), children: _jsx("span", { children: "\uD83D\uDCF7" }) }), picked.map((f) => (_jsx("div", { className: "story-gallery-tile", children: f.type.startsWith('video/') ? (_jsx("video", { src: URL.createObjectURL(f), muted: true })) : (_jsx("img", { src: URL.createObjectURL(f), alt: "" })) }, f.name + f.size)))] }), _jsx("p", { className: "muted tiny story-gallery-hint", children: t('storyGalleryHint') }), _jsx("input", { ref: fileRef, className: "sr-only", type: "file", accept: "image/*,video/*", multiple: true, onChange: (e) => {
                        ingestFiles(e.target.files, false);
                        e.target.value = '';
                    } }), error ? _jsx(ErrorBanner, { message: error }) : null] }));
    }
    return (_jsxs("div", { className: "story-studio story-studio-editor", dir: "rtl", children: [_jsxs("header", { className: "story-studio-top", children: [_jsx("button", { type: "button", className: "story-studio-x", onClick: () => {
                            if (phase === 'publishing')
                                return;
                            setPhase('gallery');
                        }, "aria-label": t('close'), children: "\u00D7" }), _jsx("strong", { children: t('createStory') }), _jsx("span", { className: "story-studio-spacer" })] }), error ? _jsx(ErrorBanner, { message: error }) : null, phase === 'publishing' ? (_jsxs("p", { className: "muted story-publish-pct", children: [t('phasePublishing'), " ", pct != null ? `${Math.round(pct)}%` : ''] })) : null, selected && !pendingTrim ? (_jsxs("div", { className: "story-layer-actions sticky", onPointerDown: (e) => e.stopPropagation(), children: [_jsx("button", { type: "button", onClick: () => removeLayer(selected.id), children: t('delete') }), _jsx("button", { type: "button", onClick: () => duplicateLayer(selected.id), children: t('duplicate') }), selected.kind === 'text' ? (_jsx("button", { type: "button", onClick: () => {
                            setEditingTextId(selected.id);
                            setTextDraft(selected.text);
                            setTool('text');
                        }, children: t('edit') })) : null, selected.kind === 'media' && !selected.isVideo ? (_jsx("button", { type: "button", onClick: () => setCropLayerId(selected.id), children: t('crop') })) : null, _jsx("button", { type: "button", onClick: () => updateLayer(selected.id, { rotation: (selected.rotation - 15 + 360) % 360 }), children: "\u21BA" }), _jsx("button", { type: "button", onClick: () => updateLayer(selected.id, { rotation: (selected.rotation + 15) % 360 }), children: "\u21BB" }), _jsx("button", { type: "button", onClick: () => updateLayer(selected.id, { flipX: !selected.flipX }), children: t('flipH') }), _jsx("button", { type: "button", onClick: () => updateLayer(selected.id, { flipY: !selected.flipY }), children: t('flipV') }), _jsx("button", { type: "button", onClick: () => updateLayer(selected.id, { scale: Math.min(5, selected.scale + 0.12) }), children: "+" }), _jsx("button", { type: "button", onClick: () => updateLayer(selected.id, { scale: Math.max(0.15, selected.scale - 0.12) }), children: "\u2212" })] })) : null, _jsxs("div", { ref: stageRef, className: "story-canvas", onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerLeave: onPointerUp, onPointerDown: startDraw, children: [_jsx("svg", { className: "story-draw-layer", viewBox: "0 0 100 100", preserveAspectRatio: "none", children: strokes.map((s, i) => (_jsx("polyline", { fill: "none", stroke: s.color, strokeWidth: s.width, strokeLinecap: "round", strokeLinejoin: "round", points: s.points.map((p) => `${p.x},${p.y}`).join(' ') }, i))) }), layers.map((layer) => {
                        const style = {
                            left: `${layer.x}%`,
                            top: `${layer.y}%`,
                            transform: layerCssTransform(layer)
                        };
                        const active = selectedId === layer.id;
                        const handles = active ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "story-handle rotate", onPointerDown: (e) => onRotatePointerDown(e, layer.id), title: "rotate" }), _jsx("span", { className: "story-handle scale tl", onPointerDown: (e) => onScalePointerDown(e, layer.id) }), _jsx("span", { className: "story-handle scale tr", onPointerDown: (e) => onScalePointerDown(e, layer.id) }), _jsx("span", { className: "story-handle scale bl", onPointerDown: (e) => onScalePointerDown(e, layer.id) }), _jsx("span", { className: "story-handle scale br", onPointerDown: (e) => onScalePointerDown(e, layer.id) })] })) : null;
                        if (layer.kind === 'media') {
                            return (_jsxs("div", { className: `story-layer media ${active ? 'active' : ''}`, style: style, onPointerDown: (e) => onPointerDownLayer(e, layer.id), onWheel: (e) => onWheelScale(e, layer.id), children: [layer.isVideo ? (_jsx("video", { src: layer.url, muted: true, loop: true, autoPlay: true, playsInline: true })) : (_jsx("img", { src: layer.url, alt: "", draggable: false })), handles] }, layer.id));
                        }
                        if (layer.kind === 'text') {
                            return (_jsxs("div", { className: `story-layer text ${active ? 'active' : ''}`, style: { ...style, color: layer.color }, onPointerDown: (e) => onPointerDownLayer(e, layer.id), onWheel: (e) => onWheelScale(e, layer.id), onDoubleClick: () => {
                                    setEditingTextId(layer.id);
                                    setTextDraft(layer.text);
                                    setTool('text');
                                }, children: [layer.text, handles] }, layer.id));
                        }
                        if (layer.kind === 'mention') {
                            return (_jsxs("div", { className: `story-layer text mention ${active ? 'active' : ''}`, style: { ...style, color: layer.color }, onPointerDown: (e) => onPointerDownLayer(e, layer.id), onWheel: (e) => onWheelScale(e, layer.id), children: ["@", layer.username, handles] }, layer.id));
                        }
                        return (_jsxs("div", { className: `story-layer sticker ${active ? 'active' : ''}`, style: style, onPointerDown: (e) => onPointerDownLayer(e, layer.id), onWheel: (e) => onWheelScale(e, layer.id), children: [layer.emoji, handles] }, layer.id));
                    }), musicLabel ? _jsxs("div", { className: "story-music-chip", children: ["\u266A ", musicLabel] }) : null] }), pendingTrim ? (_jsxs("div", { className: "story-trim-overlay", onPointerDown: (e) => e.stopPropagation(), children: [_jsx("video", { className: "story-trim-preview", src: pendingTrim.url, muted: true, playsInline: true, controls: true }), _jsx(VideoFilmstripTrim, { file: pendingTrim.file, duration: pendingTrim.duration, start: pendingTrim.start, end: pendingTrim.end, maxClip: 60, onChange: ({ start, end }) => setPendingTrim((p) => (p ? { ...p, start, end } : p)) }), _jsxs("div", { className: "story-trim-actions", children: [_jsx("button", { type: "button", className: "button button-ghost", disabled: trimBusy, onClick: cancelVideoTrim, children: t('close') }), _jsx("button", { type: "button", className: "button", disabled: trimBusy, onClick: () => void confirmVideoTrim(), children: trimBusy ? '…' : t('confirm') })] })] })) : null, _jsxs("aside", { className: "story-tools", children: [_jsxs("button", { type: "button", className: tool === 'text' ? 'on' : '', onClick: () => setTool(tool === 'text' ? null : 'text'), children: [_jsx("span", { children: "Aa" }), _jsx("small", { children: t('storyText') })] }), _jsxs("button", { type: "button", className: tool === 'stickers' ? 'on' : '', onClick: () => setTool(tool === 'stickers' ? null : 'stickers'), children: [_jsx("span", { children: "\u263A" }), _jsx("small", { children: t('stickers') })] }), _jsxs("button", { type: "button", onClick: () => addMoreRef.current?.click(), children: [_jsx("span", { children: "+" }), _jsx("small", { children: t('addMore') })] }), _jsxs("button", { type: "button", className: tool === 'music' ? 'on' : '', onClick: () => setTool(tool === 'music' ? null : 'music'), children: [_jsx("span", { children: "\u266A" }), _jsx("small", { children: t('storyMusic') })] }), _jsxs("button", { type: "button", className: tool === 'mention' ? 'on' : '', onClick: () => {
                            setTool(tool === 'mention' ? null : 'mention');
                            setMentionQ('');
                        }, children: [_jsx("span", { children: "@" }), _jsx("small", { children: t('storyMention') })] }), _jsxs("button", { type: "button", className: tool === 'draw' ? 'on' : '', onClick: () => setTool(tool === 'draw' ? null : 'draw'), children: [_jsx("span", { children: "\u270E" }), _jsx("small", { children: t('storyDraw') })] }), _jsxs("button", { type: "button", onClick: () => void exportDownload(), children: [_jsx("span", { children: "\u2B07" }), _jsx("small", { children: t('download') })] }), _jsxs("button", { type: "button", className: commentsDisabled ? 'on' : '', onClick: () => setCommentsDisabled((v) => !v), children: [_jsx("span", { children: commentsDisabled ? '🔇' : '💬' }), _jsx("small", { children: t('muteComments') })] })] }), tool === 'text' ? (_jsxs("div", { className: "story-tool-sheet", children: [_jsx("input", { className: "search-input", placeholder: t('addCaption'), value: textDraft, autoFocus: true, onChange: (e) => setTextDraft(e.target.value), onKeyDown: (e) => {
                            if (e.key === 'Enter')
                                addText(textDraft);
                        } }), _jsx("button", { type: "button", className: "button button-compact", onClick: () => addText(textDraft), children: editingTextId ? t('edit') : t('send') }), _jsx("div", { className: "story-color-row", children: COLORS.map((c) => (_jsx("button", { type: "button", className: "story-color-dot", style: { background: c }, onClick: () => {
                                if (selected?.kind === 'text' || selected?.kind === 'mention') {
                                    updateLayer(selected.id, { color: c });
                                }
                            } }, c))) })] })) : null, tool === 'stickers' ? (_jsx("div", { className: "story-tool-sheet stickers", children: STICKERS.map((e) => (_jsx("button", { type: "button", onClick: () => addSticker(e), children: e }, e))) })) : null, tool === 'music' ? (_jsx("div", { className: "story-tool-sheet", children: MUSIC_TRACKS.map((m) => (_jsxs("button", { type: "button", className: "list-row", onClick: () => {
                        setMusicLabel(m);
                        setTool(null);
                    }, children: ["\u266A ", m] }, m))) })) : null, tool === 'mention' ? (_jsxs("div", { className: "story-tool-sheet story-mention-sheet", children: [_jsx("input", { className: "search-input", placeholder: t('searchPeopleHint'), value: mentionQ, autoFocus: true, dir: "auto", onChange: (e) => setMentionQ(e.target.value), onKeyDown: (e) => {
                            if (e.key === 'Enter' && mentionQ.trim()) {
                                addMention(mentionQ.trim());
                            }
                        } }), _jsx("ul", { className: "story-mention-list", children: mentionPeople.map((u) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "story-mention-row", onClick: () => addMention(u.username), children: [_jsx(UserAvatar, { size: "sm", name: u.displayName || u.username, username: u.username, avatarUrl: u.avatarUrl }), _jsxs("span", { children: [_jsxs("strong", { children: ["@", u.username] }), u.displayName ? _jsxs("span", { className: "muted tiny", children: [" \u00B7 ", u.displayName] }) : null] })] }) }, u.id))) }), mentionQ.trim() ? (_jsxs("button", { type: "button", className: "button button-compact", onClick: () => addMention(mentionQ), children: ["@", mentionQ.replace(/^@/, '')] })) : null] })) : null, tool === 'draw' ? (_jsx("div", { className: "story-tool-sheet", children: _jsxs("div", { className: "story-color-row", children: [COLORS.map((c) => (_jsx("button", { type: "button", className: `story-color-dot ${drawColor === c ? 'on' : ''}`, style: { background: c }, onClick: () => setDrawColor(c) }, c))), _jsx("button", { type: "button", className: "linkish", onClick: () => setStrokes([]), children: t('clear') })] }) })) : null, _jsxs("footer", { className: "story-share-bar", children: [_jsxs("button", { type: "button", className: "story-share-btn", disabled: phase === 'publishing', onClick: () => void publish('everyone'), children: [_jsx("span", { className: "avatar-circle sm", children: meName.slice(0, 1).toUpperCase() }), t('yourStory')] }), _jsxs("button", { type: "button", className: "story-share-btn", disabled: phase === 'publishing', onClick: () => void publish('close_friends'), children: [_jsx("span", { className: "cf-star", children: "\u2605" }), t('storyCloseFriends')] })] }), _jsx("input", { ref: addMoreRef, className: "sr-only", type: "file", accept: "image/*,video/*", multiple: true, onChange: (e) => {
                    ingestFiles(e.target.files, true);
                    e.target.value = '';
                } })] }));
}
