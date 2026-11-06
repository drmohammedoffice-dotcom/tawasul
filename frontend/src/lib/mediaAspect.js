/** Instagram-like feed box ratios from stored aspect or media dimensions. */
export function normalizeAspect(raw) {
    if (!raw)
        return null;
    const key = String(raw).trim().replace('/', ':');
    if (key === '1:1')
        return '1/1';
    if (key === '3:4')
        return '3/4';
    if (key === '9:16')
        return '9/16';
    if (key === '16:9')
        return '16/9';
    return null;
}
export function postFeedAspect(width, height, stored) {
    const fromStore = normalizeAspect(stored);
    // Honor publish-time aspect only (1:1 / 3:4)
    if (fromStore === '1/1' || fromStore === '3/4')
        return fromStore;
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    if (w <= 0 || h <= 0)
        return '1/1';
    const r = w / h;
    if (r < 0.92)
        return '3/4';
    return '1/1';
}
export function reelFeedAspect(width, height, stored) {
    const fromStore = normalizeAspect(stored);
    // Always honor publish-time choice — never flip on resize/metadata load
    if (fromStore === '9/16' || fromStore === '16/9')
        return fromStore;
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    if (w > 0 && h > 0 && w / h > 1.2)
        return '16/9';
    return '9/16';
}
export function aspectCss(aspect) {
    return aspect;
}
