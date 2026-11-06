/** Content statuses visible on public surfaces (feed, explore, search, others' profiles). */
export const PUBLIC_MODERATION_STATUSES = ['APPROVED', 'RESTORED'] as const;

/** Author may see these on their own content management surfaces. */
export const OWNER_VISIBLE_STATUSES = [
  'APPROVED',
  'RESTORED',
  'PENDING_REVIEW',
  'REVIEW_FAILED',
  'FLAGGED',
  'RESTRICTED',
  'HIDDEN',
  'APPEAL_PENDING',
  'REMOVED'
] as const;

/** Discovery (Explore / Reels ranking / recommendations) — same quarantine as public. */
export const DISCOVERY_MODERATION_STATUSES = ['APPROVED', 'RESTORED'] as const;

export type ModerationStatus =
  | 'PENDING_REVIEW'
  | 'REVIEW_FAILED'
  | 'APPROVED'
  | 'FLAGGED'
  | 'RESTRICTED'
  | 'HIDDEN'
  | 'APPEAL_PENDING'
  | 'RESTORED'
  | 'REMOVED'
  | 'PERMANENTLY_DELETED';

export function publicModerationWhere() {
  return { moderationStatus: { in: [...PUBLIC_MODERATION_STATUSES] } };
}

export function discoveryModerationWhere() {
  return { moderationStatus: { in: [...DISCOVERY_MODERATION_STATUSES] } };
}

export function isPubliclyVisible(status: string | null | undefined): boolean {
  return PUBLIC_MODERATION_STATUSES.includes(
    (status || 'PENDING_REVIEW') as (typeof PUBLIC_MODERATION_STATUSES)[number]
  );
}

export function isDiscoveryVisible(status: string | null | undefined): boolean {
  return DISCOVERY_MODERATION_STATUSES.includes(
    (status || 'PENDING_REVIEW') as (typeof DISCOVERY_MODERATION_STATUSES)[number]
  );
}

/**
 * Public/discovery surfaces only mint media bytes after APPROVED/RESTORED.
 * Owner preview (own profile / account transparency) may mint a secureUrl for
 * quarantined statuses so the author can identify restricted content — never
 * for other viewers.
 */
export function mediaBytesAllowed(
  status: string | null | undefined,
  opts?: { isOwner?: boolean }
): boolean {
  if (isPubliclyVisible(status)) return true;
  if (!opts?.isOwner) return false;
  const s = status || 'PENDING_REVIEW';
  return (
    s === 'PENDING_REVIEW' ||
    s === 'REVIEW_FAILED' ||
    s === 'FLAGGED' ||
    s === 'RESTRICTED' ||
    s === 'HIDDEN' ||
    s === 'APPEAL_PENDING' ||
    s === 'REMOVED'
  );
}

/** Owner-only badge labels — never shown to other viewers. */
export function ownerBadge(status: string): { badge: string; canAppeal: boolean } | null {
  switch (status) {
    case 'PENDING_REVIEW':
      return { badge: 'قيد المراجعة', canAppeal: false };
    case 'REVIEW_FAILED':
      return { badge: 'فشل الفحص — قيد الانتظار', canAppeal: true };
    case 'HIDDEN':
    case 'REMOVED':
      return { badge: 'محتوى محظور', canAppeal: true };
    case 'RESTRICTED':
    case 'FLAGGED':
      return { badge: 'مقيّد', canAppeal: true };
    case 'APPEAL_PENDING':
      return { badge: 'طعن قيد المراجعة', canAppeal: false };
    default:
      return null;
  }
}
