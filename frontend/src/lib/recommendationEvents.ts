import { recordRecommendationEvents } from '@/api/recommendations';

type Queued = {
  eventId: string;
  eventType: string;
  contentType?: string;
  contentId?: string;
  surface?: string;
  dwellMs?: number;
  progress?: number;
};

const queue: Queued[] = [];
const seen = new Set<string>();
let timer: number | null = null;
let chain: Promise<void> = Promise.resolve();

export function trackRecommendation(event: Queued) {
  if (seen.has(event.eventId)) return;
  seen.add(event.eventId);
  queue.push(event);
  if (timer != null) return;
  timer = window.setTimeout(() => {
    timer = null;
    const batch = queue.splice(0, 25);
    if (!batch.length) return;
    chain = chain
      .catch(() => undefined)
      .then(() => recordRecommendationEvents(batch))
      .then(() => undefined)
      .catch(() => {
        for (const item of batch) seen.delete(item.eventId);
      });
  }, 400);
}

export function recommendationEventId(type: string, contentId: string, bucket = ''): string {
  const raw = `${type}_${contentId}${bucket ? `_${bucket}` : ''}`.replace(/[^A-Za-z0-9_:-]/g, '');
  return raw.slice(0, 80).padEnd(8, '0');
}
