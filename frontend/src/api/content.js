import { apiData } from '@/api/http';
export function setPostCommentsDisabled(postId, disabled) {
    return apiData(`/posts/${postId}/comments-disabled`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled })
    });
}
export function archivePost(postId, archive) {
    return apiData(`/posts/${postId}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ archive })
    });
}
export function setReelCommentsDisabled(reelId, disabled) {
    return apiData(`/reels/${reelId}/comments-disabled`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled })
    });
}
export function archiveReel(reelId, archive) {
    return apiData(`/reels/${reelId}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ archive })
    });
}
export function fetchContentArchive() {
    return apiData('/content/archive');
}
export function recordContentSignal(input) {
    return apiData('/content/signals', { method: 'POST', body: JSON.stringify(input) });
}
export function createShareLink(targetType, targetId) {
    return apiData('/content/share-link', {
        method: 'POST',
        body: JSON.stringify({ targetType, targetId })
    });
}
export function shareContentToDm(input) {
    return apiData('/content/share-dm', {
        method: 'POST',
        body: JSON.stringify(input)
    });
}
export function requestDownloadUrl(targetType, targetId) {
    return apiData('/content/download', {
        method: 'POST',
        body: JSON.stringify({ targetType, targetId })
    });
}
