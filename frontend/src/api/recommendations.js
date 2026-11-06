import { apiData } from '@/api/http';
export function recordRecommendationEvents(events) {
    return apiData('/recommendations/events', {
        method: 'POST',
        body: JSON.stringify({ events })
    });
}
export function fetchRecommendationPreferences() {
    return apiData('/recommendations/preferences');
}
export function saveRecommendationPreferences(feedMode, personalizationEnabled) {
    return apiData('/recommendations/preferences', {
        method: 'PUT',
        body: JSON.stringify({
            feedMode,
            ...(personalizationEnabled === undefined ? {} : { personalizationEnabled })
        })
    });
}
export function fetchInferredInterests() {
    return apiData('/recommendations/interests');
}
export function forgetInferredInterest(key) {
    return apiData(`/recommendations/interests/${encodeURIComponent(key)}`, { method: 'DELETE' });
}
export function saveRecommendationFeature(key, enabled, value = 0) {
    return apiData('/recommendations/admin/features', {
        method: 'PUT',
        body: JSON.stringify({ key, enabled, value })
    });
}
export function rollbackRecommendation(version = 'baseline-1.0.0') {
    return apiData('/recommendations/admin/rollback', {
        method: 'POST',
        body: JSON.stringify({ version })
    });
}
export function resetRecommendations() {
    return apiData('/recommendations/reset', { method: 'POST' });
}
export function fetchRecommendationAdmin() {
    return apiData('/recommendations/admin/overview');
}
