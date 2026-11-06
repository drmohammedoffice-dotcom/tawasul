import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveMediaUrl, updatePost, updateReel, uploadMediaFileWithMeta } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { ErrorBanner } from './States';

type Kind = 'post' | 'reel';

type Props = {
  kind: Kind;
  item: any;
  onClose: () => void;
  onSaved: (next: any) => void;
};

function extractHashtagList(item: { hashtags?: unknown }): string[] {
  const rows = Array.isArray(item?.hashtags) ? item.hashtags : [];
  const tags: string[] = [];
  for (const row of rows) {
    const record = row as { hashtag?: { tag?: string }; tag?: string };
    const raw = record?.hashtag?.tag || record?.tag || '';
    const tag = String(raw).replace(/^#+/, '').trim();
    if (tag) tags.push(tag);
  }
  return [...new Set(tags)].slice(0, 5);
}

function isVideoPreview(kind: Kind, item: any, file?: File | null, index = 0): boolean {
  if (file?.type.startsWith('video/')) return true;
  if (kind === 'reel') return true;
  const mime =
    item?.media?.[index]?.media?.mimeType ||
    item?.media?.[index]?.mimeType ||
    item?.media?.mimeType ||
    '';
  return String(mime).startsWith('video/');
}

export function ContentEditModal({ kind, item, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [caption, setCaption] = useState(String(item?.caption || ''));
  const [tags, setTags] = useState<string[]>(() => extractHashtagList(item));
  const [tagDraft, setTagDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState('');

  const previewUrls = useMemo(() => {
    if (files.length) return files.map((f) => URL.createObjectURL(f));
    if (kind === 'reel') {
      const u = resolveMediaUrl(item?.media?.secureUrl || item?.media?.posterUrl);
      return u ? [u] : [];
    }
    const media = Array.isArray(item?.media) ? item.media : [];
    return media
      .map((m: any) => resolveMediaUrl(m?.media?.secureUrl || m?.media?.posterUrl || m?.secureUrl))
      .filter(Boolean) as string[];
  }, [files, item, kind]);

  useEffect(() => {
    return () => {
      for (const u of previewUrls) {
        if (u.startsWith('blob:')) URL.revokeObjectURL(u);
      }
    };
  }, [previewUrls]);

  function addTag(raw: string) {
    const cleaned = raw
      .replace(/^#+/, '')
      .trim()
      .replace(/\s+/g, '');
    if (!cleaned) return;
    setTags((prev) => {
      if (prev.includes(cleaned) || prev.length >= 5) return prev;
      return [...prev, cleaned];
    });
    setTagDraft('');
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((x) => x !== tag));
  }

  async function save() {
    setBusy(true);
    setError('');
    setPct(0);
    try {
      const hashtags = tags.slice(0, 5);
      if (kind === 'post') {
        let mediaIds: string[] | undefined;
        if (files.length) {
          mediaIds = [];
          for (let i = 0; i < files.length; i++) {
            const f = files[i]!;
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
      } else {
        let mediaId: string | undefined;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
      setPct(null);
    }
  }

  const captionLabel = kind === 'reel' ? t('videoDescription') : t('caption');

  return (
    <div className="sheet-overlay content-edit-overlay" role="dialog" aria-modal="true">
      <div className="share-panel sheet-dialog content-edit-panel" dir="rtl">
        <div className="reel-sheet-head">
          <strong>{t('edit')}</strong>
          <button type="button" className="button button-ghost button-compact" onClick={onClose} disabled={busy}>
            {t('close')}
          </button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}

        <div className={`content-edit-preview${kind === 'reel' ? ' is-reel' : ''}`}>
          {previewUrls.map((src, i) =>
            isVideoPreview(kind, item, files[i], i) ? (
              <div key={src + i} className="content-edit-media-frame">
                <video src={src} muted controls playsInline preload="metadata" />
              </div>
            ) : (
              <div key={src + i} className="content-edit-media-frame">
                <img src={src} alt="" />
              </div>
            )
          )}
        </div>

        <label className="content-edit-field">
          <span>{captionLabel}</span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            disabled={busy}
            maxLength={2200}
            dir="auto"
          />
        </label>

        <div className="content-edit-field content-edit-hashtags">
          <span>
            # {t('hashtags')} ({tags.length}/5)
          </span>
          <div className="hashtag-chips content-edit-tag-chips">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip active"
                disabled={busy}
                onClick={() => removeTag(tag)}
                aria-label={`${t('remove')} #${tag}`}
              >
                #{tag} ×
              </button>
            ))}
            {!tags.length ? <span className="muted tiny">{t('hashtagPlaceholder')}</span> : null}
          </div>
          <div className="inline-actions content-edit-tag-add">
            <input
              value={tagDraft}
              disabled={busy || tags.length >= 5}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                  e.preventDefault();
                  addTag(tagDraft);
                }
              }}
              placeholder={t('hashtagPlaceholder')}
              dir="auto"
            />
            <button
              type="button"
              className="button button-compact"
              disabled={busy || tags.length >= 5 || !tagDraft.trim()}
              onClick={() => addTag(tagDraft)}
            >
              {t('add')}
            </button>
          </div>
        </div>

        <div className="content-edit-actions">
          <button
            type="button"
            className="button button-ghost"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {t('chooseFromGallery')}
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => void save()}>
            {busy ? (pct != null ? `${Math.round(pct)}%` : '…') : t('save')}
          </button>
        </div>
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept={kind === 'reel' ? 'video/*' : 'image/*,video/*'}
          multiple={kind === 'post'}
          onChange={(e) => {
            const list = Array.from(e.target.files || []);
            setFiles(kind === 'reel' ? list.slice(0, 1) : list.slice(0, 10));
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
