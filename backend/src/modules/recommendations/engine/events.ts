import { BASELINE_WEIGHTS, EVENT_TYPES, type RecommendationEventType } from './types';

const EVENT_SET = new Set<string>(EVENT_TYPES);

const WATCH_TYPES = new Set([
  'qualified_view',
  'video_progress',
  'video_complete',
  'replay'
]);

/** How long a repeated event from the same user and content is rejected. */
export function logicalDuplicateWindowMs(eventType: string): number | null {
  switch (eventType) {
    case 'impression':
      return 30 * 60 * 1000;
    case 'qualified_view':
    case 'video_start':
    case 'video_skip':
    case 'video_complete':
    case 'story_view':
    case 'story_complete':
    case 'profile_visit':
      return 12 * 60 * 60 * 1000;
    case 'video_progress':
      return 10 * 1000;
    case 'replay':
      return 60 * 60 * 1000;
    case 'like':
    case 'unlike':
    case 'save':
    case 'unsave':
    case 'share':
    case 'comment':
    case 'delete_comment':
    case 'follow':
    case 'unfollow':
    case 'hide_post':
    case 'not_interested':
    case 'report':
    case 'dismiss_recommendation':
    case 'more_like_this':
      return 24 * 60 * 60 * 1000;
    case 'search_query':
      return 60 * 1000;
    default:
      return null;
  }
}

export const MAX_REPLAYS_PER_DAY = 8;

/** Positive and negative interest deltas. Declared topics are not inferred from this. */
export const INTEREST_DELTA: Record<string, number> = {
  like: 1,
  unlike: -1,
  comment: 1.2,
  delete_comment: -0.6,
  save: 1.4,
  unsave: -1.4,
  share: 1.6,
  qualified_view: 0.35,
  video_skip: -0.25,
  video_complete: 0.8,
  replay: 0.5,
  story_view: 0.2,
  story_complete: 0.45,
  follow: 0.6,
  unfollow: -0.6,
  profile_visit: 0.15,
  not_interested: -1.5,
  hide_post: -2,
  dismiss_recommendation: -1,
  report: -2,
  more_like_this: 0.8
};

export const DECLARED_TOPIC_WEIGHT = 2;

export function decayWeight(weight: number, ageDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(ageDays) || halfLifeDays <= 0) return 0;
  if (ageDays <= 0) return weight;
  return weight * Math.pow(0.5, ageDays / halfLifeDays);
}

export type IncomingEvent = {
  eventId: string;
  eventType: string;
  contentType?: string;
  contentId?: string;
  surface?: string;
  dwellMs?: number;
  progress?: number;
  query?: string;
  occurredAt?: string;
};

export type ValidatedEvent = {
  eventId: string;
  eventType: RecommendationEventType;
  contentType: string | null;
  contentId: string | null;
  surface: string | null;
  value: number | null;
  topicKey: string | null;
  occurredAtMs: number;
};

export function normalizeSearchToken(raw: string): string | null {
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text.length > 80) return null;
  if (text.includes('@') || /\d{6,}/.test(text)) return null;
  const token = text.replace(/[^\p{L}\p{N}_]+/gu, '').slice(0, 32);
  if (token.length < 2) return null;
  return token;
}

export function captionTokens(caption: string | null | undefined): string[] {
  const found = String(caption || '').toLowerCase().match(/[\p{L}\p{N}_]{3,32}/gu) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of found) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Rejects malformed, implausible, or context-free watch events.
 * Durations outside the configured bounds are rejected, not trusted.
 */
export function validateEvent(
  input: IncomingEvent,
  nowMs: number,
  limits: { qualifiedViewMs: number; maxWatchMs: number; videoCompleteRatio: number } = BASELINE_WEIGHTS
): { ok: true; event: ValidatedEvent } | { ok: false; reason: string } {
  const eventId = String(input.eventId || '');
  if (!/^[A-Za-z0-9_:-]{8,80}$/.test(eventId)) return { ok: false, reason: 'bad_event_id' };
  if (!EVENT_SET.has(input.eventType)) return { ok: false, reason: 'bad_type' };
  const eventType = input.eventType as RecommendationEventType;

  let occurredAtMs = nowMs;
  if (input.occurredAt) {
    const parsed = Date.parse(input.occurredAt);
    if (!Number.isFinite(parsed)) return { ok: false, reason: 'bad_time' };
    if (parsed > nowMs + 30_000) return { ok: false, reason: 'future_time' };
    if (nowMs - parsed > 10 * 60 * 1000) return { ok: false, reason: 'stale_time' };
    occurredAtMs = parsed;
  }

  if (eventType === 'search_query') {
    const topicKey = normalizeSearchToken(input.query || '');
    if (!topicKey) return { ok: false, reason: 'empty_query' };
    return {
      ok: true,
      event: {
        eventId,
        eventType,
        contentType: null,
        contentId: null,
        surface: input.surface || 'search',
        value: null,
        topicKey,
        occurredAtMs
      }
    };
  }

  const contentType = input.contentType || '';
  let contentId = String(input.contentId || '');
  if (!['post', 'reel', 'story', 'user', 'hashtag'].includes(contentType)) {
    return { ok: false, reason: 'bad_content_type' };
  }
  if (contentType === 'hashtag') {
    const token = normalizeSearchToken(contentId);
    if (!token) return { ok: false, reason: 'bad_content_id' };
    contentId = token;
  } else if (!/^[A-Za-z0-9_-]{4,80}$/.test(contentId)) {
    return { ok: false, reason: 'bad_content_id' };
  }
  if (contentType === 'message') return { ok: false, reason: 'private_content' };

  let value: number | null = null;
  if (WATCH_TYPES.has(eventType) || eventType === 'story_complete' || eventType === 'video_skip') {
    const dwell = Number(input.dwellMs);
    if (!Number.isFinite(dwell)) return { ok: false, reason: 'missing_dwell' };
    if (dwell < 0 || dwell > limits.maxWatchMs) return { ok: false, reason: 'dwell_out_of_range' };
    if (eventType === 'qualified_view' && dwell < limits.qualifiedViewMs) {
      return { ok: false, reason: 'dwell_too_short' };
    }
    if (eventType === 'video_skip' && dwell >= limits.qualifiedViewMs) {
      return { ok: false, reason: 'not_a_skip' };
    }
    value = Math.round(dwell);
  }

  if (eventType === 'video_progress' || eventType === 'video_complete') {
    const progress = Number(input.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      return { ok: false, reason: 'bad_progress' };
    }
    if (eventType === 'video_complete' && progress < limits.videoCompleteRatio) {
      return { ok: false, reason: 'not_complete' };
    }
    value = Math.round(progress * 100);
  }

  if (eventType === 'story_view') {
    value = 1;
  }

  return {
    ok: true,
    event: {
      eventId,
      eventType,
      contentType,
      contentId,
      surface: input.surface || null,
      value,
      topicKey: null,
      occurredAtMs
    }
  };
}
