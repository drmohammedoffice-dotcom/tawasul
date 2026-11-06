import { apiData } from '@/api/http';

export type FeedMode = 'personalized' | 'following_chronological';

export function recordRecommendationEvents(
  events: Array<{
    eventId: string;
    eventType: string;
    contentType?: string;
    contentId?: string;
    surface?: string;
    dwellMs?: number;
    progress?: number;
    query?: string;
  }>
) {
  return apiData('/recommendations/events', {
    method: 'POST',
    body: JSON.stringify({ events })
  });
}

export type RecommendationPreferences = { feedMode: FeedMode; personalizationEnabled: boolean };

export function fetchRecommendationPreferences() {
  return apiData<RecommendationPreferences>('/recommendations/preferences');
}

export function saveRecommendationPreferences(feedMode: FeedMode, personalizationEnabled?: boolean) {
  return apiData<RecommendationPreferences>('/recommendations/preferences', {
    method: 'PUT',
    body: JSON.stringify({
      feedMode,
      ...(personalizationEnabled === undefined ? {} : { personalizationEnabled })
    })
  });
}

export function fetchInferredInterests() {
  return apiData<{
    declared: string[];
    inferred: Array<{ key: string; kind: string; strength: number; polarity: string; sustained: boolean }>;
  }>('/recommendations/interests');
}

export function forgetInferredInterest(key: string) {
  return apiData<{ removed: boolean }>(`/recommendations/interests/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

export function saveRecommendationFeature(key: string, enabled: boolean, value = 0) {
  return apiData<{ ok: boolean }>('/recommendations/admin/features', {
    method: 'PUT',
    body: JSON.stringify({ key, enabled, value })
  });
}

export function rollbackRecommendation(version = 'baseline-1.0.0') {
  return apiData<{ version: string }>('/recommendations/admin/rollback', {
    method: 'POST',
    body: JSON.stringify({ version })
  });
}

export function resetRecommendations() {
  return apiData<{ cleared: boolean }>('/recommendations/reset', { method: 'POST' });
}

export function fetchRecommendationAdmin() {
  return apiData<Record<string, unknown>>('/recommendations/admin/overview');
}
