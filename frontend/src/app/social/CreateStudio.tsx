import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  createPost,
  createReel,
  fetchVideoTrimStatus,
  trimVideoServer,
  uploadMediaFileWithMeta
} from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { centerAspectCrop } from '@/lib/imageCrop';
import type { PostAspectChoice, ReelAspectChoice } from '@/lib/mediaAspect';
import { loadVideoDuration, trimVideoToBlob } from '@/lib/videoTrim';
import { ErrorBanner } from '../ui/States';
import { useToast } from '../ui/Toast';
import { VideoFilmstripTrim } from '../ui/VideoFilmstripTrim';
import { StoryStudio } from './StoryStudio';

type Mode = 'menu' | 'post' | 'reel' | 'story';
type Phase = 'idle' | 'preparing' | 'uploading' | 'processing' | 'publishing' | 'completed' | 'failed';

type ImageItem = { id: string; file: File; preview: string };

/** Align with backend ALLOWED_MIME_BY_TYPE. Size limits are enforced server-side only. */
const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_VIDEO = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const MAX_POST_IMAGES = 10;

function newRequestId() {
  return `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isBusyPhase(phase: Phase) {
  return phase === 'preparing' || phase === 'uploading' || phase === 'processing' || phase === 'publishing';
}

type Translate = (k: 'invalidImageType' | 'invalidVideoType' | 'invalidFileEmpty' | 'fileTooLarge') => string;

function validateImageFile(file: File, t: Translate): string | null {
  if (!ALLOWED_IMAGE.has(file.type)) return t('invalidImageType');
  if (file.size <= 0) return t('invalidFileEmpty');
  return null;
}

function validateVideoFile(file: File, t: Translate): string | null {
  if (!ALLOWED_VIDEO.has(file.type)) return t('invalidVideoType');
  if (file.size <= 0) return t('invalidFileEmpty');
  return null;
}

function normalizeTagInput(raw: string): string[] {
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
  const initial = (params.get('type') as Mode) || 'menu';
  const [mode, setMode] = useState<Mode>(['post', 'reel', 'story'].includes(initial) ? initial : 'menu');

  if (mode === 'menu') {
    return (
      <div className="create-studio">
        <div className="page-header">
          <h1>{t('create')}</h1>
        </div>
        <div className="create-menu">
          <button type="button" className="create-menu-item" onClick={() => setMode('post')}>
            <strong>{t('createPost')}</strong>
            <span className="muted">{t('createPostHint')}</span>
          </button>
          <button type="button" className="create-menu-item" onClick={() => setMode('reel')}>
            <strong>{t('createReel')}</strong>
            <span className="muted">{t('createReelHint')}</span>
          </button>
          <button type="button" className="create-menu-item" onClick={() => setMode('story')}>
            <strong>{t('createStory')}</strong>
            <span className="muted">{t('createStoryHint')}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="create-studio">
      <div className="page-header">
        <button type="button" className="button button-ghost button-compact" onClick={() => setMode('menu')}>
          {t('back')}
        </button>
        <h1>
          {mode === 'post' ? t('createPost') : mode === 'reel' ? t('createReel') : t('createStory')}
        </h1>
      </div>
      {mode === 'post' ? <PostComposer onDone={(id) => navigate(id ? `/p/${id}` : '/feed')} /> : null}
      {mode === 'reel' ? <ReelComposer onDone={() => navigate('/reels')} /> : null}
      {mode === 'story' ? (
        <StoryStudio
          onCancel={() => setMode('menu')}
          onDone={() => {
            push(t('storyUploaded'), 'success');
            navigate('/feed');
          }}
        />
      ) : null}
    </div>
  );
}

function ProgressBar({ phase, pct }: { phase: Phase; pct: number | null }) {
  const { t } = useI18n();
  if (phase === 'idle' || phase === 'completed') return null;
  const label =
    phase === 'preparing'
      ? t('phasePreparing')
      : phase === 'uploading'
        ? t('phaseUploading')
        : phase === 'processing'
          ? t('phaseProcessing')
          : phase === 'publishing'
            ? t('phasePublishing')
            : t('phaseFailed');
  return (
    <div className="publish-progress">
      <div className="publish-progress-label">
        <span>{label}</span>
        {pct != null && phase !== 'failed' ? <span>{Math.round(pct)}%</span> : null}
      </div>
      <div className="publish-progress-track">
        <div
          className={`publish-progress-fill ${phase === 'failed' ? 'failed' : ''}`}
          style={{ width: phase === 'failed' ? '100%' : `${pct ?? 15}%` }}
        />
      </div>
    </div>
  );
}

function HashtagField({
  tags,
  setTags,
  disabled
}: {
  tags: string[];
  setTags: (t: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  function commit() {
    const next = [...tags];
    for (const tag of normalizeTagInput(draft)) {
      if (next.length >= 5) break;
      if (!next.some((x) => x.toLowerCase() === tag.toLowerCase())) next.push(tag);
    }
    setTags(next.slice(0, 5));
    setDraft('');
  }
  return (
    <div className="hashtag-field">
      <label className="field-label">
        {t('hashtags')} ({tags.length}/5)
      </label>
      <div className="hashtag-chips">
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="chip active"
            disabled={disabled}
            onClick={() => setTags(tags.filter((x) => x !== tag))}
          >
            #{tag} ×
          </button>
        ))}
      </div>
      <div className="inline-actions">
        <input
          value={draft}
          disabled={disabled || tags.length >= 5}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={t('hashtagPlaceholder')}
        />
        <button type="button" className="button button-compact" disabled={disabled} onClick={commit}>
          {t('add')}
        </button>
      </div>
      {tags.length < 1 ? <p className="field-error">{t('hashtagRequired')}</p> : null}
    </div>
  );
}

function PostComposer({ onDone }: { onDone: (id?: string) => void }) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const replaceTarget = useRef<number | null>(null);
  const [step, setStep] = useState<'media' | 'edit' | 'details' | 'done'>('media');
  const [items, setItems] = useState<ImageItem[]>([]);
  const [carousel, setCarousel] = useState(0);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState<PostAspectChoice>('1:1');
  const [phase, setPhase] = useState<Phase>('idle');
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState(false);
  const requestId = useMemo(() => newRequestId(), []);
  const uploadedIds = useRef<string[]>([]);
  const sourceFiles = useRef<File[]>([]);

  useEffect(
    () => () => {
      items.forEach((i) => URL.revokeObjectURL(i.preview));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function applyAspect(files: File[], ratio: PostAspectChoice): Promise<ImageItem[]> {
    const r = ratio === '3:4' ? 3 / 4 : 1;
    const next: ImageItem[] = [];
    for (const file of files) {
      let out: File = file;
      try {
        out = await centerAspectCrop(file, r);
      } catch {
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

  async function onPick(files: FileList | null, replaceIndex?: number) {
    if (!files?.length) return;
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
    } else {
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
    if (next.length) setStep('edit');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function changeAspect(nextAspect: PostAspectChoice) {
    setAspectRatio(nextAspect);
    if (!sourceFiles.current.length) return;
    items.forEach((i) => URL.revokeObjectURL(i.preview));
    const next = await applyAspect(sourceFiles.current, nextAspect);
    setItems(next);
    uploadedIds.current = [];
    setCarousel(0);
  }

  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const copy = [...items];
    const tmp = copy[index]!;
    copy[index] = copy[j]!;
    copy[j] = tmp;
    setItems(copy);
    setCarousel(j);
  }

  async function publish() {
    if (isBusyPhase(phase)) return;
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
        const id = await uploadMediaFileWithMeta(items[i]!.file, 'post', {
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
      setPendingReview(
        Boolean(
          post?.moderationStatus === 'PENDING_REVIEW' ||
            post?.moderation?.badge ||
            post?.media?.[0]?.media?.mediaRedacted
        )
      );
      setStep('done');
    } catch (err) {
      setPhase('failed');
      setError(err instanceof Error ? err.message : t('errorGeneric'));
      // Keep caption, tags, and already-uploaded media ids for retry.
    }
  }

  if (step === 'done') {
    return (
      <div className="publish-success">
        <div className="success-check" aria-hidden>
          ✓
        </div>
        <h2>{pendingReview ? 'تم الإرسال للمراجعة' : t('publishSuccess')}</h2>
        {pendingReview ? (
          <p className="muted" dir="rtl">
            منشورك قيد الفحص ولن يظهر للعامة حتى تتم الموافقة. يمكنك متابعة الحالة من الملف الشخصي أو «حالة الحساب
            والمخالفات».
          </p>
        ) : null}
        <div className="inline-actions">
          {publishedId ? (
            <Link className="button" to={pendingReview ? '/settings/moderation' : `/p/${publishedId}`}>
              {pendingReview ? 'حالة المخالفات' : t('openPost')}
            </Link>
          ) : null}
          <button type="button" className="button button-ghost" onClick={() => onDone(publishedId || undefined)}>
            {t('home')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ProgressBar phase={phase} pct={pct} />
      {error ? <ErrorBanner message={error} /> : null}
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple={replaceTarget.current == null}
        data-testid="create-post-file"
        onChange={(e) => {
          const replaceAt = replaceTarget.current;
          replaceTarget.current = null;
          void onPick(e.target.files, replaceAt ?? undefined);
        }}
      />
      {step === 'media' || !items.length ? (
        <button
          type="button"
          className="button media-pick-btn"
          disabled={isBusyPhase(phase)}
          onClick={() => {
            replaceTarget.current = null;
            fileRef.current?.click();
          }}
        >
          {t('chooseFromGallery')}
        </button>
      ) : null}

      {items.length ? (
        <>
          <div className="aspect-picker" role="group" aria-label={t('aspectRatio')}>
            <span className="muted tiny">{t('aspectRatio')}</span>
            <div className="aspect-picker-row">
              <button
                type="button"
                className={`aspect-chip ${aspectRatio === '1:1' ? 'on' : ''}`}
                disabled={isBusyPhase(phase)}
                onClick={() => void changeAspect('1:1')}
              >
                <span className="aspect-preview ratio-1-1" aria-hidden />
                1:1
              </button>
              <button
                type="button"
                className={`aspect-chip ${aspectRatio === '3:4' ? 'on' : ''}`}
                disabled={isBusyPhase(phase)}
                onClick={() => void changeAspect('3:4')}
              >
                <span className="aspect-preview ratio-3-4" aria-hidden />
                3:4
              </button>
            </div>
          </div>
          <div className={`create-carousel aspect-${aspectRatio === '3:4' ? '3-4' : '1-1'}`} data-testid="create-post-carousel">
            <img src={items[carousel]?.preview} alt="" />
            <p className="muted tiny">
              {carousel + 1}/{items.length} · {(items[carousel]?.file.size || 0) > 1024
                ? `${Math.round((items[carousel]!.file.size / 1024) * 10) / 10} KB`
                : `${items[carousel]?.file.size || 0} B`}
            </p>
            <div className="carousel-dots">
              {items.map((it, i) => (
                <button
                  key={it.id}
                  type="button"
                  className={i === carousel ? 'active' : ''}
                  aria-label={`image ${i + 1}`}
                  onClick={() => setCarousel(i)}
                />
              ))}
            </div>
          </div>
          <div className="inline-actions">
            <button type="button" className="button button-ghost button-compact" disabled={isBusyPhase(phase)} onClick={() => move(carousel, -1)}>
              ←
            </button>
            <button type="button" className="button button-ghost button-compact" disabled={isBusyPhase(phase)} onClick={() => move(carousel, 1)}>
              →
            </button>
            <button
              type="button"
              className="button button-ghost button-compact"
              disabled={isBusyPhase(phase)}
              onClick={() => {
                const copy = items.filter((_, i) => i !== carousel);
                items[carousel] && URL.revokeObjectURL(items[carousel]!.preview);
                sourceFiles.current = sourceFiles.current.filter((_, i) => i !== carousel);
                setItems(copy);
                setCarousel(0);
                uploadedIds.current = [];
                if (!copy.length) setStep('media');
              }}
            >
              {t('remove')}
            </button>
            <button
              type="button"
              className="button button-ghost button-compact"
              disabled={isBusyPhase(phase)}
              onClick={() => {
                replaceTarget.current = carousel;
                fileRef.current?.click();
              }}
            >
              {t('replace')}
            </button>
            <button
              type="button"
              className="button button-ghost button-compact"
              disabled={isBusyPhase(phase) || items.length >= MAX_POST_IMAGES}
              onClick={() => {
                replaceTarget.current = null;
                fileRef.current?.click();
              }}
            >
              {t('add')}
            </button>
          </div>
          {step === 'edit' ? (
            <button type="button" className="button" disabled={isBusyPhase(phase)} onClick={() => setStep('details')}>
              {t('next')}
            </button>
          ) : null}
        </>
      ) : null}

      {step === 'details' ? (
        <form
          className="create-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void publish();
          }}
        >
          <textarea
            value={caption}
            disabled={isBusyPhase(phase)}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={t('caption')}
            rows={3}
          />
          <HashtagField tags={tags} setTags={setTags} disabled={isBusyPhase(phase)} />
          <div className="inline-actions">
            <button type="button" className="button button-ghost" disabled={isBusyPhase(phase)} onClick={() => setStep('edit')}>
              {t('back')}
            </button>
            <button className="button" type="submit" disabled={isBusyPhase(phase)}>
              {t('publish')}
            </button>
          </div>
          {phase === 'failed' ? (
            <button type="button" className="button" onClick={() => void publish()}>
              {t('retry')}
            </button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function ReelComposer({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(60);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState<ReelAspectChoice>('9:16');
  const [phase, setPhase] = useState<Phase>('idle');
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const requestId = useMemo(() => newRequestId(), []);
  const uploadedId = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );

  async function onPick(f?: File) {
    if (!f) return;
    const invalid = validateVideoFile(f, t);
    if (invalid) {
      setError(invalid);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setError('');
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    uploadedId.current = null;
    try {
      const d = await loadVideoDuration(f);
      setDuration(d);
      setStart(0);
      setEnd(Math.min(60, d));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function publish() {
    if (isBusyPhase(phase)) return;
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
        } catch {
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
        } else {
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
    } catch (err) {
      setPhase('failed');
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  if (done) {
    return (
      <div className="publish-success">
        <div className="success-check">✓</div>
        <h2>{t('publishSuccess')}</h2>
        <button type="button" className="button" onClick={onDone}>
          {t('reels')}
        </button>
      </div>
    );
  }

  return (
    <div className="create-form create-reel-form">
      <ProgressBar phase={phase} pct={pct} />
      {error ? <ErrorBanner message={error} /> : null}
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        data-testid="create-reel-file"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <button
        type="button"
        className="button media-pick-btn"
        disabled={isBusyPhase(phase)}
        onClick={() => fileRef.current?.click()}
      >
        {file ? t('changeMedia') : t('chooseFile')}
      </button>
      {preview ? (
        <video
          src={preview}
          controls
          className={`create-preview-video aspect-${aspectRatio === '16:9' ? '16-9' : '9-16'}`}
          data-testid="create-reel-preview"
        />
      ) : null}
      <div className="aspect-picker" role="group" aria-label={t('aspectRatio')}>
        <span className="muted tiny">{t('aspectRatio')}</span>
        <div className="aspect-picker-row">
          <button
            type="button"
            className={`aspect-chip ${aspectRatio === '9:16' ? 'on' : ''}`}
            disabled={isBusyPhase(phase)}
            onClick={() => setAspectRatio('9:16')}
          >
            <span className="aspect-preview ratio-9-16" aria-hidden />
            9:16
          </button>
          <button
            type="button"
            className={`aspect-chip ${aspectRatio === '16:9' ? 'on' : ''}`}
            disabled={isBusyPhase(phase)}
            onClick={() => setAspectRatio('16:9')}
          >
            <span className="aspect-preview ratio-16-9" aria-hidden />
            16:9
          </button>
        </div>
      </div>
      {duration > 0 && file ? (
        <>
          {duration > 60 ? <p className="field-error">{t('videoMustTrim')}</p> : null}
          <VideoFilmstripTrim
            file={file}
            duration={duration}
            start={start}
            end={end}
            maxClip={60}
            onChange={({ start: s, end: e }) => {
              setStart(s);
              setEnd(e);
            }}
          />
        </>
      ) : null}
      <label className="create-field">
        <span>{t('caption')}</span>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={t('caption')}
          rows={4}
          dir="auto"
        />
      </label>
      <HashtagField tags={tags} setTags={setTags} />
      <button type="button" className="button" disabled={!file || isBusyPhase(phase)} onClick={() => void publish()}>
        {t('publish')}
      </button>
      {phase === 'failed' ? (
        <button type="button" className="button button-ghost" onClick={() => void publish()}>
          {t('retry')}
        </button>
      ) : null}
    </div>
  );
}

/** Keep old export name for routes that still import CreatePostPage */
export { CreateStudio as CreatePostPage };
