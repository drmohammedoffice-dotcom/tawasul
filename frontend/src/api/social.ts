import { apiData, resolveApiBaseUrl } from '@/api/http';

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await apiData<T>(path, init);
  } catch (err) {
    if (init?.signal?.aborted) {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    throw err;
  }
}

export function fetchFeed(cursor?: string) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return authRequest<any[]>(`/feed${q}`);
}

export function fetchExplore(cursor?: string) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return authRequest<any[]>(`/explore${q}`);
}

export function createPost(input: {
  caption?: string;
  mediaIds: string[];
  hashtags: string[];
  aspectRatio?: '1:1' | '3:4';
  clientRequestId?: string;
}) {
  return authRequest<{ id: string } & Record<string, unknown>>('/posts', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function updatePost(
  postId: string,
  input: {
    caption?: string;
    mediaIds?: string[];
    hashtags?: string[];
    aspectRatio?: '1:1' | '3:4';
  }
) {
  return authRequest<any>(`/posts/${encodeURIComponent(postId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function createReel(input: {
  mediaId: string;
  caption?: string;
  hashtags: string[];
  aspectRatio?: '9:16' | '16:9';
  clientRequestId?: string;
  thumbnailMediaId?: string;
}) {
  return authRequest('/reels', { method: 'POST', body: JSON.stringify(input) });
}

export function updateReel(
  reelId: string,
  input: {
    caption?: string;
    mediaId?: string;
    hashtags?: string[];
    aspectRatio?: '9:16' | '16:9';
    thumbnailMediaId?: string;
  }
) {
  return authRequest<any>(`/reels/${encodeURIComponent(reelId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function fetchVideoTrimStatus() {
  return authRequest<{ available: boolean; maxClipSeconds: number; note: string }>('/media/trim/status');
}

export function trimVideoServer(input: { mediaId: string; startSeconds: number; endSeconds: number }) {
  return authRequest<{ mediaId: string; durationSeconds: number }>('/media/trim', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function fetchPost(id: string) {
  return authRequest<any>(`/posts/${encodeURIComponent(id)}`);
}

export function viewPost(postId: string) {
  return authRequest<{ viewed: boolean; viewCount: number; firstView: boolean }>(
    `/posts/${postId}/view`,
    { method: 'POST' }
  );
}

export function likePost(postId: string) {
  return authRequest(`/posts/${postId}/like`, { method: 'POST' });
}

export function unlikePost(postId: string) {
  return authRequest(`/posts/${postId}/like`, { method: 'DELETE' });
}

export function bookmarkPost(postId: string) {
  return authRequest(`/posts/${postId}/bookmark`, { method: 'POST' });
}

export function unbookmarkPost(postId: string) {
  return authRequest(`/posts/${postId}/bookmark`, { method: 'DELETE' });
}

export function deletePost(postId: string) {
  return authRequest(`/posts/${postId}`, { method: 'DELETE' });
}

export function fetchComments(postId: string) {
  return authRequest<any[]>(`/posts/${postId}/comments`);
}

export function createComment(postId: string, body: string, parentId?: string) {
  return authRequest(`/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, ...(parentId ? { parentId } : {}) })
  });
}

export function deleteComment(postId: string, commentId: string) {
  return authRequest(`/posts/${postId}/comments/${commentId}`, { method: 'DELETE' });
}

export function fetchUserPosts(idOrUsername: string) {
  return authRequest<any[]>(`/users/${encodeURIComponent(idOrUsername)}/posts`);
}

export function followUser(userId: string) {
  return authRequest(`/users/${userId}/follow`, { method: 'POST' });
}

export function unfollowUser(userId: string) {
  return authRequest(`/users/${userId}/follow`, { method: 'DELETE' });
}

export function acceptFollow(followerId: string) {
  return authRequest(`/users/${followerId}/follow/accept`, { method: 'POST' });
}

export function blockUser(userId: string) {
  return authRequest(`/users/${userId}/block`, { method: 'POST' });
}

export function unblockUser(userId: string) {
  return authRequest(`/users/${userId}/block`, { method: 'DELETE' });
}

export function fetchUserProfile(idOrUsername: string) {
  return authRequest<any>(`/users/${encodeURIComponent(idOrUsername)}/profile`);
}

export function fetchFollowers(idOrUsername: string) {
  return authRequest<any[]>(`/users/${encodeURIComponent(idOrUsername)}/followers`);
}

export function fetchFollowing(idOrUsername: string) {
  return authRequest<any[]>(`/users/${encodeURIComponent(idOrUsername)}/following`);
}

export function fetchFollowRequests() {
  return authRequest<any[]>('/users/me/follow-requests');
}

export function fetchStoriesFeed() {
  return authRequest<any[]>('/stories/feed');
}

export function createStory(
  mediaId: string,
  audience: 'everyone' | 'close_friends' | 'family' = 'everyone',
  opts?: { commentsDisabled?: boolean }
) {
  return authRequest('/stories', {
    method: 'POST',
    body: JSON.stringify({
      mediaId,
      audience,
      commentsDisabled: opts?.commentsDisabled === true
    })
  });
}

export function viewStory(storyId: string) {
  return authRequest(`/stories/${storyId}/view`, { method: 'POST' });
}

export function fetchStoryInsights(storyId: string) {
  return authRequest<{
    viewCount: number;
    reactionCount: number;
    replyCount: number;
    viewers: Array<{
      id: string;
      viewedAt: string;
      reaction: string | null;
      user: { id: string; username: string; displayName?: string | null; avatarUrl?: string | null };
    }>;
    reactions: Array<{ id: string; emoji: string; user: any; createdAt: string }>;
    replies: Array<{ id: string; body: string; author: any; createdAt: string }>;
  }>(`/stories/${storyId}/insights`);
}

export function reactToStory(storyId: string, emoji: string) {
  return authRequest(`/stories/${storyId}/react`, {
    method: 'POST',
    body: JSON.stringify({ emoji })
  });
}

export function replyToStory(storyId: string, body: string) {
  return authRequest(`/stories/${storyId}/replies`, {
    method: 'POST',
    body: JSON.stringify({ body })
  });
}

export function fetchStoryReplies(storyId: string) {
  return authRequest<any[]>(`/stories/${storyId}/replies`);
}

export function deleteStory(storyId: string) {
  return authRequest(`/stories/${storyId}`, { method: 'DELETE' });
}

export function fetchNotifications() {
  return authRequest<any[]>('/notifications');
}

export function fetchReelsFeed(cursor?: string) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return authRequest<any[]>(`/reels/feed${q}`);
}

export function fetchReel(id: string) {
  return authRequest<any>(`/reels/${encodeURIComponent(id)}`);
}

export function deleteReel(id: string) {
  return authRequest(`/reels/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function likeReel(reelId: string) {
  return authRequest(`/reels/${reelId}/like`, { method: 'POST' });
}

export function unlikeReel(reelId: string) {
  return authRequest(`/reels/${reelId}/like`, { method: 'DELETE' });
}

export function fetchReelComments(reelId: string, cursor?: string) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return authRequest<any[]>(`/reels/${reelId}/comments${q}`);
}

export function createReelComment(reelId: string, body: string, parentId?: string) {
  return authRequest(`/reels/${reelId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, ...(parentId ? { parentId } : {}) })
  });
}

export function deleteReelComment(reelId: string, commentId: string) {
  return authRequest(`/reels/${reelId}/comments/${commentId}`, { method: 'DELETE' });
}

export function viewReel(reelId: string) {
  return authRequest(`/reels/${reelId}/view`, { method: 'POST' });
}

export function searchAll(q: string, signal?: AbortSignal) {
  return authRequest<{
    users: any[];
    posts: any[];
    hashtags?: any[];
    taggedPosts?: any[];
    query: string;
  }>(`/search?q=${encodeURIComponent(q)}`, signal ? { signal } : undefined);
}

export function fetchBookmarks(cursor?: string) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return authRequest<any[]>(`/bookmarks${q}`);
}

export function fetchMyProfile() {
  return authRequest<any>('/users/me/profile');
}

export function updateMyProfile(input: {
  displayName?: string;
  bio?: string;
  isPrivate?: boolean;
  avatarUrl?: string;
  username?: string;
}) {
  return authRequest('/users/me/profile', { method: 'PATCH', body: JSON.stringify(input) });
}

export function fetchMediaUrl(mediaId: string) {
  return authRequest<{ secureUrl: string }>(`/media/${mediaId}/url`);
}

export function fetchMyGroups() {
  return authRequest<any[]>('/groups');
}

export function createGroup(
  name: string,
  appSpace: 'browse' | 'focus' = 'browse',
  opts?: {
    visibility?: 'public' | 'private';
    description?: string;
    memberIds?: string[];
  }
) {
  return authRequest<{ id: string; inviteSlug?: string | null; visibility?: string }>('/groups', {
    method: 'POST',
    body: JSON.stringify({
      name,
      appSpace,
      visibility: opts?.visibility ?? 'private',
      ...(opts?.description ? { description: opts.description } : {}),
      ...(opts?.memberIds?.length ? { memberIds: opts.memberIds } : {})
    })
  });
}

export function fetchGroup(groupId: string) {
  return authRequest<any>(`/groups/${groupId}`);
}

export function updateGroup(
  groupId: string,
  input: {
    name?: string;
    description?: string;
    avatarUrl?: string | null;
    visibility?: 'public' | 'private';
    historyVisibility?: 'visible' | 'hidden';
  }
) {
  return authRequest<Record<string, unknown>>(`/groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function fetchGroupInvite(groupId: string) {
  return authRequest<{ inviteSlug: string; visibility: string }>(`/groups/${groupId}/invite`);
}

export function leaveGroup(groupId: string) {
  return authRequest(`/groups/${groupId}/leave`, { method: 'POST', body: '{}' });
}

export function deleteGroup(groupId: string) {
  return authRequest(`/groups/${groupId}`, { method: 'DELETE' });
}

export function fetchGroupMembers(groupId: string) {
  return authRequest<any[]>(`/groups/${groupId}/members`);
}

export function addGroupMember(groupId: string, userId: string, role: 'admin' | 'member' = 'member') {
  return authRequest(`/groups/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId, role })
  });
}

export function removeGroupMember(groupId: string, userId: string) {
  return authRequest(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
}

export function fetchGroupMessages(groupId: string) {
  return authRequest<any[]>(`/groups/${groupId}/messages`);
}

export function sendGroupMessage(groupId: string, encryptedContent: string) {
  return authRequest(`/groups/${groupId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ encryptedContent })
  });
}

export function fetchMyChannels() {
  return authRequest<any[]>('/channels');
}

export function createChannel(
  name: string,
  appSpace: 'browse' | 'focus' = 'browse',
  opts?: {
    visibility?: 'public' | 'private';
    description?: string;
    memberIds?: string[];
  }
) {
  return authRequest<{
    id: string;
    inviteSlug?: string | null;
    visibility?: string;
    name?: string;
    _count?: { subscriptions?: number };
  }>('/channels', {
    method: 'POST',
    body: JSON.stringify({
      name,
      appSpace,
      visibility: opts?.visibility ?? 'public',
      ...(opts?.description ? { description: opts.description } : {}),
      ...(opts?.memberIds?.length ? { memberIds: opts.memberIds } : {})
    })
  });
}

export function fetchChannelInvite(channelId: string) {
  return authRequest<{ inviteSlug: string; visibility: string }>(`/channels/${channelId}/invite`);
}

export function leaveChannel(channelId: string) {
  return authRequest(`/channels/${channelId}/leave`, { method: 'POST', body: '{}' });
}

export function joinChannelByInvite(inviteSlug: string) {
  return authRequest(`/channels/join/invite/${encodeURIComponent(inviteSlug)}`, {
    method: 'POST',
    body: '{}'
  });
}

export function pinChannelMessage(channelId: string, messageId: string | null) {
  return authRequest(`/channels/${channelId}/pin`, {
    method: 'POST',
    body: JSON.stringify({ messageId })
  });
}

export function fetchChannel(channelId: string) {
  return authRequest<any>(`/channels/${channelId}`);
}

export function updateChannel(
  channelId: string,
  input: {
    name?: string;
    description?: string;
    avatarUrl?: string | null;
    visibility?: 'public' | 'private';
  }
) {
  return authRequest<Record<string, unknown>>(`/channels/${channelId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function fetchChannelSubscriptions(channelId: string) {
  return authRequest<any[]>(`/channels/${channelId}/subscriptions`);
}

export function addChannelSubscriber(
  channelId: string,
  userId: string,
  role: 'admin' | 'member' = 'member'
) {
  return authRequest(`/channels/${channelId}/subscriptions`, {
    method: 'POST',
    body: JSON.stringify({ userId, role })
  });
}

export function removeChannelSubscriber(channelId: string, userId: string) {
  return authRequest(`/channels/${channelId}/subscriptions/${userId}`, { method: 'DELETE' });
}

export function fetchChannelMessages(channelId: string) {
  return authRequest<any[]>(`/channels/${channelId}/messages`);
}

export function sendChannelMessage(channelId: string, encryptedContent: string) {
  return authRequest(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ encryptedContent })
  });
}

export function resolveMediaUrl(secureUrl?: string | null): string | null {
  if (!secureUrl) return null;
  if (/^(blob:|data:)/i.test(secureUrl)) return secureUrl;
  const apiOrigin = resolveApiBaseUrl().replace(/\/api\/?$/, '');
  try {
    // Absolute URLs that still point at loopback break on Android / LAN phones.
    if (/^https?:\/\//i.test(secureUrl)) {
      const u = new URL(secureUrl);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') {
        const base = new URL(apiOrigin);
        u.protocol = base.protocol;
        u.hostname = base.hostname;
        u.port = base.port;
        return u.toString();
      }
      return secureUrl;
    }
  } catch {
    /* fall through */
  }
  return `${apiOrigin}${secureUrl.startsWith('/') ? '' : '/'}${secureUrl}`;
}

/** SHA-256 hex digest of a File/Blob (for media deduplication). */
export async function sha256File(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createMediaUploadTicket(input: {
  fileName: string;
  mimeType: string;
  mediaType: 'image' | 'video' | 'audio' | 'file';
  sizeBytes: number;
  purpose?: string;
  contentHash: string;
  visibility?: 'public' | 'private';
}) {
  const purpose = input.purpose || 'general';
  const visibility =
    input.visibility ||
    (purpose === 'avatar' || purpose === 'cover' || purpose === 'sticker' ? 'public' : 'private');
  return authRequest<{
    instant: boolean;
    media: { id: string };
    upload: { url: string; method: 'PUT' | 'POST'; headers: Record<string, string> } | null;
  }>('/media/upload-ticket', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      purpose,
      visibility,
      encryptedFileKey: 'public-unencrypted'
    })
  });
}

export async function completeMediaUpload(
  mediaId: string,
  opts?: { durationSeconds?: number; contentHash?: string }
) {
  return authRequest('/media/complete', {
    method: 'POST',
    body: JSON.stringify({
      mediaId,
      ...(opts?.durationSeconds != null ? { durationSeconds: opts.durationSeconds } : {}),
      ...(opts?.contentHash ? { contentHash: opts.contentHash } : {})
    })
  });
}

export async function uploadMediaFileWithMeta(
  file: File,
  purpose: string,
  opts?: { durationSeconds?: number; onProgress?: (pct: number) => void }
) {
  const mediaType = file.type.startsWith('video/')
    ? 'video'
    : file.type.startsWith('audio/')
      ? 'audio'
      : 'image';
  opts?.onProgress?.(2);
  const contentHash = await sha256File(file);
  opts?.onProgress?.(5);
  const ticket = await createMediaUploadTicket({
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    mediaType,
    sizeBytes: file.size,
    purpose,
    contentHash
  });
  if (ticket.instant || !ticket.upload) {
    opts?.onProgress?.(100);
    return ticket.media.id;
  }
  opts?.onProgress?.(8);
  await uploadFileToTicket(file, ticket.upload, (p) => opts?.onProgress?.(8 + Math.round(p * 0.75)));
  opts?.onProgress?.(88);
  await completeMediaUpload(ticket.media.id, {
    contentHash,
    ...(opts?.durationSeconds != null ? { durationSeconds: opts.durationSeconds } : {})
  });
  opts?.onProgress?.(100);
  return ticket.media.id;
}

export async function uploadFileToTicket(
  file: File,
  ticket: { url: string; method: 'PUT' | 'POST'; headers: Record<string, string> },
  onProgress?: (pct: number) => void
) {
  const apiOrigin = resolveApiBaseUrl().replace(/\/api\/?$/, '');
  const url = ticket.url.startsWith('http') ? ticket.url : `${apiOrigin}${ticket.url}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method === 'PUT' ? 'PUT' : 'POST', url);
    xhr.upload.onprogress = (ev) => {
      if (!onProgress || !ev.lengthComputable || ev.total <= 0) return;
      onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(ticket.method === 'PUT' ? 'Direct upload to storage failed' : 'Local upload failed'));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));

    if (ticket.method === 'PUT') {
      Object.entries(ticket.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.send(file);
    } else {
      const form = new FormData();
      form.append('file', file);
      xhr.send(form);
    }
  });
}

export async function uploadMediaFile(file: File, purpose: string) {
  return uploadMediaFileWithMeta(file, purpose);
}
