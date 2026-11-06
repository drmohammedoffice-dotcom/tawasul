import { apiData } from '@/api/http';

export function setPostCommentsDisabled(postId: string, disabled: boolean) {
  return apiData(`/posts/${postId}/comments-disabled`, {
    method: 'PATCH',
    body: JSON.stringify({ disabled })
  });
}

export function archivePost(postId: string, archive: boolean) {
  return apiData(`/posts/${postId}/archive`, {
    method: 'PATCH',
    body: JSON.stringify({ archive })
  });
}

export function setReelCommentsDisabled(reelId: string, disabled: boolean) {
  return apiData(`/reels/${reelId}/comments-disabled`, {
    method: 'PATCH',
    body: JSON.stringify({ disabled })
  });
}

export function archiveReel(reelId: string, archive: boolean) {
  return apiData(`/reels/${reelId}/archive`, {
    method: 'PATCH',
    body: JSON.stringify({ archive })
  });
}

export function fetchContentArchive() {
  return apiData<{ posts: any[]; reels: any[] }>('/content/archive');
}

export function recordContentSignal(input: {
  targetType: 'post' | 'reel';
  targetId: string;
  signal: 'more_like_this' | 'not_interested';
}) {
  return apiData('/content/signals', { method: 'POST', body: JSON.stringify(input) });
}

export function createShareLink(targetType: 'post' | 'reel' | 'story', targetId: string) {
  return apiData<{ url: string }>('/content/share-link', {
    method: 'POST',
    body: JSON.stringify({ targetType, targetId })
  });
}

export function shareContentToDm(input: {
  targetType: 'post' | 'reel' | 'story';
  targetId: string;
  receiverIds: string[];
}) {
  return apiData<{ sentCount: number; url: string; shareCount?: number }>('/content/share-dm', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function requestDownloadUrl(targetType: 'post' | 'reel', targetId: string) {
  return apiData<{ secureUrl: string; mimeType: string; mediaId: string }>('/content/download', {
    method: 'POST',
    body: JSON.stringify({ targetType, targetId })
  });
}
