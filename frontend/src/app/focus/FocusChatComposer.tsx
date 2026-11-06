import { FormEvent, useEffect, useRef, useState } from 'react';
import { uploadMediaFile } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { AvatarCrop } from '../ui/AvatarCrop';
import {
  IconCamera,
  IconImage,
  IconMic,
  IconSendArrow,
  IconSticker
} from '../ui/Icons';

const STICKERS = [
  '😀', '😂', '😍', '🥰', '😎', '😭', '🔥', '👍', '👏', '🙏', '❤️', '💔', '🎉', '✨', '💯', '🤝',
  '😊', '🤔', '😴', '🤗', '🫡', '💪', '🌟', '🌈'
];

type GalleryItem = {
  id: string;
  file: File;
  url: string;
  selected: boolean;
  cropped?: boolean;
};

type SendPayload = {
  text?: string;
  mediaIds?: string[];
};

type Props = {
  disabled?: boolean;
  onSend: (payload: SendPayload) => void | Promise<void>;
  onError?: (message: string) => void;
};

export function FocusChatComposer({ disabled, onSend, onError }: Props) {
  const { t } = useI18n();
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordSecsRef = useRef(0);
  const autoSendVoiceRef = useRef(false);
  const discardVoiceRef = useRef(false);
  const waveRafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const [draft, setDraft] = useState('');
  const [stickersOpen, setStickersOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [croppingId, setCroppingId] = useState<string | null>(null);
  const [sendMode, setSendMode] = useState<'normal' | 'once' | 'timed'>('normal');
  const [ttlSecs, setTtlSecs] = useState(10);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [pendingAudio, setPendingAudio] = useState<{ blob: Blob; url: string; secs: number } | null>(
    null
  );
  const [waveBars, setWaveBars] = useState<number[]>(() => Array.from({ length: 24 }, () => 0.12));
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraShot, setCameraShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);

  const selectedGallery = galleryItems.filter((g) => g.selected);
  const canSendText = Boolean(draft.trim() || selectedGallery.length);

  useEffect(() => {
    const el = cameraVideoRef.current;
    if (!cameraOpen || !cameraStream || !el || cameraShot) return;
    el.srcObject = cameraStream;
    void el.play().catch(() => undefined);
  }, [cameraOpen, cameraStream, cameraShot]);

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((tr) => tr.stop());
      if (cameraShot) URL.revokeObjectURL(cameraShot.url);
      galleryItems.forEach((g) => URL.revokeObjectURL(g.url));
      if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      stopWaveform();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fail(err: unknown) {
    onError?.(err instanceof Error ? err.message : t('errorGeneric'));
  }

  function stopWaveform() {
    if (waveRafRef.current != null) {
      window.cancelAnimationFrame(waveRafRef.current);
      waveRafRef.current = null;
    }
    try {
      void audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    setWaveBars(Array.from({ length: 24 }, () => 0.12));
  }

  function startWaveform(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        const a = analyserRef.current;
        if (!a) return;
        a.getByteFrequencyData(data);
        const bars: number[] = [];
        const step = Math.max(1, Math.floor(data.length / 24));
        for (let i = 0; i < 24; i++) {
          const v = data[i * step] ?? 0;
          bars.push(0.12 + (v / 255) * 0.88);
        }
        setWaveBars(bars);
        waveRafRef.current = window.requestAnimationFrame(tick);
      };
      waveRafRef.current = window.requestAnimationFrame(tick);
    } catch {
      /* optional */
    }
  }

  async function startRecording() {
    if (disabled || busy) return;
    autoSendVoiceRef.current = false;
    discardVoiceRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        stopWaveform();
        const secs = recordSecsRef.current;
        if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
        setRecording(false);
        if (discardVoiceRef.current) {
          discardVoiceRef.current = false;
          return;
        }
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (autoSendVoiceRef.current) {
          void sendVoiceBlob(blob, secs);
          return;
        }
        setPendingAudio({ blob, url: URL.createObjectURL(blob), secs });
      };
      mediaRecorderRef.current = rec;
      rec.start();
      startWaveform(stream);
      setRecording(true);
      recordSecsRef.current = 0;
      setRecordSecs(0);
      recordTimerRef.current = window.setInterval(() => {
        recordSecsRef.current += 1;
        setRecordSecs(recordSecsRef.current);
      }, 1000);
    } catch {
      onError?.(t('micPermissionDenied'));
    }
  }

  function stopRecording(autoSend = true) {
    autoSendVoiceRef.current = autoSend;
    mediaRecorderRef.current?.stop();
  }

  function cancelRecording() {
    autoSendVoiceRef.current = false;
    discardVoiceRef.current = true;
    if (recording) mediaRecorderRef.current?.stop();
    stopWaveform();
    if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    setPendingAudio(null);
    setRecording(false);
  }

  async function sendVoiceBlob(blob: Blob, secs: number) {
    setBusy(true);
    try {
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
      const mediaId = await uploadMediaFile(file, 'voice');
      await onSend({ mediaIds: [mediaId], text: `[voice ${secs}s]` });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function sendPendingAudio() {
    if (!pendingAudio) return;
    const { blob, url, secs } = pendingAudio;
    URL.revokeObjectURL(url);
    setPendingAudio(null);
    await sendVoiceBlob(blob, secs);
  }

  function onPickGallery(files: FileList | null) {
    if (!files?.length) return;
    const next: GalleryItem[] = [...galleryItems];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        url: URL.createObjectURL(file),
        selected: true
      });
    }
    setGalleryItems(next);
    setGalleryOpen(true);
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  }

  function toggleGallerySelect(id: string) {
    setGalleryItems((prev) => prev.map((g) => (g.id === id ? { ...g, selected: !g.selected } : g)));
  }

  function applyGalleryCrop(itemId: string, blob: Blob) {
    setGalleryItems((prev) =>
      prev.map((g) => {
        if (g.id !== itemId) return g;
        URL.revokeObjectURL(g.url);
        const file = new File([blob], g.file.name.replace(/\.\w+$/, '') + '-crop.jpg', {
          type: 'image/jpeg'
        });
        return { ...g, file, url: URL.createObjectURL(file), cropped: true, selected: true };
      })
    );
    setCroppingId(null);
  }

  async function sendGallery() {
    const selected = galleryItems.filter((g) => g.selected);
    if (!selected.length) return;
    setBusy(true);
    try {
      const mediaIds: string[] = [];
      for (const item of selected.slice(0, 30)) {
        mediaIds.push(await uploadMediaFile(item.file, 'chat'));
      }
      const caption = draft.trim();
      const prefix =
        sendMode === 'once'
          ? '[img:once]'
          : sendMode === 'timed'
            ? `[img:ttl:${Math.min(60, Math.max(1, ttlSecs))}]`
            : '[img]';
      const text = caption ? `${prefix} ${caption}` : prefix;
      await onSend({ mediaIds, text });
      setDraft('');
      galleryItems.forEach((g) => URL.revokeObjectURL(g.url));
      setGalleryItems([]);
      setGalleryOpen(false);
      setCroppingId(null);
      setSendMode('normal');
      setStickersOpen(false);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function submitComposer(e?: FormEvent) {
    e?.preventDefault();
    if (disabled || busy) return;
    if (selectedGallery.length) {
      void sendGallery();
      return;
    }
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setStickersOpen(false);
    void onSend({ text });
  }

  function insertSticker(emoji: string) {
    if (disabled || busy) return;
    setStickersOpen(false);
    void onSend({ text: `[sticker] ${emoji}` });
  }

  async function openCamera() {
    if (disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      setCameraStream(stream);
      setCameraShot(null);
      setCameraOpen(true);
      setStickersOpen(false);
      setGalleryOpen(false);
    } catch {
      onError?.(t('cameraPermissionDenied'));
    }
  }

  function closeCamera() {
    cameraStream?.getTracks().forEach((tr) => tr.stop());
    setCameraStream(null);
    if (cameraShot) URL.revokeObjectURL(cameraShot.url);
    setCameraShot(null);
    setCameraOpen(false);
    setCameraBusy(false);
  }

  function captureCameraPhoto() {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (cameraShot) URL.revokeObjectURL(cameraShot.url);
        setCameraShot({ blob, url: URL.createObjectURL(blob) });
        cameraStream?.getTracks().forEach((tr) => tr.stop());
        setCameraStream(null);
      },
      'image/jpeg',
      0.92
    );
  }

  async function retakeCameraPhoto() {
    if (cameraShot) URL.revokeObjectURL(cameraShot.url);
    setCameraShot(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      setCameraStream(stream);
    } catch {
      closeCamera();
      onError?.(t('cameraPermissionDenied'));
    }
  }

  async function sendCameraPhoto() {
    if (!cameraShot) return;
    setCameraBusy(true);
    try {
      const file = new File([cameraShot.blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const mediaId = await uploadMediaFile(file, 'chat');
      await onSend({ mediaIds: [mediaId], text: '[img]' });
      closeCamera();
    } catch (err) {
      fail(err);
      setCameraBusy(false);
    }
  }

  return (
    <>
      {stickersOpen ? (
        <div className="sticker-studio" role="listbox" aria-label={t('stickers')}>
          {STICKERS.map((s) => (
            <button
              key={s}
              type="button"
              className="sticker-btn"
              disabled={disabled || busy}
              onClick={() => insertSticker(s)}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {galleryOpen ? (
        <div className="gallery-sheet">
          <div className="gallery-sheet-head">
            <strong>{t('chooseFromGallery')}</strong>
            <button
              type="button"
              className="button button-ghost button-compact"
              onClick={() => {
                galleryItems.forEach((g) => URL.revokeObjectURL(g.url));
                setGalleryItems([]);
                setGalleryOpen(false);
              }}
            >
              {t('close')}
            </button>
          </div>
          <div className="gallery-modes">
            <button
              type="button"
              className={`button button-compact ${sendMode === 'normal' ? '' : 'button-ghost'}`}
              onClick={() => setSendMode('normal')}
            >
              {t('permanent')}
            </button>
            <button
              type="button"
              className={`button button-compact ${sendMode === 'once' ? '' : 'button-ghost'}`}
              onClick={() => setSendMode('once')}
            >
              {t('viewOnce')}
            </button>
            <button
              type="button"
              className={`button button-compact ${sendMode === 'timed' ? '' : 'button-ghost'}`}
              onClick={() => setSendMode('timed')}
            >
              {t('viewTimed')}
            </button>
            {sendMode === 'timed' ? (
              <label className="ttl-field">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={ttlSecs}
                  onChange={(e) => setTtlSecs(Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
                />
                <span>{t('seconds')}</span>
              </label>
            ) : null}
          </div>
          <div className="gallery-grid">
            {galleryItems.map((g) => (
              <div key={g.id} className={`gallery-tile-wrap ${g.selected ? 'is-selected' : ''}`}>
                <button
                  type="button"
                  className={`gallery-tile ${g.selected ? 'is-selected' : ''}`}
                  onClick={() => toggleGallerySelect(g.id)}
                >
                  <img src={g.url} alt="" />
                  {g.selected ? <span className="gallery-check">✓</span> : null}
                </button>
                {g.selected ? (
                  <button
                    type="button"
                    className="button button-ghost button-compact gallery-crop-btn"
                    onClick={() => setCroppingId(g.id)}
                  >
                    {g.cropped ? t('cropOn') : t('crop')}
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="gallery-tile gallery-add"
              onClick={() => galleryInputRef.current?.click()}
            >
              +
            </button>
          </div>
          {selectedGallery.length ? (
            <p className="muted tiny gallery-send-hint">{t('sendWithComposerHint')}</p>
          ) : null}
        </div>
      ) : null}

      {croppingId ? (
        (() => {
          const item = galleryItems.find((g) => g.id === croppingId);
          if (!item) return null;
          return (
            <AvatarCrop
              variant="free"
              file={item.file}
              onCancel={() => setCroppingId(null)}
              onConfirm={(blob) => applyGalleryCrop(item.id, blob)}
            />
          );
        })()
      ) : null}

      {recording ? (
        <div className="voice-recording-bar" aria-live="polite">
          <div className="voice-waveform" aria-hidden>
            {waveBars.map((h, i) => (
              <span key={i} style={{ height: `${Math.round(h * 100)}%` }} />
            ))}
          </div>
          <span className="voice-rec-secs">{recordSecs}s</span>
          <button type="button" className="button button-ghost button-compact" onClick={cancelRecording}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="composer-send-btn"
            aria-label={t('send')}
            onClick={() => stopRecording(true)}
          >
            <IconSendArrow size={20} />
          </button>
        </div>
      ) : null}

      {pendingAudio ? (
        <div className="voice-preview">
          <audio src={pendingAudio.url} controls />
          <button
            type="button"
            className="icon-btn"
            aria-label={t('send')}
            onClick={() => void sendPendingAudio()}
          >
            <IconSendArrow size={20} />
          </button>
          <button type="button" className="button button-ghost button-compact" onClick={cancelRecording}>
            {t('cancel')}
          </button>
        </div>
      ) : null}

      <form className="composer tg-composer wa-composer focus-dm-composer" onSubmit={submitComposer}>
        <input
          ref={galleryInputRef}
          className="sr-only"
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => onPickGallery(e.target.files)}
        />
        <div className="composer-row">
          <button
            type="button"
            className="composer-icon-btn"
            aria-label={t('stickers')}
            disabled={disabled || busy}
            onClick={() => {
              setStickersOpen((v) => !v);
              setGalleryOpen(false);
            }}
          >
            <IconSticker size={22} />
          </button>
          <button
            type="button"
            className="composer-icon-btn"
            aria-label={t('chooseFromGallery')}
            disabled={disabled || busy}
            onClick={() => {
              setGalleryOpen(true);
              setStickersOpen(false);
              galleryInputRef.current?.click();
            }}
          >
            <IconImage size={22} />
          </button>
          <button
            type="button"
            className="composer-icon-btn"
            aria-label={t('takePhoto')}
            disabled={disabled || busy}
            onClick={() => void openCamera()}
          >
            <IconCamera size={22} />
          </button>
          <textarea
            ref={draftInputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('typeMessage')}
            dir="auto"
            lang="ar"
            inputMode="text"
            enterKeyHint="send"
            autoComplete="off"
            rows={1}
            disabled={disabled || busy}
            onFocus={() => setStickersOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitComposer();
              }
            }}
          />
          {canSendText ? (
            <button
              className="composer-send-btn"
              type="submit"
              disabled={disabled || busy}
              aria-label={t('send')}
              title={
                selectedGallery.length ? `${t('send')} (${selectedGallery.length})` : t('send')
              }
            >
              <IconSendArrow size={20} />
              {selectedGallery.length ? (
                <span className="composer-send-badge">{selectedGallery.length}</span>
              ) : null}
            </button>
          ) : recording ? (
            <button
              type="button"
              className="composer-icon-btn mic is-recording"
              onClick={() => stopRecording(true)}
              aria-label={t('stopRecording')}
            >
              {recordSecs}s
            </button>
          ) : (
            <button
              type="button"
              className="composer-icon-btn mic"
              aria-label={t('recordVoice')}
              disabled={disabled || busy}
              onClick={() => void startRecording()}
            >
              <IconMic size={22} />
            </button>
          )}
        </div>
      </form>

      {cameraOpen ? (
        <div className="camera-capture-overlay" role="dialog" aria-modal="true">
          <header className="camera-capture-top">
            <button type="button" className="button button-ghost button-compact" onClick={closeCamera}>
              {t('close')}
            </button>
            <strong>{t('takePhoto')}</strong>
            <span />
          </header>
          <div className="camera-capture-stage">
            {cameraShot ? (
              <img src={cameraShot.url} alt="" className="camera-capture-preview" />
            ) : (
              <video ref={cameraVideoRef} className="camera-capture-video" playsInline muted autoPlay />
            )}
            <canvas ref={cameraCanvasRef} className="sr-only" />
          </div>
          <div className="camera-capture-actions">
            {cameraShot ? (
              <>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={cameraBusy}
                  onClick={() => void retakeCameraPhoto()}
                >
                  {t('retakePhoto')}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={cameraBusy}
                  onClick={() => void sendCameraPhoto()}
                >
                  {cameraBusy ? '…' : t('send')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="camera-shutter"
                aria-label={t('takePhoto')}
                onClick={captureCameraPhoto}
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
