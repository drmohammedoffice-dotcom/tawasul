import { useCallback, useEffect, useRef, useState } from 'react';
import { apiData, resolveApiBaseUrl } from '@/api/http';
import { resolveMediaUrl } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';

type Props = {
  mediaId?: string | null;
  secureUrl?: string | null;
  /** Optional poster/thumbnail when storage already provides one (no new transcoder). */
  posterUrl?: string | null;
  mimeType?: string | null;
  alt?: string;
  eager?: boolean;
  variant?: 'feed' | 'grid' | 'story' | 'reel' | 'chat';
  processingStatus?: string | null;
  playable?: boolean;
  controls?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
  className?: string;
  onMediaReady?: (el: HTMLVideoElement | HTMLImageElement) => void;
};

async function refreshSecureUrl(mediaId: string): Promise<string | null> {
  try {
    const data = await apiData<{ secureUrl: string }>(`/media/${mediaId}/url`);
    return resolveMediaUrl(data.secureUrl);
  } catch {
    return null;
  }
}

export function MediaFrame({
  mediaId,
  secureUrl,
  posterUrl,
  mimeType,
  alt = '',
  eager = false,
  variant = 'feed',
  processingStatus,
  playable = true,
  controls = true,
  muted = true,
  autoPlay = false,
  className = '',
  onMediaReady
}: Props) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(() => resolveMediaUrl(secureUrl));
  const [poster, setPoster] = useState<string | null>(() => resolveMediaUrl(posterUrl));
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'processing'>(() => {
    if (processingStatus && processingStatus !== 'ready' && !playable) return 'processing';
    if (!secureUrl && !mediaId) return 'error';
    return 'loading';
  });
  const retried = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setUrl(resolveMediaUrl(secureUrl));
    setPoster(resolveMediaUrl(posterUrl));
    retried.current = false;
    if (processingStatus && processingStatus !== 'ready' && !playable) {
      setPhase('processing');
    } else if (secureUrl || mediaId) {
      setPhase('loading');
    } else {
      setPhase('error');
    }
  }, [secureUrl, posterUrl, mediaId, processingStatus, playable]);

  // Proactively resolve signed URL when only mediaId is known (avoid false "unavailable").
  useEffect(() => {
    if (!mediaId || resolveMediaUrl(secureUrl)) return;
    let cancelled = false;
    void (async () => {
      const next = await refreshSecureUrl(mediaId);
      if (cancelled) return;
      if (next) {
        setUrl(next);
        setPhase('loading');
      } else if (!secureUrl) {
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaId, secureUrl]);

  const fail = useCallback(async () => {
    if (mediaId && !retried.current) {
      retried.current = true;
      const next = await refreshSecureUrl(mediaId);
      if (next) {
        setUrl(next);
        setPhase('loading');
        return;
      }
    }
    setPhase('error');
  }, [mediaId]);

  const isVideo = String(mimeType || '').startsWith('video/') || variant === 'reel';
  const gridVideo = isVideo && variant === 'grid';
  const gridAutoplay = gridVideo && autoPlay;

  const viewportAutoplay = (gridAutoplay || (autoPlay && (variant === 'reel' || variant === 'feed') && isVideo)) && !!url;

  useEffect(() => {
    if (!viewportAutoplay) return;
    const el = videoRef.current;
    if (!el) return;
    const threshold = gridAutoplay ? 0.45 : 0.55;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= threshold);
        if (visible) {
          el.muted = muted || gridAutoplay;
          void el.play().catch(() => undefined);
        } else {
          el.pause();
        }
      },
      { threshold: [0, threshold, 0.75], rootMargin: '40px' }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      el.pause();
    };
  }, [viewportAutoplay, gridAutoplay, url, muted]);

  if (phase === 'processing') {
    return (
      <div className={`media-frame media-${variant} media-processing ${className}`.trim()}>
        <div className="media-status">
          <div className="spinner" />
          <span>{t('reelProcessing')}</span>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={`media-frame media-${variant} media-fallback ${className}`.trim()}>
        {isVideo ? (
          <>
            <span className="media-video-badge" aria-hidden>
              ▶
            </span>
            <span>{t('videoUnavailable')}</span>
          </>
        ) : (
          <span>{t('mediaMissing')}</span>
        )}
        {mediaId ? (
          <button
            type="button"
            className="button button-compact button-ghost"
            onClick={() => {
              retried.current = false;
              setPhase('loading');
              void (async () => {
                const next = await refreshSecureUrl(mediaId);
                if (next) setUrl(next);
                else setPhase('error');
              })();
            }}
          >
            {t('retry')}
          </button>
        ) : null}
      </div>
    );
  }

  if (!url) {
    return (
      <div className={`media-frame media-${variant} is-loading ${className}`.trim()}>
        <div className="media-skeleton shimmer" aria-hidden />
      </div>
    );
  }

  return (
    <div
      className={`media-frame media-${variant} ${phase === 'loading' ? 'is-loading' : ''} ${
        gridVideo ? 'media-grid-video' : ''
      } ${className}`.trim()}
    >
      {phase === 'loading' ? <div className="media-skeleton shimmer" aria-hidden /> : null}
      {isVideo ? (
        <>
          {poster && gridVideo && !gridAutoplay ? (
            <img
              className="media-poster"
              src={poster}
              alt={alt}
              loading="eager"
              decoding="async"
              onLoad={() => setPhase('ready')}
              onError={() => setPoster(null)}
            />
          ) : (
            <video
              ref={videoRef}
              key={url}
              src={url}
              poster={poster || undefined}
              controls={controls && !gridVideo}
              playsInline
              muted={muted || gridAutoplay}
              loop={gridAutoplay}
              autoPlay={autoPlay && !gridVideo}
              preload={gridAutoplay ? 'auto' : 'metadata'}
              onLoadedData={(e) => {
                setPhase('ready');
                onMediaReady?.(e.currentTarget);
              }}
              onError={() => void fail()}
            />
          )}
          {gridVideo ? (
            <span className="media-video-badge" aria-hidden>
              ▶
            </span>
          ) : null}
        </>
      ) : (
        <img
          key={url}
          src={url}
          alt={alt}
          loading={eager || variant === 'feed' || variant === 'grid' ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={(e) => {
            setPhase('ready');
            onMediaReady?.(e.currentTarget);
          }}
          onError={() => void fail()}
        />
      )}
    </div>
  );
}

export function absoluteApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = resolveApiBaseUrl().replace(/\/api\/?$/, '');
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}
