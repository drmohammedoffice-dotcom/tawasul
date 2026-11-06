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

type Audience = 'everyone' | 'close_friends';
type Phase = 'gallery' | 'editor' | 'publishing';
type Tool = null | 'text' | 'stickers' | 'music' | 'mention' | 'draw';

type LayerBase = {
  id: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
};

type MediaLayer = LayerBase & {
  kind: 'media';
  file: File;
  url: string;
  isVideo: boolean;
};

type TextLayer = LayerBase & {
  kind: 'text';
  text: string;
  color: string;
};

type StickerLayer = LayerBase & {
  kind: 'sticker';
  emoji: string;
};

type MentionLayer = LayerBase & {
  kind: 'mention';
  username: string;
  color: string;
};

type Layer = MediaLayer | TextLayer | StickerLayer | MentionLayer;

type DrawStroke = { color: string; width: number; points: Array<{ x: number; y: number }> };

const STICKERS = ['😀', '🔥', '❤️', '✨', '😂', '👏', '🎉', '💯', '🌟', '😎', '🙏', '💪'];
const MUSIC_TRACKS = ['Original audio', 'Trending beat', 'Chill vibes', 'Arabic pop', 'Lo-fi night'];
const COLORS = ['#ffffff', '#ff2d55', '#ffcc00', '#34c759', '#5ac8fa', '#af52de', '#000000'];

function uid() {
  return `ly_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function baseTransform(): Pick<LayerBase, 'x' | 'y' | 'scale' | 'rotation' | 'flipX' | 'flipY'> {
  return { x: 50, y: 50, scale: 1, rotation: 0, flipX: false, flipY: false };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function layerCssTransform(layer: LayerBase): string {
  const sx = (layer.flipX ? -1 : 1) * layer.scale;
  const sy = (layer.flipY ? -1 : 1) * layer.scale;
  return `translate(-50%, -50%) rotate(${layer.rotation}deg) scale(${sx}, ${sy})`;
}

/** Composite layers onto 1080×1920 — x/y are percentages 0–100 */
async function composeStoryBlob(
  layers: Layer[],
  strokes: DrawStroke[]
): Promise<{ blob: Blob; fileName: string; mime: string } | null> {
  const only = layers[0];
  const videoOnly =
    layers.length === 1 && only?.kind === 'media' && only.isVideo && strokes.length === 0;
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
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  for (const layer of layers) {
    const cx = (layer.x / 100) * W;
    const cy = (layer.y / 100) * H;
    if (layer.kind === 'media') {
      if (layer.isVideo) continue;
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
      } catch {
        /* skip */
      }
    } else if (layer.kind === 'text' || layer.kind === 'mention') {
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
    } else if (layer.kind === 'sticker') {
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
    if (!first || stroke.points.length < 2) continue;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(2, stroke.width * (W / 100));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo((first.x / 100) * W, (first.y / 100) * H);
    for (let i = 1; i < stroke.points.length; i++) {
      const pt = stroke.points[i];
      if (!pt) continue;
      ctx.lineTo((pt.x / 100) * W, (pt.y / 100) * H);
    }
    ctx.stroke();
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
  );
  if (!blob) return null;
  return { blob, fileName: 'story.jpg', mime: 'image/jpeg' };
}

export function StoryStudio({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const { session } = useAuth();
  const user = session?.user;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const addMoreRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>('gallery');
  const [picked, setPicked] = useState<File[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [drawColor, setDrawColor] = useState('#ffffff');
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [commentsDisabled, setCommentsDisabled] = useState(false);
  const [musicLabel, setMusicLabel] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pct, setPct] = useState<number | null>(null);
  const [cropLayerId, setCropLayerId] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [mentionQ, setMentionQ] = useState('');
  const [mentionPeople, setMentionPeople] = useState<any[]>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [pendingTrim, setPendingTrim] = useState<{
    file: File;
    url: string;
    duration: number;
    start: number;
    end: number;
    append: boolean;
    rest: File[];
  } | null>(null);
  const [trimBusy, setTrimBusy] = useState(false);
  const dragRef = useRef<{
    id: string;
    ox: number;
    oy: number;
    lx: number;
    ly: number;
  } | null>(null);
  const rotateRef = useRef<{
    id: string;
    startAngle: number;
    startRot: number;
    cx: number;
    cy: number;
  } | null>(null);
  const scaleRef = useRef<{
    id: string;
    startDist: number;
    startScale: number;
    cx: number;
    cy: number;
  } | null>(null);

  const meName = (user as { displayName?: string } | null)?.displayName || user?.username || 'U';
  const me = getSessionSnapshot()?.user?.id;

  useEffect(() => {
    return () => {
      for (const l of layers) {
        if (l.kind === 'media') URL.revokeObjectURL(l.url);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => layers.find((l) => l.id === selectedId) || null,
    [layers, selectedId]
  );

  useEffect(() => {
    if (tool !== 'mention') return;
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
            const rows = (Array.isArray(following) ? following : []).map(
              (f: any) => f.following || f.user || f
            );
            setMentionPeople(rows.filter((u: any) => u?.id && u.id !== me).slice(0, 30));
            return;
          }
          const res = await searchAll(mentionQ.trim());
          setMentionPeople((res.users || []).filter((u: any) => u.id !== me).slice(0, 24));
        } catch {
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

  function makeMediaLayer(file: File, scale = 1): MediaLayer {
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

  function addMediaLayers(files: File[], append: boolean) {
    if (!files.length) return;
    const layersNew = files.map((f, i) => makeMediaLayer(f, append || i > 0 ? 0.92 : 1));
    if (!append) {
      setPicked(files);
      setLayers(layersNew);
      setSelectedId(layersNew[0]?.id ?? null);
      setPhase('editor');
      setStrokes([]);
      setMusicLabel(null);
    } else {
      setPicked((p) => [...p, ...files]);
      setLayers((prev) => {
        if (layersNew[0]) setSelectedId(layersNew[0].id);
        return [...prev, ...layersNew];
      });
      setPhase('editor');
    }
  }

  async function beginVideoTrim(file: File, append: boolean, rest: File[]) {
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
    } catch {
      setError(t('errorGeneric'));
    }
  }

  function ingestFiles(list: FileList | File[] | null, append: boolean) {
    if (!list || !list.length) return;
    const files = Array.from(list).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
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
    } else if (!images.length) {
      setError(t('invalidImageType'));
    }
  }

  async function confirmVideoTrim() {
    if (!pendingTrim) return;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setTrimBusy(false);
    }
  }

  function cancelVideoTrim() {
    if (!pendingTrim) return;
    URL.revokeObjectURL(pendingTrim.url);
    const { rest, append } = pendingTrim;
    setPendingTrim(null);
    if (rest[0]) void beginVideoTrim(rest[0], append || layers.length > 0, rest.slice(1));
    else if (!layers.length) setPhase('gallery');
  }

  function updateLayer(id: string, patch: Partial<Layer>) {
    setLayers((prev) => prev.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)));
  }

  function removeLayer(id: string) {
    setLayers((prev) => {
      const victim = prev.find((l) => l.id === id);
      if (victim?.kind === 'media') URL.revokeObjectURL(victim.url);
      return prev.filter((l) => l.id !== id);
    });
    if (selectedId === id) setSelectedId(null);
    if (editingTextId === id) setEditingTextId(null);
  }

  function duplicateLayer(id: string) {
    const src = layers.find((l) => l.id === id);
    if (!src) return;
    const copy: Layer = {
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

  function layerCenterClient(id: string) {
    const layer = layers.find((l) => l.id === id);
    const stage = stageRef.current;
    if (!layer || !stage) return null;
    const rect = stage.getBoundingClientRect();
    return {
      cx: rect.left + (layer.x / 100) * rect.width,
      cy: rect.top + (layer.y / 100) * rect.height
    };
  }

  function onPointerDownLayer(e: React.PointerEvent, id: string) {
    if (tool === 'draw') return;
    e.stopPropagation();
    setSelectedId(id);
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    dragRef.current = {
      id,
      ox: e.clientX,
      oy: e.clientY,
      lx: layer.x,
      ly: layer.y
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onRotatePointerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(id);
    const center = layerCenterClient(id);
    const layer = layers.find((l) => l.id === id);
    if (!center || !layer) return;
    const startAngle = (Math.atan2(e.clientY - center.cy, e.clientX - center.cx) * 180) / Math.PI;
    rotateRef.current = {
      id,
      startAngle,
      startRot: layer.rotation,
      cx: center.cx,
      cy: center.cy
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onScalePointerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(id);
    const center = layerCenterClient(id);
    const layer = layers.find((l) => l.id === id);
    if (!center || !layer) return;
    const dist = Math.hypot(e.clientX - center.cx, e.clientY - center.cy) || 1;
    scaleRef.current = {
      id,
      startDist: dist,
      startScale: layer.scale,
      cx: center.cx,
      cy: center.cy
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (tool === 'draw' && drawing && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setStrokes((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return prev;
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
    if (!d || !stageRef.current) return;
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

  function startDraw(e: React.PointerEvent) {
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
    if ((e.target as HTMLElement) === stageRef.current) {
      setSelectedId(null);
    }
  }

  function onWheelScale(e: React.WheelEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    const next = Math.min(5, Math.max(0.15, layer.scale + (e.deltaY < 0 ? 0.08 : -0.08)));
    updateLayer(id, { scale: next });
  }

  function addText(raw: string) {
    const text = raw.trim();
    if (!text) return;
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

  function addSticker(emoji: string) {
    const id = uid();
    setLayers((prev) => [...prev, { id, kind: 'sticker', emoji, ...baseTransform(), y: 40 }]);
    setSelectedId(id);
    setTool(null);
  }

  function addMention(username: string) {
    const clean = username.replace(/^@/, '').trim();
    if (!clean) return;
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
    if (!composed) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(composed.blob);
    a.download = composed.fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function publish(audience: Audience) {
    if (!layers.some((l) => l.kind === 'media')) {
      setError(t('chooseMedia'));
      return;
    }
    setPhase('publishing');
    setError('');
    setPct(0);
    try {
      const composed = await composeStoryBlob(layers, strokes);
      if (!composed) throw new Error(t('errorGeneric'));
      const file = new File([composed.blob], composed.fileName, { type: composed.mime });
      const mediaId = await uploadMediaFileWithMeta(file, 'story', { onProgress: setPct });
      await createStory(mediaId, audience, { commentsDisabled });
      onDone();
    } catch (err) {
      setPhase('editor');
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  const cropTarget = cropLayerId
    ? (layers.find((l) => l.id === cropLayerId && l.kind === 'media' && !l.isVideo) as
        | MediaLayer
        | undefined)
    : undefined;

  const onCropConfirm = useCallback(
    (blob: Blob) => {
      if (!cropLayerId) return;
      const file = new File([blob], 'cropped.jpg', { type: blob.type || 'image/jpeg' });
      const url = URL.createObjectURL(file);
      setLayers((prev) =>
        prev.map((l) => {
          if (l.id !== cropLayerId || l.kind !== 'media') return l;
          URL.revokeObjectURL(l.url);
          return { ...l, file, url, isVideo: false };
        })
      );
      setCropLayerId(null);
    },
    [cropLayerId]
  );

  if (cropTarget) {
    return (
      <AvatarCrop
        file={cropTarget.file}
        variant="free"
        onCancel={() => setCropLayerId(null)}
        onConfirm={onCropConfirm}
      />
    );
  }

  if (phase === 'gallery') {
    return (
      <div className="story-studio story-studio-gallery" dir="rtl">
        <header className="story-studio-top">
          <button type="button" className="story-studio-x" onClick={onCancel} aria-label={t('close')}>
            ×
          </button>
          <strong>{t('addToStory')}</strong>
          <span className="story-studio-spacer" />
        </header>
        <div className="story-studio-shortcuts">
          <button type="button" className="story-shortcut" onClick={() => openGalleryPicker(true)}>
            <span>📷</span>
            {t('chooseFromGallery')}
          </button>
          <button type="button" className="story-shortcut" onClick={() => setTool('music')}>
            <span>🎵</span>
            {t('storyMusic')}
          </button>
          <button type="button" className="story-shortcut" onClick={() => openGalleryPicker(true)}>
            <span>✨</span>
            {t('storyEffects')}
          </button>
          <button type="button" className="story-shortcut" onClick={() => openGalleryPicker(true)}>
            <span>▦</span>
            {t('storyCollage')}
          </button>
        </div>
        <div className="story-studio-recents-head">
          <strong>{t('recents')}</strong>
          <button type="button" className="linkish" onClick={() => openGalleryPicker(true)}>
            {t('select')}
          </button>
        </div>
        <div className="story-gallery-grid">
          <button type="button" className="story-gallery-tile camera" onClick={() => openGalleryPicker(true)}>
            <span>📷</span>
          </button>
          {picked.map((f) => (
            <div key={f.name + f.size} className="story-gallery-tile">
              {f.type.startsWith('video/') ? (
                <video src={URL.createObjectURL(f)} muted />
              ) : (
                <img src={URL.createObjectURL(f)} alt="" />
              )}
            </div>
          ))}
        </div>
        <p className="muted tiny story-gallery-hint">{t('storyGalleryHint')}</p>
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(e) => {
            ingestFiles(e.target.files, false);
            e.target.value = '';
          }}
        />
        {error ? <ErrorBanner message={error} /> : null}
      </div>
    );
  }

  return (
    <div className="story-studio story-studio-editor" dir="rtl">
      <header className="story-studio-top">
        <button
          type="button"
          className="story-studio-x"
          onClick={() => {
            if (phase === 'publishing') return;
            setPhase('gallery');
          }}
          aria-label={t('close')}
        >
          ×
        </button>
        <strong>{t('createStory')}</strong>
        <span className="story-studio-spacer" />
      </header>

      {error ? <ErrorBanner message={error} /> : null}
      {phase === 'publishing' ? (
        <p className="muted story-publish-pct">
          {t('phasePublishing')} {pct != null ? `${Math.round(pct)}%` : ''}
        </p>
      ) : null}

      {selected && !pendingTrim ? (
        <div className="story-layer-actions sticky" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => removeLayer(selected.id)}>
            {t('delete')}
          </button>
          <button type="button" onClick={() => duplicateLayer(selected.id)}>
            {t('duplicate')}
          </button>
          {selected.kind === 'text' ? (
            <button
              type="button"
              onClick={() => {
                setEditingTextId(selected.id);
                setTextDraft(selected.text);
                setTool('text');
              }}
            >
              {t('edit')}
            </button>
          ) : null}
          {selected.kind === 'media' && !selected.isVideo ? (
            <button type="button" onClick={() => setCropLayerId(selected.id)}>
              {t('crop')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => updateLayer(selected.id, { rotation: (selected.rotation - 15 + 360) % 360 })}
          >
            ↺
          </button>
          <button
            type="button"
            onClick={() => updateLayer(selected.id, { rotation: (selected.rotation + 15) % 360 })}
          >
            ↻
          </button>
          <button type="button" onClick={() => updateLayer(selected.id, { flipX: !selected.flipX })}>
            {t('flipH')}
          </button>
          <button type="button" onClick={() => updateLayer(selected.id, { flipY: !selected.flipY })}>
            {t('flipV')}
          </button>
          <button
            type="button"
            onClick={() => updateLayer(selected.id, { scale: Math.min(5, selected.scale + 0.12) })}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => updateLayer(selected.id, { scale: Math.max(0.15, selected.scale - 0.12) })}
          >
            −
          </button>
        </div>
      ) : null}

      <div
        ref={stageRef}
        className="story-canvas"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerDown={startDraw}
      >
        <svg className="story-draw-layer" viewBox="0 0 100 100" preserveAspectRatio="none">
          {strokes.map((s, i) => (
            <polyline
              key={i}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={s.points.map((p) => `${p.x},${p.y}`).join(' ')}
            />
          ))}
        </svg>

        {layers.map((layer) => {
          const style: React.CSSProperties = {
            left: `${layer.x}%`,
            top: `${layer.y}%`,
            transform: layerCssTransform(layer)
          };
          const active = selectedId === layer.id;
          const handles = active ? (
            <>
              <span
                className="story-handle rotate"
                onPointerDown={(e) => onRotatePointerDown(e, layer.id)}
                title="rotate"
              />
              <span
                className="story-handle scale tl"
                onPointerDown={(e) => onScalePointerDown(e, layer.id)}
              />
              <span
                className="story-handle scale tr"
                onPointerDown={(e) => onScalePointerDown(e, layer.id)}
              />
              <span
                className="story-handle scale bl"
                onPointerDown={(e) => onScalePointerDown(e, layer.id)}
              />
              <span
                className="story-handle scale br"
                onPointerDown={(e) => onScalePointerDown(e, layer.id)}
              />
            </>
          ) : null;
          if (layer.kind === 'media') {
            return (
              <div
                key={layer.id}
                className={`story-layer media ${active ? 'active' : ''}`}
                style={style}
                onPointerDown={(e) => onPointerDownLayer(e, layer.id)}
                onWheel={(e) => onWheelScale(e, layer.id)}
              >
                {layer.isVideo ? (
                  <video src={layer.url} muted loop autoPlay playsInline />
                ) : (
                  <img src={layer.url} alt="" draggable={false} />
                )}
                {handles}
              </div>
            );
          }
          if (layer.kind === 'text') {
            return (
              <div
                key={layer.id}
                className={`story-layer text ${active ? 'active' : ''}`}
                style={{ ...style, color: layer.color }}
                onPointerDown={(e) => onPointerDownLayer(e, layer.id)}
                onWheel={(e) => onWheelScale(e, layer.id)}
                onDoubleClick={() => {
                  setEditingTextId(layer.id);
                  setTextDraft(layer.text);
                  setTool('text');
                }}
              >
                {layer.text}
                {handles}
              </div>
            );
          }
          if (layer.kind === 'mention') {
            return (
              <div
                key={layer.id}
                className={`story-layer text mention ${active ? 'active' : ''}`}
                style={{ ...style, color: layer.color }}
                onPointerDown={(e) => onPointerDownLayer(e, layer.id)}
                onWheel={(e) => onWheelScale(e, layer.id)}
              >
                @{layer.username}
                {handles}
              </div>
            );
          }
          return (
            <div
              key={layer.id}
              className={`story-layer sticker ${active ? 'active' : ''}`}
              style={style}
              onPointerDown={(e) => onPointerDownLayer(e, layer.id)}
              onWheel={(e) => onWheelScale(e, layer.id)}
            >
              {layer.emoji}
              {handles}
            </div>
          );
        })}

        {musicLabel ? <div className="story-music-chip">♪ {musicLabel}</div> : null}
      </div>

      {pendingTrim ? (
        <div className="story-trim-overlay" onPointerDown={(e) => e.stopPropagation()}>
          <video
            className="story-trim-preview"
            src={pendingTrim.url}
            muted
            playsInline
            controls
          />
          <VideoFilmstripTrim
            file={pendingTrim.file}
            duration={pendingTrim.duration}
            start={pendingTrim.start}
            end={pendingTrim.end}
            maxClip={60}
            onChange={({ start, end }) =>
              setPendingTrim((p) => (p ? { ...p, start, end } : p))
            }
          />
          <div className="story-trim-actions">
            <button type="button" className="button button-ghost" disabled={trimBusy} onClick={cancelVideoTrim}>
              {t('close')}
            </button>
            <button
              type="button"
              className="button"
              disabled={trimBusy}
              onClick={() => void confirmVideoTrim()}
            >
              {trimBusy ? '…' : t('confirm')}
            </button>
          </div>
        </div>
      ) : null}

      <aside className="story-tools">
        <button type="button" className={tool === 'text' ? 'on' : ''} onClick={() => setTool(tool === 'text' ? null : 'text')}>
          <span>Aa</span>
          <small>{t('storyText')}</small>
        </button>
        <button
          type="button"
          className={tool === 'stickers' ? 'on' : ''}
          onClick={() => setTool(tool === 'stickers' ? null : 'stickers')}
        >
          <span>☺</span>
          <small>{t('stickers')}</small>
        </button>
        <button type="button" onClick={() => addMoreRef.current?.click()}>
          <span>+</span>
          <small>{t('addMore')}</small>
        </button>
        <button
          type="button"
          className={tool === 'music' ? 'on' : ''}
          onClick={() => setTool(tool === 'music' ? null : 'music')}
        >
          <span>♪</span>
          <small>{t('storyMusic')}</small>
        </button>
        <button
          type="button"
          className={tool === 'mention' ? 'on' : ''}
          onClick={() => {
            setTool(tool === 'mention' ? null : 'mention');
            setMentionQ('');
          }}
        >
          <span>@</span>
          <small>{t('storyMention')}</small>
        </button>
        <button
          type="button"
          className={tool === 'draw' ? 'on' : ''}
          onClick={() => setTool(tool === 'draw' ? null : 'draw')}
        >
          <span>✎</span>
          <small>{t('storyDraw')}</small>
        </button>
        <button type="button" onClick={() => void exportDownload()}>
          <span>⬇</span>
          <small>{t('download')}</small>
        </button>
        <button
          type="button"
          className={commentsDisabled ? 'on' : ''}
          onClick={() => setCommentsDisabled((v) => !v)}
        >
          <span>{commentsDisabled ? '🔇' : '💬'}</span>
          <small>{t('muteComments')}</small>
        </button>
      </aside>

      {tool === 'text' ? (
        <div className="story-tool-sheet">
          <input
            className="search-input"
            placeholder={t('addCaption')}
            value={textDraft}
            autoFocus
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addText(textDraft);
            }}
          />
          <button type="button" className="button button-compact" onClick={() => addText(textDraft)}>
            {editingTextId ? t('edit') : t('send')}
          </button>
          <div className="story-color-row">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="story-color-dot"
                style={{ background: c }}
                onClick={() => {
                  if (selected?.kind === 'text' || selected?.kind === 'mention') {
                    updateLayer(selected.id, { color: c });
                  }
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {tool === 'stickers' ? (
        <div className="story-tool-sheet stickers">
          {STICKERS.map((e) => (
            <button key={e} type="button" onClick={() => addSticker(e)}>
              {e}
            </button>
          ))}
        </div>
      ) : null}

      {tool === 'music' ? (
        <div className="story-tool-sheet">
          {MUSIC_TRACKS.map((m) => (
            <button
              key={m}
              type="button"
              className="list-row"
              onClick={() => {
                setMusicLabel(m);
                setTool(null);
              }}
            >
              ♪ {m}
            </button>
          ))}
        </div>
      ) : null}

      {tool === 'mention' ? (
        <div className="story-tool-sheet story-mention-sheet">
          <input
            className="search-input"
            placeholder={t('searchPeopleHint')}
            value={mentionQ}
            autoFocus
            dir="auto"
            onChange={(e) => setMentionQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && mentionQ.trim()) {
                addMention(mentionQ.trim());
              }
            }}
          />
          <ul className="story-mention-list">
            {mentionPeople.map((u) => (
              <li key={u.id}>
                <button type="button" className="story-mention-row" onClick={() => addMention(u.username)}>
                  <UserAvatar
                    size="sm"
                    name={u.displayName || u.username}
                    username={u.username}
                    avatarUrl={u.avatarUrl}
                  />
                  <span>
                    <strong>@{u.username}</strong>
                    {u.displayName ? <span className="muted tiny"> · {u.displayName}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {mentionQ.trim() ? (
            <button type="button" className="button button-compact" onClick={() => addMention(mentionQ)}>
              @{mentionQ.replace(/^@/, '')}
            </button>
          ) : null}
        </div>
      ) : null}

      {tool === 'draw' ? (
        <div className="story-tool-sheet">
          <div className="story-color-row">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`story-color-dot ${drawColor === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setDrawColor(c)}
              />
            ))}
            <button type="button" className="linkish" onClick={() => setStrokes([])}>
              {t('clear')}
            </button>
          </div>
        </div>
      ) : null}

      <footer className="story-share-bar">
        <button
          type="button"
          className="story-share-btn"
          disabled={phase === 'publishing'}
          onClick={() => void publish('everyone')}
        >
          <span className="avatar-circle sm">{meName.slice(0, 1).toUpperCase()}</span>
          {t('yourStory')}
        </button>
        <button
          type="button"
          className="story-share-btn"
          disabled={phase === 'publishing'}
          onClick={() => void publish('close_friends')}
        >
          <span className="cf-star">★</span>
          {t('storyCloseFriends')}
        </button>
      </footer>

      <input
        ref={addMoreRef}
        className="sr-only"
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={(e) => {
          ingestFiles(e.target.files, true);
          e.target.value = '';
        }}
      />
    </div>
  );
}
