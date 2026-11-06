import { recordRecommendationEvents } from '@/api/recommendations';
const queue = [];
const seen = new Set();
let timer = null;
let chain = Promise.resolve();
export function trackRecommendation(event) {
    if (seen.has(event.eventId))
        return;
    seen.add(event.eventId);
    queue.push(event);
    if (timer != null)
        return;
    timer = window.setTimeout(() => {
        timer = null;
        const batch = queue.splice(0, 25);
        if (!batch.length)
            return;
        chain = chain
            .catch(() => undefined)
            .then(() => recordRecommendationEvents(batch))
            .then(() => undefined)
            .catch(() => {
            for (const item of batch)
                seen.delete(item.eventId);
        });
    }, 400);
}
export function recommendationEventId(type, contentId, bucket = '') {
    const raw = `${type}_${contentId}${bucket ? `_${bucket}` : ''}`.replace(/[^A-Za-z0-9_:-]/g, '');
    return raw.slice(0, 80).padEnd(8, '0');
}
