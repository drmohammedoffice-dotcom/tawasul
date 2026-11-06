import { jsx as _jsx } from "react/jsx-runtime";
import { resolveMediaUrl } from '@/api/social';
/** Circular avatar with cover-crop (Instagram-style). Never stretches full-bleed. */
export function UserAvatar({ name, username, avatarUrl, size = 'md', className = '', ring = 'none' }) {
    const label = (name || username || '?').trim();
    const initial = label.slice(0, 1).toUpperCase() || '?';
    const src = resolveMediaUrl(avatarUrl);
    const sizeClass = size === 'sm' ? 'sm' : size === 'md' ? 'md' : size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : 'md';
    const ringClass = ring === 'story' ? 'avatar-ring-unseen' : ring === 'story-seen' ? 'avatar-ring-seen' : '';
    return (_jsx("span", { className: `avatar-circle ${sizeClass} ${ringClass} ${className}`.trim(), "aria-hidden": !src, title: username ? `@${username}` : label, children: src ? _jsx("img", { src: src, alt: "" }) : initial }));
}
