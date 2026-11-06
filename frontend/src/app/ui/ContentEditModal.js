import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveMediaUrl, updatePost, updateReel, uploadMediaFileWithMeta } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner } from './States';
function extractHashtagList(item) {
    const rows = Array.isArray(item?.hashtags) ? item.hashtags : [];
    const tags = [];
    for (const row of rows) {
        const record = row;
        const raw = record?.hashtag?.tag || record?.tag || '';
        const tag = String(raw).replace(/^#+/, '').trim();
        if (tag)
            tags.push(tag);
    }
    return [...new Set(tags)].slice(0, 5);
}
function isVideoPreview(kind, item, file, index = 0) {
    if (file?.type.startsWith('video/'))
        return true;
    if (kind === 'reel')
        return true;
    const mime = item?.media?.[index]?.media?.mimeType ||
        item?.media?.[index]?.mimeType ||
        item?.media?.mimeType ||
        '';
    return String(mime).startsWith('video/');
}
export function ContentEditModal({ kind, item, onClose, onSaved }) {
    const { t } = useI18n();
    const fileRef = useRef(null);
    const [caption, setCaption] = useState(String(item?.caption || ''));
    const [tags, setTags] = useState(() => extractHashtagList(item));
    const [tagDraft, setTagDraft] = useState('');
    const [files, setFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    const [pct, setPct] = useState(null);
    const [error, setError] = useState('');
    const previewUrls = useMemo(() => {
        if (files.length)
            return files.map((f) => URL.createObjectURL(f));
        if (kind === 'reel') {
            const u = resolveMediaUrl(item?.media?.secureUrl || item?.media?.posterUrl);
            return u ? [u] : [];
        }
        const media = Array.isArray(item?.media) ? item.media : [];
        return media
            .map((m) => resolveMediaUrl(m?.media?.secureUrl || m?.media?.posterUrl || m?.secureUrl))
            .filter(Boolean);
    }, [files, item, kind]);
    useEffect(() => {
        return () => {
            for (const u of previewUrls) {
                if (u.startsWith('blob:'))
                    URL.revokeObjectURL(u);
            }
        };
    }, [previewUrls]);
    function addTag(raw) {
        const cleaned = raw
            .replace(/^#+/, '')
            .trim()
            .replace(/\s+/g, '');
        if (!cleaned)
            return;
        setTags((prev) => {
            if (prev.includes(cleaned) || prev.length >= 5)
                return prev;
            return [...prev, cleaned];
        });
        setTagDraft('');
    }
    function removeTag(tag) {
        setTags((prev) => prev.filter((x) => x !== tag));
    }
    async function save() {
        setBusy(true);
        setError('');
        setPct(0);
        try {
            const hashtags = tags.slice(0, 5);
            if (kind === 'post') {
                let mediaIds;
                if (files.length) {
                    mediaIds = [];
                    for (let i = 0; i < files.length; i++) {
                        const f = files[i];
                        const id = await uploadMediaFileWithMeta(f, 'post', {
                            onProgress: (p) => setPct(((i + p / 100) / files.length) * 100)
                        });
                        mediaIds.push(id);
                    }
                }
                const next = await updatePost(item.id, {
                    caption,
                    hashtags,
                    ...(mediaIds ? { mediaIds } : {})
                });
                onSaved(next);
            }
            else {
                let mediaId;
                if (files[0]) {
                    mediaId = await uploadMediaFileWithMeta(files[0], 'reel', {
                        onProgress: setPct
                    });
                }
                const next = await updateReel(item.id, {
                    caption,
                    hashtags,
                    ...(mediaId ? { mediaId } : {})
                });
                onSaved(next);
            }
            onClose();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
            setPct(null);
        }
    }
    const captionLabel = kind === 'reel' ? t('videoDescription') : t('caption');
    return (_jsx("div", { className: "sheet-overlay content-edit-overlay", role: "dialog", "aria-modal": "true", children: _jsxs("div", { className: "share-panel sheet-dialog content-edit-panel", dir: "rtl", children: [_jsxs("div", { className: "reel-sheet-head", children: [_jsx("strong", { children: t('edit') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: onClose, disabled: busy, children: t('close') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsx("div", { className: `content-edit-preview${kind === 'reel' ? ' is-reel' : ''}`, children: previewUrls.map((src, i) => isVideoPreview(kind, item, files[i], i) ? (_jsx("div", { className: "content-edit-media-frame", children: _jsx("video", { src: src, muted: true, controls: true, playsInline: true, preload: "metadata" }) }, src + i)) : (_jsx("div", { className: "content-edit-media-frame", children: _jsx("img", { src: src, alt: "" }) }, src + i))) }), _jsxs("label", { className: "content-edit-field", children: [_jsx("span", { children: captionLabel }), _jsx("textarea", { value: caption, onChange: (e) => setCaption(e.target.value), rows: 4, disabled: busy, maxLength: 2200, dir: "auto" })] }), _jsxs("div", { className: "content-edit-field content-edit-hashtags", children: [_jsxs("span", { children: ["# ", t('hashtags'), " (", tags.length, "/5)"] }), _jsxs("div", { className: "hashtag-chips content-edit-tag-chips", children: [tags.map((tag) => (_jsxs("button", { type: "button", className: "chip active", disabled: busy, onClick: () => removeTag(tag), "aria-label": `${t('remove')} #${tag}`, children: ["#", tag, " \u00D7"] }, tag))), !tags.length ? _jsx("span", { className: "muted tiny", children: t('hashtagPlaceholder') }) : null] }), _jsxs("div", { className: "inline-actions content-edit-tag-add", children: [_jsx("input", { value: tagDraft, disabled: busy || tags.length >= 5, onChange: (e) => setTagDraft(e.target.value), onKeyDown: (e) => {
                                        if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                                            e.preventDefault();
                                            addTag(tagDraft);
                                        }
                                    }, placeholder: t('hashtagPlaceholder'), dir: "auto" }), _jsx("button", { type: "button", className: "button button-compact", disabled: busy || tags.length >= 5 || !tagDraft.trim(), onClick: () => addTag(tagDraft), children: t('add') })] })] }), _jsxs("div", { className: "content-edit-actions", children: [_jsx("button", { type: "button", className: "button button-ghost", disabled: busy, onClick: () => fileRef.current?.click(), children: t('chooseFromGallery') }), _jsx("button", { type: "button", className: "button", disabled: busy, onClick: () => void save(), children: busy ? (pct != null ? `${Math.round(pct)}%` : '…') : t('save') })] }), _jsx("input", { ref: fileRef, className: "sr-only", type: "file", accept: kind === 'reel' ? 'video/*' : 'image/*,video/*', multiple: kind === 'post', onChange: (e) => {
                        const list = Array.from(e.target.files || []);
                        setFiles(kind === 'reel' ? list.slice(0, 1) : list.slice(0, 10));
                        e.target.value = '';
                    } })] }) }));
}
