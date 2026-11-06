import { useEffect, useRef, type ReactNode } from 'react';
import { recommendationEventId, trackRecommendation } from '@/lib/recommendationEvents';

export function ImpressionSlot({
  contentType,
  contentId,
  surface,
  children
}: {
  contentType: 'post' | 'reel' | 'story';
  contentId: string;
  surface: 'feed' | 'reels' | 'stories' | 'explore';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !contentId) return;
    let visibleSince: number | null = null;
    let impressionTimer: number | null = null;
    let capTimer: number | null = null;
    let impressed = false;
    let qualifiedSent = false;
    const clearTimer = (id: number | null) => {
      if (id != null) window.clearTimeout(id);
    };
    const sendQualified = () => {
      if (!impressed || qualifiedSent || visibleSince == null) return;
      const dwell = Date.now() - visibleSince;
      if (dwell < 2000) return;
      qualifiedSent = true;
      trackRecommendation({
        eventId: recommendationEventId('qv', contentId),
        eventType: 'qualified_view',
        contentType,
        contentId,
        surface,
        dwellMs: Math.min(180000, Math.round(dwell))
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
        if (!visible) {
          clearTimer(impressionTimer);
          impressionTimer = null;
          sendQualified();
          visibleSince = null;
          return;
        }
        if (visibleSince == null) visibleSince = Date.now();
        if (!impressed && impressionTimer == null) {
          impressionTimer = window.setTimeout(() => {
            impressionTimer = null;
            if (visibleSince == null || impressed) return;
            impressed = true;
            trackRecommendation({
              eventId: recommendationEventId('imp', contentId),
              eventType: 'impression',
              contentType,
              contentId,
              surface
            });
            capTimer = window.setTimeout(sendQualified, 180000);
          }, 300);
        }
      },
      { threshold: [0.5] }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      clearTimer(impressionTimer);
      clearTimer(capTimer);
      sendQualified();
    };
  }, [contentId, contentType, surface]);

  return <div ref={ref}>{children}</div>;
}
