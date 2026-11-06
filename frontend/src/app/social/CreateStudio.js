import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createPost, createReel, fetchVideoTrimStatus, trimVideoServer, uploadMediaFileWithMeta } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { centerAspectCrop } from '@/lib/imageCrop';
import { loadVideoDuration, trimVideoToBlob } from '@/lib/videoTrim';
import { ErrorBanner } from '../ui/States';
import { useToast } from '../ui/Toast';
import { VideoFilmstripTrim } from '../ui/VideoFilmstripTrim';
import { StoryStudio } from './StoryStudio';
/** Align with backend ALLOWED_MIME_BY_TYPE. Size limits are enforced server-side only. */
const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_VIDEO = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const MAX_POST_IMAGES = 10;
function newRequestId() {
    return `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function isBusyPhase(phase) {
    return phase === 'preparing' || phase === 'uploading' || phase === 'processing' || phase === 'publishing';
}
function validateImageFile(file, t) {
    if (!ALLOWED_IMAGE.has(file.type))
        return t('invalidImageType');
    if (file.size <= 0)
        return t('invalidFileEmpty');
    return null;
}
function validateVideoFile(file, t) {
    if (!ALLOWED_VIDEO.has(file.type))
        return t('invalidVideoType');
    if (file.size <= 0)
        return t('invalidFileEmpty');
    return null;
}
function normalizeTagInput(raw) {
    return raw
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#+/, '').trim())
        .filter(Boolean);
}
export function CreateStudio() {
    const { t } = useI18n();
    const { push } = useToast();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const initial = params.get('type') || 'menu';
    const [mode, setMode] = useState(['post', 'reel', 'story'].includes(initial) ? initial : 'menu');
    if (mode === 'menu') {
        return (_jsxs("div", { className: "create-studio", children: [_jsx("div", { className: "page-header", children: _jsx("h1", { children: t('create') }) }), _jsxs("div", { className: "create-menu", children: [_jsxs("button", { type: "button", className: "create-menu-item", onClick: () => setMode('post'), children: [_jsx("strong", { children: t('createPost') }), _jsx("span", { className: "muted", children: t('createPostHint') })] }), _jsxs("button", { type: "button", className: "create-menu-item", onClick: () => setMode('reel'), children: [_jsx("strong", { children: t('createReel') }), _jsx("span", { className: "muted", children: t('createReelHint') })] }), _jsxs("button", { type: "button", className: "create-menu-item", onClick: () => setMode('story'), children: [_jsx("strong", { children: t('createStory') }), _jsx("span", { className: "muted", children: t('createStoryHint') })] })] })] }));
    }
    return (_jsxs("div", { className: "create-studio", children: [_jsxs("div", { className: "page-header", children: [_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setMode('menu'), children: t('back') }), _jsx("h1", { children: mode === 'post' ? t('createPost') : mode === 'reel' ? t('createReel') : t('createStory') })] }), mode === 'post' ? _jsx(PostComposer, { onDone: (id) => navigate(id ? `/p/${id}` : '/feed') }) : null, mode === 'reel' ? _jsx(ReelComposer, { onDone: () => navigate('/reels') }) : null, mode === 'story' ? (_jsx(StoryStudio, { onCancel: () => setMode('menu'), onDone: () => {
                    push(t('storyUploaded'), 'success');
                    navigate('/feed');
                } })) : null] }));
}
function ProgressBar({ phase, pct }) {
    const { t } = useI18n();
    if (phase === 'idle' || phase === 'completed')
        return null;
    const label = phase === 'preparing'
        ? t('phasePreparing')
        : phase === 'uploading'
            ? t('phaseUploading')
            : phase === 'processing'
                ? t('phaseProcessing')
                : phase === 'publishing'
                    ? t('phasePublishing')
                    : t('phaseFailed');
    return (_jsxs("div", { className: "publish-progress", children: [_jsxs("div", { className: "publish-progress-label", children: [_jsx("span", { children: label }), pct != null && phase !== 'failed' ? _jsxs("span", { children: [Math.round(pct), "%"] }) : null] }), _jsx("div", { className: "publish-progress-track", children: _jsx("div", { className: `publish-progress-fill ${phase === 'failed' ? 'failed' : ''}`, style: { width: phase === 'failed' ? '100%' : `${pct ?? 15}%` } }) })] }));
}
function HashtagField({ tags, setTags, disabled }) {
    const { t } = useI18n();
    const [draft, setDraft] = useState('');
    function commit() {
        const next = [...tags];
        for (const tag of normalizeTagInput(draft)) {
            if (next.length >= 5)
                break;
            if (!next.some((x) => x.toLowerCase() === tag.toLowerCase()))
                next.push(tag);
        }
        setTags(next.slice(0, 5));
        setDraft('');
    }
    return (_jsxs("div", { className: "hashtag-field", children: [_jsxs("label", { className: "field-label", children: [t('hashtags'), " (", tags.length, "/5)"] }), _jsx("div", { className: "hashtag-chips", children: tags.map((tag) => (_jsxs("button", { type: "button", className: "chip active", disabled: disabled, onClick: () => setTags(tags.filter((x) => x !== tag)), children: ["#", tag, " \u00D7"] }, tag))) }), _jsxs("div", { className: "inline-actions", children: [_jsx("input", { value: draft, disabled: disabled || tags.length >= 5, onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                                e.preventDefault();
                                commit();
                            }
                        }, placeholder: t('hashtagPlaceholder') }), _jsx("button", { type: "button", className: "button button-compact", disabled: disabled, onClick: commit, children: t('add') })] }), tags.length < 1 ? _jsx("p", { className: "field-error", children: t('hashtagRequired') }) : null] }));
}
function PostComposer({ onDone }) {
    const { t } = useI18n();
    const fileRef = useRef(null);
    const replaceTarget = useRef(null);
    const [step, setStep] = useState('media');
    const [items, setItems] = useState([]);
    const [carousel, setCarousel] = useState(0);
    const [caption, setCaption] = useState('');
    const [tags, setTags] = useState([]);
    const [aspectRatio, setAspectRatio] = useState('1:1');
    const [phase, setPhase] = useState('idle');
    const [pct, setPct] = useState(null);
    const [error, setError] = useState('');
    const [publishedId, setPublishedId] = useState(null);
    const requestId = useMemo(() => newRequestId(), []);
    const uploadedIds = useRef([]);
    const sourceFiles = useRef([]);
    useEffect(() => () => {
        items.forEach((i) => URL.revokeObjectURL(i.preview));
    }, 
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
    async function applyAspect(files, ratio) {
        const r = ratio === '3:4' ? 3 / 4 : 1;
        const next = [];
        for (const file of files) {
            let out = file;
            try {
                out = await centerAspectCrop(file, r);
            }
            catch {
                out = file;
            }
            next.push({
                id: `${Date.now()}_${Math.random()}`,
                file: out,
                preview: URL.createObjectURL(out)
            });
        }
        return next;
    }
    async function onPick(files, replaceIndex) {
        if (!files?.length)
            return;
        setError('');
        const picked = Array.from(files);
        for (const file of picked) {
            const invalid = validateImageFile(file, t);
            if (invalid) {
                setError(invalid);
                return;
            }
        }
        let sources = [...sourceFiles.current];
        if (replaceIndex != null && replaceIndex >= 0 && replaceIndex < sources.length && picked[0]) {
            sources[replaceIndex] = picked[0];
        }
        else {
            for (const f of picked) {
                if (sources.length >= MAX_POST_IMAGES) {
                    setError(t('maxImagesReached'));
                    break;
                }
                sources.push(f);
            }
        }
        sourceFiles.current = sources;
        items.forEach((i) => URL.revokeObjectURL(i.preview));
        const next = await applyAspect(sources, aspectRatio);
        setItems(next);
        uploadedIds.current = [];
        if (next.length)
            setStep('edit');
        if (fileRef.current)
            fileRef.current.value = '';
    }
    async function changeAspect(nextAspect) {
        setAspectRatio(nextAspect);
        if (!sourceFiles.current.length)
            return;
        items.forEach((i) => URL.revokeObjectURL(i.preview));
        const next = await applyAspect(sourceFiles.current, nextAspect);
        setItems(next);
        uploadedIds.current = [];
        setCarousel(0);
    }
    function move(index, dir) {
        const j = index + dir;
        if (j < 0 || j >= items.length)
            return;
        const copy = [...items];
        const tmp = copy[index];
        copy[index] = copy[j];
        copy[j] = tmp;
        setItems(copy);
        setCarousel(j);
    }
    async function publish() {
        if (isBusyPhase(phase))
            return;
        if (!items.length || tags.length < 1 || tags.length > 5) {
            setError(t('hashtagRequired'));
            return;
        }
        setPhase('preparing');
        setPct(0);
        setError('');
        try {
            const mediaIds = [...uploadedIds.current];
            for (let i = mediaIds.length; i < items.length; i++) {
                setPhase('uploading');
                const base = (i / items.length) * 80;
                const id = await uploadMediaFileWithMeta(items[i].file, 'post', {
                    onProgress: (p) => setPct(base + (p / 100) * (80 / items.length))
                });
                mediaIds.push(id);
                uploadedIds.current = mediaIds;
            }
            setPhase('publishing');
            setPct(90);
            const post = await createPost({
                caption,
                mediaIds,
                hashtags: tags,
                aspectRatio,
                clientRequestId: requestId
            });
            setPct(100);
            setPhase('completed');
            setPublishedId(post?.id || null);
            setStep('done');
        }
        catch (err) {
            setPhase('failed');
            setError(err instanceof Error ? err.message : t('errorGeneric'));
            // Keep caption, tags, and already-uploaded media ids for retry.
        }
    }
    if (step === 'done') {
        return (_jsxs("div", { className: "publish-success", children: [_jsx("div", { className: "success-check", "aria-hidden": true, children: "\u2713" }), _jsx("h2", { children: t('publishSuccess') }), _jsxs("div", { className: "inline-actions", children: [publishedId ? (_jsx(Link, { className: "button", to: `/p/${publishedId}`, children: t('openPost') })) : null, _jsx("button", { type: "button", className: "button button-ghost", onClick: () => onDone(publishedId || undefined), children: t('home') })] })] }));
    }
    return (_jsxs("div", { children: [_jsx(ProgressBar, { phase: phase, pct: pct }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsx("input", { ref: fileRef, className: "sr-only", type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", multiple: replaceTarget.current == null, "data-testid": "create-post-file", onChange: (e) => {
                    const replaceAt = replaceTarget.current;
                    replaceTarget.current = null;
                    void onPick(e.target.files, replaceAt ?? undefined);
                } }), step === 'media' || !items.length ? (_jsx("button", { type: "button", className: "button media-pick-btn", disabled: isBusyPhase(phase), onClick: () => {
                    replaceTarget.current = null;
                    fileRef.current?.click();
                }, children: t('chooseFromGallery') })) : null, items.length ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "aspect-picker", role: "group", "aria-label": t('aspectRatio'), children: [_jsx("span", { className: "muted tiny", children: t('aspectRatio') }), _jsxs("div", { className: "aspect-picker-row", children: [_jsxs("button", { type: "button", className: `aspect-chip ${aspectRatio === '1:1' ? 'on' : ''}`, disabled: isBusyPhase(phase), onClick: () => void changeAspect('1:1'), children: [_jsx("span", { className: "aspect-preview ratio-1-1", "aria-hidden": true }), "1:1"] }), _jsxs("button", { type: "button", className: `aspect-chip ${aspectRatio === '3:4' ? 'on' : ''}`, disabled: isBusyPhase(phase), onClick: () => void changeAspect('3:4'), children: [_jsx("span", { className: "aspect-preview ratio-3-4", "aria-hidden": true }), "3:4"] })] })] }), _jsxs("div", { className: `create-carousel aspect-${aspectRatio === '3:4' ? '3-4' : '1-1'}`, "data-testid": "create-post-carousel", children: [_jsx("img", { src: items[carousel]?.preview, alt: "" }), _jsxs("p", { className: "muted tiny", children: [carousel + 1, "/", items.length, " \u00B7 ", (items[carousel]?.file.size || 0) > 1024
                                        ? `${Math.round((items[carousel].file.size / 1024) * 10) / 10} KB`
                                        : `${items[carousel]?.file.size || 0} B`] }), _jsx("div", { className: "carousel-dots", children: items.map((it, i) => (_jsx("button", { type: "button", className: i === carousel ? 'active' : '', "aria-label": `image ${i + 1}`, onClick: () => setCarousel(i) }, it.id))) })] }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: "button button-ghost button-compact", disabled: isBusyPhase(phase), onClick: () => move(carousel, -1), children: "\u2190" }), _jsx("button", { type: "button", className: "button button-ghost button-compact", disabled: isBusyPhase(phase), onClick: () => move(carousel, 1), children: "\u2192" }), _jsx("button", { type: "button", className: "button button-ghost button-compact", disabled: isBusyPhase(phase), onClick: () => {
                                    const copy = items.filter((_, i) => i !== carousel);
                                    items[carousel] && URL.revokeObjectURL(items[carousel].preview);
                                    sourceFiles.current = sourceFiles.current.filter((_, i) => i !== carousel);
                                    setItems(copy);
                                    setCarousel(0);
                                    uploadedIds.current = [];
                                    if (!copy.length)
                                        setStep('media');
                                }, children: t('remove') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", disabled: isBusyPhase(phase), onClick: () => {
                                    replaceTarget.current = carousel;
                                    fileRef.current?.click();
                                }, children: t('replace') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", disabled: isBusyPhase(phase) || items.length >= MAX_POST_IMAGES, onClick: () => {
                                    replaceTarget.current = null;
                                    fileRef.current?.click();
                                }, children: t('add') })] }), step === 'edit' ? (_jsx("button", { type: "button", className: "button", disabled: isBusyPhase(phase), onClick: () => setStep('details'), children: t('next') })) : null] })) : null, step === 'details' ? (_jsxs("form", { className: "create-form", onSubmit: (e) => {
                    e.preventDefault();
                    void publish();
                }, children: [_jsx("textarea", { value: caption, disabled: isBusyPhase(phase), onChange: (e) => setCaption(e.target.value), placeholder: t('caption'), rows: 3 }), _jsx(HashtagField, { tags: tags, setTags: setTags, disabled: isBusyPhase(phase) }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: "button button-ghost", disabled: isBusyPhase(phase), onClick: () => setStep('edit'), children: t('back') }), _jsx("button", { className: "button", type: "submit", disabled: isBusyPhase(phase), children: t('publish') })] }), phase === 'failed' ? (_jsx("button", { type: "button", className: "button", onClick: () => void publish(), children: t('retry') })) : null] })) : null] }));
}
function ReelComposer({ onDone }) {
    const { t } = useI18n();
    const fileRef = useRef(null);
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [duration, setDuration] = useState(0);
    const [start, setStart] = useState(0);
    const [end, setEnd] = useState(60);
    const [caption, setCaption] = useState('');
    const [tags, setTags] = useState([]);
    const [aspectRatio, setAspectRatio] = useState('9:16');
    const [phase, setPhase] = useState('idle');
    const [pct, setPct] = useState(null);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const requestId = useMemo(() => newRequestId(), []);
    const uploadedId = useRef(null);
    useEffect(() => () => {
        if (preview)
            URL.revokeObjectURL(preview);
    }, [preview]);
    async function onPick(f) {
        if (!f)
            return;
        const invalid = validateVideoFile(f, t);
        if (invalid) {
            setError(invalid);
            if (fileRef.current)
                fileRef.current.value = '';
            return;
        }
        setError('');
        if (preview)
            URL.revokeObjectURL(preview);
        setFile(f);
        setPreview(URL.createObjectURL(f));
        uploadedId.current = null;
        try {
            const d = await loadVideoDuration(f);
            setDuration(d);
            setStart(0);
            setEnd(Math.min(60, d));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        if (fileRef.current)
            fileRef.current.value = '';
    }
    async function publish() {
        if (isBusyPhase(phase))
            return;
        if (!file || tags.length < 1) {
            setError(t('hashtagRequired'));
            return;
        }
        if (end - start > 60.05) {
            setError(t('videoTooLong'));
            return;
        }
        setPhase('preparing');
        setPct(5);
        setError('');
        try {
            let mediaId = uploadedId.current;
            let durationSeconds = end - start;
            if (!mediaId) {
                let serverTrim = false;
                try {
                    const st = await fetchVideoTrimStatus();
                    serverTrim = Boolean(st?.available);
                }
                catch {
                    serverTrim = false;
                }
                if (serverTrim) {
                    setPhase('uploading');
                    const sourceId = await uploadMediaFileWithMeta(file, 'reel', {
                        onProgress: (p) => setPct(p * 0.55)
                    });
                    setPhase('processing');
                    setPct(60);
                    const trimmed = await trimVideoServer({
                        mediaId: sourceId,
                        startSeconds: start,
                        endSeconds: end
                    });
                    mediaId = trimmed.mediaId;
                    durationSeconds = trimmed.durationSeconds;
                    setPct(90);
                }
                else {
                    setPhase('processing');
                    const trimmed = await trimVideoToBlob(file, start, end, (p) => setPct(p * 0.5));
                    durationSeconds = trimmed.durationSeconds;
                    const out = new File([trimmed.blob], `reel-${Date.now()}.webm`, {
                        type: trimmed.blob.type || 'video/webm'
                    });
                    setPhase('uploading');
                    mediaId = await uploadMediaFileWithMeta(out, 'reel', {
                        durationSeconds,
                        onProgress: (p) => setPct(50 + p * 0.4)
                    });
                }
                uploadedId.current = mediaId;
            }
            setPhase('publishing');
            setPct(95);
            await createReel({
                mediaId,
                caption,
                hashtags: tags,
                aspectRatio,
                clientRequestId: requestId
            });
            setPct(100);
            setPhase('completed');
            setDone(true);
        }
        catch (err) {
            setPhase('failed');
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    if (done) {
        return (_jsxs("div", { className: "publish-success", children: [_jsx("div", { className: "success-check", children: "\u2713" }), _jsx("h2", { children: t('publishSuccess') }), _jsx("button", { type: "button", className: "button", onClick: onDone, children: t('reels') })] }));
    }
    return (_jsxs("div", { className: "create-form create-reel-form", children: [_jsx(ProgressBar, { phase: phase, pct: pct }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsx("input", { ref: fileRef, className: "sr-only", type: "file", accept: "video/mp4,video/webm,video/quicktime", "data-testid": "create-reel-file", onChange: (e) => void onPick(e.target.files?.[0]) }), _jsx("button", { type: "button", className: "button media-pick-btn", disabled: isBusyPhase(phase), onClick: () => fileRef.current?.click(), children: file ? t('changeMedia') : t('chooseFile') }), preview ? (_jsx("video", { src: preview, controls: true, className: `create-preview-video aspect-${aspectRatio === '16:9' ? '16-9' : '9-16'}`, "data-testid": "create-reel-preview" })) : null, _jsxs("div", { className: "aspect-picker", role: "group", "aria-label": t('aspectRatio'), children: [_jsx("span", { className: "muted tiny", children: t('aspectRatio') }), _jsxs("div", { className: "aspect-picker-row", children: [_jsxs("button", { type: "button", className: `aspect-chip ${aspectRatio === '9:16' ? 'on' : ''}`, disabled: isBusyPhase(phase), onClick: () => setAspectRatio('9:16'), children: [_jsx("span", { className: "aspect-preview ratio-9-16", "aria-hidden": true }), "9:16"] }), _jsxs("button", { type: "button", className: `aspect-chip ${aspectRatio === '16:9' ? 'on' : ''}`, disabled: isBusyPhase(phase), onClick: () => setAspectRatio('16:9'), children: [_jsx("span", { className: "aspect-preview ratio-16-9", "aria-hidden": true }), "16:9"] })] })] }), duration > 0 && file ? (_jsxs(_Fragment, { children: [duration > 60 ? _jsx("p", { className: "field-error", children: t('videoMustTrim') }) : null, _jsx(VideoFilmstripTrim, { file: file, duration: duration, start: start, end: end, maxClip: 60, onChange: ({ start: s, end: e }) => {
                            setStart(s);
                            setEnd(e);
                        } })] })) : null, _jsxs("label", { className: "create-field", children: [_jsx("span", { children: t('caption') }), _jsx("textarea", { value: caption, onChange: (e) => setCaption(e.target.value), placeholder: t('caption'), rows: 4, dir: "auto" })] }), _jsx(HashtagField, { tags: tags, setTags: setTags }), _jsx("button", { type: "button", className: "button", disabled: !file || isBusyPhase(phase), onClick: () => void publish(), children: t('publish') }), phase === 'failed' ? (_jsx("button", { type: "button", className: "button button-ghost", onClick: () => void publish(), children: t('retry') })) : null] }));
}
/** Keep old export name for routes that still import CreatePostPage */
export { CreateStudio as CreatePostPage };
