import { useEffect, useState } from 'react';
import { resolveMediaUrl } from '@/api/social';

type Props = {
  name?: string | null | undefined;
  username?: string | null | undefined;
  avatarUrl?: string | null | undefined;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  ring?: 'none' | 'story' | 'story-seen';
};

/** Circular avatar with cover-crop (Instagram-style). Never stretches full-bleed. */
export function UserAvatar({
  name,
  username,
  avatarUrl,
  size = 'md',
  className = '',
  ring = 'none'
}: Props) {
  const label = (name || username || '?').trim();
  const initial = label.slice(0, 1).toUpperCase() || '?';
  const src = resolveMediaUrl(avatarUrl);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  const sizeClass =
    size === 'sm' ? 'sm' : size === 'md' ? 'md' : size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : 'md';
  const ringClass = ring === 'story' ? 'avatar-ring-unseen' : ring === 'story-seen' ? 'avatar-ring-seen' : '';
  const showImg = Boolean(src) && !broken;

  return (
    <span
      className={`avatar-circle ${sizeClass} ${ringClass} ${className}`.trim()}
      aria-hidden={!showImg}
      title={username ? `@${username}` : label}
    >
      {showImg ? (
        <img
          key={src || 'avatar'}
          src={src || undefined}
          alt=""
          onError={() => setBroken(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
