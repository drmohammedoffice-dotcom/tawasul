type IconProps = { size?: number; className?: string };

function base({ size = 22, className }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true as const
  };
}

export function IconHome(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
    </svg>
  );
}

export function IconCompass(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m16.2 7.8-2.6 6.4-6.4 2.6 2.6-6.4 6.4-2.6z" />
    </svg>
  );
}

export function IconReels(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M3.5 9h17M8 4.5l2.5 4.5M13 4.5l2.5 4.5" />
      <path d="m11 12 4 2.5-4 2.5v-5z" />
    </svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16.5 16.5 3.5 3.5" />
    </svg>
  );
}

export function IconChat(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 18.5 3.8 21l3.2-.8A8.8 8.8 0 1 0 5 18.5z" />
    </svg>
  );
}

export function IconBell(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 16.5h12l-1.2-1.4V11a4.8 4.8 0 1 0-9.6 0v4.1L6 16.5z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconUser(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="8.2" r="3.2" />
      <path d="M5.5 19.2a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

export function IconCompose(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M14 4.5h4.5A1.5 1.5 0 0 1 20 6v12.5A1.5 1.5 0 0 1 18.5 20H6A1.5 1.5 0 0 1 4.5 18.5V14" />
      <path d="M16.2 4.2 8 12.4 7 17l4.6-1 8.2-8.2a1.6 1.6 0 0 0 0-2.3l-.3-.3a1.6 1.6 0 0 0-2.3 0Z" />
    </svg>
  );
}

export function IconPin(p: IconProps) {
  return (
    <svg {...base({ ...p, size: p.size ?? 14 })}>
      <path d="M15.5 10.2 13 12.7l.8 4.8L12 16.2l-1.8 1.3.8-4.8-2.5-2.5V8.5h2.2L12 5.2l1.5 3.3H15.7v1.7Z" />
      <path d="M12 16.5v3" />
    </svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <svg {...base({ ...p, size: p.size ?? 16 })}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconFilter(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

export function IconBookmark(p: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(p)} fill={p.filled ? 'currentColor' : 'none'}>
      <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.2L6 20V5.5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function IconSticker(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <path d="M8.5 14.2c1.2 1.4 2.4 2 3.5 2s2.3-.6 3.5-2" />
    </svg>
  );
}

export function IconMute(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10v4h3l4 3V7L7 10H4z" />
      <path d="m16 9 5 5M21 9l-5 5" />
    </svg>
  );
}

export function IconVolume(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10v4h3l4 3V7L7 10H4z" />
      <path d="M16 9.5a3.2 3.2 0 0 1 0 5" />
      <path d="M18.2 7.2a6 6 0 0 1 0 9.6" />
    </svg>
  );
}

export function IconPhone(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7.2 4.8h2.4l1.2 3-1.6 1a10.5 10.5 0 0 0 4.8 4.8l1-1.6 3 1.2v2.4A1.8 1.8 0 0 1 16.2 18 12.2 12.2 0 0 1 4 5.8a1.8 1.8 0 0 1 1.8-1.8z" />
    </svg>
  );
}

export function IconVideo(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="7" width="11.5" height="10" rx="2" />
      <path d="m15 10.5 5-2.5v8l-5-2.5" />
    </svg>
  );
}

export function IconSendArrow(p: IconProps) {
  return (
    <svg {...base(p)} fill="currentColor" stroke="none">
      <path d="M3.2 11.2 20 4.5l-4.2 15.2-3.5-5.8-5.8-2.7z" />
    </svg>
  );
}

export function IconBack(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M14.5 6 8.5 12l6 6" />
    </svg>
  );
}

export function IconCameraFlip(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9" />
      <path d="M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15" />
      <path d="M8 4 5.5 7.5 8 11" />
      <path d="m16 20 2.5-3.5L16 13" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

/** Phone silhouette with circular rotate arrows (screen orientation). */
export function IconScreenRotate(p: IconProps) {
  return (
    <svg {...base(p)} viewBox="0 0 24 24">
      {/* tilted phone */}
      <rect
        x="9"
        y="4.5"
        width="6"
        height="11"
        rx="1.15"
        transform="rotate(-32 12 10)"
      />
      <line x1="10.4" y1="13.2" x2="13.6" y2="13.2" transform="rotate(-32 12 10)" />
      {/* rotate arcs + arrow heads */}
      <path d="M3.8 10.2a7.6 7.6 0 0 1 7.1-5.6" />
      <polyline points="4.2,6.2 3.6,10.4 7.6,9.7" />
      <path d="M20.2 13.8a7.6 7.6 0 0 1-7.1 5.6" />
      <polyline points="19.8,17.8 20.4,13.6 16.4,14.3" />
    </svg>
  );
}

export function IconHangup(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 15.5c2.8-2.2 5.2-3.2 7-3.2s4.2 1 7 3.2" />
      <path d="M8.2 15.8 6.5 18.5M15.8 15.8 17.5 18.5" />
    </svg>
  );
}

export function IconCheck(p: IconProps & { double?: boolean }) {
  return (
    <svg {...base({ ...p, size: p.size ?? 16 })}>
      <path d="m5 12 3.2 3.2L14.5 8" />
      {p.double ? <path d="m9 12 3.2 3.2L18.5 8" /> : null}
    </svg>
  );
}

export function IconImage(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m7.5 16.5 3.2-3.5 2.3 2.4 3-3.9 3.5 5" />
    </svg>
  );
}

export function IconCamera(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4.5 8.5h3l1.4-2h6.2l1.4 2H19.5A1.5 1.5 0 0 1 21 10v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V10a1.5 1.5 0 0 1 1.5-1.5Z" />
      <circle cx="12" cy="14" r="3.2" />
    </svg>
  );
}

export function IconMic(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="9" y="3.5" width="6" height="10" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5" />
    </svg>
  );
}

export function IconUserPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="9" cy="9" r="3" />
      <path d="M3.8 18.5a5.2 5.2 0 0 1 10.4 0" />
      <path d="M17 8v6M14 11h6" />
    </svg>
  );
}

export function IconSpeaker(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10v4h3l4 3V7L7 10H4z" />
      <path d="M16 8.5c2.2 1.2 2.2 5.8 0 7" />
      <path d="M18.5 6c3.5 2 3.5 10 0 12" />
    </svg>
  );
}

export function IconUsers(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="9" cy="9" r="3" />
      <path d="M3.8 18.5a5.2 5.2 0 0 1 10.4 0" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M14.2 18.5a4.2 4.2 0 0 1 6 0" />
    </svg>
  );
}

export function IconMegaphone(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10v4h2l7 3.5V6.5L6 10H4z" />
      <path d="M18 9.5a3.2 3.2 0 0 1 0 5" />
      <path d="M8.5 17.5v1.2a2.2 2.2 0 0 0 4.2.9" />
    </svg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.8 6.5l1.6 1.6M17.6 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.8 17.5l1.6-1.6M17.6 8.1l1.6-1.6" />
    </svg>
  );
}

export function IconMore(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="6.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconArchive(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 7.5h16v11.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.7V7.5z" />
      <path d="M3 4.8h18v2.7H3z" />
      <path d="M10 12h4" />
    </svg>
  );
}

export function IconHeart(p: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(p)} fill={p.filled ? 'currentColor' : 'none'}>
      <path d="M12 20s-7-4.4-7-9.1A3.9 3.9 0 0 1 12 8.2a3.9 3.9 0 0 1 7 2.7C19 15.6 12 20 12 20z" />
    </svg>
  );
}

export function IconLogout(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M10 5.5H6.5A1.5 1.5 0 0 0 5 7v10a1.5 1.5 0 0 0 1.5 1.5H10" />
      <path d="M14 8.5 17.5 12 14 15.5M9 12h8.5" />
    </svg>
  );
}

/** Instagram-style send / Direct share (paper plane). */
export function IconSend(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

export function IconComment(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5H7l-4 2.2.9-4.1A8.5 8.5 0 1 1 21 12z" />
    </svg>
  );
}

export function IconEye(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
