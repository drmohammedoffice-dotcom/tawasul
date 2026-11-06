import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPost, fetchReel, resolveMediaUrl } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { IconMore, IconSendArrow } from './Icons';
import { UserAvatar } from './UserAvatar';

export type SharePayload = {
  targetType: 'post' | 'reel' | 'story';
  targetId: string;
  url?: string;
};

const SHARE_RE = /^\[share:(post|reel|story):([^\]]+)\]\s*(.*)$/s;

export function parseShareContent(text: string): SharePayload | null {
  const m = String(text || '').match(SHARE_RE);
  if (!m) return null;
  const url = (m[3] || '').trim();
  return {
    targetType: m[1] as SharePayload['targetType'],
    targetId: m[2]!,
    ...(url ? { url } : {})
  };
}

export function sharePreviewLabel(text: string, sharedLabel: string): string | null {
  const share = parseShareContent(text);
  if (!share) return null;
  return sharedLabel;
}

type Props = {
  payload: SharePayload;
  mine?: boolean;
  sentAt?: string;
  showDate?: boolean;
  onToggleDate?: () => void;
  onReply?: () => void;
  onDelete?: () => void;
  onForward?: () => void;
};

export function ShareContentBubble({
  payload,
  mine,
  sentAt,
  showDate,
  onToggleDate,
  onReply,
  onDelete,
  onForward
}: Props) {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    setPosterFailed(false);
    const run =
      payload.targetType === 'post'
        ? fetchPost(payload.targetId)
        : payload.targetType === 'reel'
          ? fetchReel(payload.targetId)
          : Promise.reject(new Error('unsupported'));
    void run
      .then((row) => {
        if (!cancelled) setData(row);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('errorGeneric'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payload.targetId, payload.targetType, t]);

  const author = data?.author;
  const username = author?.username || 'user';
  const display = author?.displayName || username;
  const media =
    payload.targetType === 'reel'
      ? data?.media
      : data?.media?.[0]?.media || data?.media?.[0];
  const mime = String(media?.mimeType || '');
  const isVideo =
    payload.targetType === 'reel' || mime.startsWith('video/');
  // Never use video secureUrl as <img> — causes broken-image glyph
  const posterCandidate = media?.posterUrl || media?.thumbnailUrl
    ? resolveMediaUrl(media?.posterUrl || media?.thumbnailUrl)
    : !isVideo && media?.secureUrl
      ? resolveMediaUrl(media.secureUrl)
      : null;
  const poster = posterFailed ? null : posterCandidate;
  const href =
    payload.targetType === 'reel'
      ? `/reels?id=${encodeURIComponent(payload.targetId)}`
      : payload.targetType === 'post'
        ? `/p/${encodeURIComponent(payload.targetId)}`
        : payload.url || '#';

  const dateLabel = (() => {
    if (!sentAt) return '';
    try {
      return new Date(sentAt).toLocaleString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return sentAt;
    }
  })();

  return (
    <div
      className={`share-content-bubble${mine ? ' is-mine' : ''}${isVideo ? ' is-video' : ''}`}
      onClick={(e) => {
        // Empty frame / chrome (not media/link) → toggle send date
        if ((e.target as HTMLElement).closest('.share-content-media, .share-content-head, a, button')) {
          return;
        }
        e.stopPropagation();
        onToggleDate?.();
      }}
    >
      <div className="share-content-toolbar">
        <button
          type="button"
          className="share-content-more"
          aria-label={t('more')}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <IconMore size={18} />
        </button>
        {menuOpen ? (
          <div className="share-content-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            {onReply ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onReply();
                }}
              >
                {t('reply')}
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                {t('delete')}
              </button>
            ) : null}
            <button type="button" role="menuitem" onClick={() => setMenuOpen(false)}>
              {t('close')}
            </button>
          </div>
        ) : null}
      </div>

      <Link to={`/u/${username}`} className="share-content-head" onClick={(e) => e.stopPropagation()}>
        <UserAvatar size="sm" name={display} username={username} avatarUrl={author?.avatarUrl} />
        <div className="share-content-author">
          <strong>{display}</strong>
          <span>@{username}</span>
        </div>
      </Link>

      <div className="share-content-media">
        <Link to={href} className="share-content-media-link" onClick={(e) => e.stopPropagation()}>
          {loading ? (
            <div className="share-content-skeleton" />
          ) : error || !poster ? (
            <div className="share-content-fallback">
              {payload.targetType === 'reel' ? t('reels') : t('posts')}
            </div>
          ) : (
            <img
              src={poster}
              alt=""
              loading="lazy"
              onError={() => setPosterFailed(true)}
            />
          )}
          {isVideo && !loading ? (
            <span className="share-content-play" aria-hidden>
              ▶
            </span>
          ) : null}
          {payload.targetType === 'reel' ? (
            <span className="share-content-reel-badge" aria-hidden>
              ▷
            </span>
          ) : null}
        </Link>
        {onForward ? (
          <button
            type="button"
            className="share-content-forward"
            aria-label={t('share')}
            title={t('share')}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onForward();
            }}
          >
            <IconSendArrow size={22} />
          </button>
        ) : null}
      </div>

      {data?.caption ? (
        <p className="share-content-caption">{String(data.caption).slice(0, 120)}</p>
      ) : null}
      {showDate && dateLabel ? (
        <p className="share-content-sent muted tiny">
          {t('sendDate')}: {dateLabel}
        </p>
      ) : null}
    </div>
  );
}
