import { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  file: File;
  duration: number;
  start: number;
  end: number;
  maxClip?: number;
  onChange: (next: { start: number; end: number }) => void;
};

const THUMBS = 12;

async function captureThumbs(file: File, duration: number): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
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
  const out: string[] = [];
  const total = Math.max(0.1, duration);
  for (let i = 0; i < THUMBS; i++) {
    const t = Math.min(total - 0.05, (i / Math.max(1, THUMBS - 1)) * total);
    video.currentTime = Math.max(0, t);
    await new Promise<void>((resolve) => {
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

export function VideoFilmstripTrim({
  file,
  duration,
  start,
  end,
  maxClip = 60,
  onChange
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [playhead, setPlayhead] = useState(start);
  const drag = useRef<'start' | 'end' | 'window' | 'playhead' | null>(null);
  const dragOrigin = useRef({ x: 0, start: 0, end: 0 });

  useEffect(() => {
    let cancelled = false;
    void captureThumbs(file, duration)
      .then((rows) => {
        if (!cancelled) setThumbs(rows);
      })
      .catch(() => {
        if (!cancelled) setThumbs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [file, duration]);

  useEffect(() => {
    setPlayhead(start);
  }, [start, file]);

  const leftPct = useMemo(() => (duration > 0 ? (start / duration) * 100 : 0), [start, duration]);
  const widthPct = useMemo(
    () => (duration > 0 ? ((end - start) / duration) * 100 : 100),
    [start, end, duration]
  );
  const headPct = useMemo(
    () => (duration > 0 ? (playhead / duration) * 100 : 0),
    [playhead, duration]
  );

  function clientToTime(clientX: number) {
    const el = trackRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function clampRange(nextStart: number, nextEnd: number) {
    let s = Math.max(0, Math.min(nextStart, duration - 0.5));
    let e = Math.min(duration, Math.max(nextEnd, s + 0.5));
    if (e - s > maxClip) {
      if (drag.current === 'start') s = e - maxClip;
      else e = s + maxClip;
    }
    onChange({ start: s, end: e });
    setPlayhead((p) => Math.min(Math.max(p, s), e));
  }

  function onPointerDown(kind: 'start' | 'end' | 'window' | 'playhead', e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = kind;
    dragOrigin.current = { x: e.clientX, start, end };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const t = clientToTime(e.clientX);
    if (drag.current === 'start') {
      clampRange(Math.min(t, end - 0.5), end);
    } else if (drag.current === 'end') {
      clampRange(start, Math.max(t, start + 0.5));
    } else if (drag.current === 'playhead') {
      const p = Math.min(end, Math.max(start, t));
      setPlayhead(p);
    } else if (drag.current === 'window') {
      const el = trackRef.current;
      if (!el) return;
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

  return (
    <div className="filmstrip-trim">
      <p className="muted tiny filmstrip-meta">
        {(end - start).toFixed(1)}s / {maxClip}s · {start.toFixed(1)}s → {end.toFixed(1)}s
      </p>
      <div
        className="filmstrip-row"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button type="button" className="filmstrip-chevron" aria-hidden>
          ‹
        </button>
        <div ref={trackRef} className="filmstrip-track">
          <div className="filmstrip-thumbs">
            {(thumbs.length ? thumbs : Array.from({ length: THUMBS })).map((src, i) =>
              typeof src === 'string' ? (
                <img key={i} src={src} alt="" draggable={false} />
              ) : (
                <span key={i} className="filmstrip-ph" />
              )
            )}
          </div>
          <div
            className="filmstrip-window"
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            onPointerDown={(e) => onPointerDown('window', e)}
          >
            <span
              className="filmstrip-handle start"
              onPointerDown={(e) => onPointerDown('start', e)}
            />
            <span className="filmstrip-handle end" onPointerDown={(e) => onPointerDown('end', e)} />
            <span
              className="filmstrip-playhead"
              style={{ left: `${duration > 0 ? ((playhead - start) / Math.max(0.01, end - start)) * 100 : 0}%` }}
              onPointerDown={(e) => onPointerDown('playhead', e)}
            />
          </div>
        </div>
        <button type="button" className="filmstrip-chevron" aria-hidden>
          ›
        </button>
      </div>
      <div className="filmstrip-seek-hint muted tiny" style={{ ['--head' as string]: `${headPct}%` }}>
        ▶ {playhead.toFixed(1)}s
      </div>
    </div>
  );
}
