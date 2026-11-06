import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { recommendationEventId, trackRecommendation } from '@/lib/recommendationEvents';
export function ImpressionSlot({ contentType, contentId, surface, children }) {
    const ref = useRef(null);
    useEffect(() => {
        const node = ref.current;
        if (!node || !contentId)
            return;
        let visibleSince = null;
        let impressionTimer = null;
        let capTimer = null;
        let impressed = false;
        let qualifiedSent = false;
        const clearTimer = (id) => {
            if (id != null)
                window.clearTimeout(id);
        };
        const sendQualified = () => {
            if (!impressed || qualifiedSent || visibleSince == null)
                return;
            const dwell = Date.now() - visibleSince;
            if (dwell < 2000)
                return;
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
        const observer = new IntersectionObserver((entries) => {
            const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
            if (!visible) {
                clearTimer(impressionTimer);
                impressionTimer = null;
                sendQualified();
                visibleSince = null;
                return;
            }
            if (visibleSince == null)
                visibleSince = Date.now();
            if (!impressed && impressionTimer == null) {
                impressionTimer = window.setTimeout(() => {
                    impressionTimer = null;
                    if (visibleSince == null || impressed)
                        return;
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
        }, { threshold: [0.5] });
        observer.observe(node);
        return () => {
            observer.disconnect();
            clearTimer(impressionTimer);
            clearTimer(capTimer);
            sendQualified();
        };
    }, [contentId, contentType, surface]);
    return _jsx("div", { ref: ref, children: children });
}
