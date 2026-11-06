import { apiData, resolveApiBaseUrl } from '@/api/http';
async function authRequest(path, init) {
    try {
        return await apiData(path, init);
    }
    catch (err) {
        if (init?.signal?.aborted) {
            const abortErr = new Error('aborted');
            abortErr.name = 'AbortError';
            throw abortErr;
        }
        throw err;
    }
}
export function fetchFeed(cursor) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return authRequest(`/feed${q}`);
}
export function fetchExplore(cursor) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return authRequest(`/explore${q}`);
}
export function createPost(input) {
    return authRequest('/posts', {
        method: 'POST',
        body: JSON.stringify(input)
    });
}
export function updatePost(postId, input) {
    return authRequest(`/posts/${encodeURIComponent(postId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input)
    });
}
export function createReel(input) {
    return authRequest('/reels', { method: 'POST', body: JSON.stringify(input) });
}
export function updateReel(reelId, input) {
    return authRequest(`/reels/${encodeURIComponent(reelId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input)
    });
}
export function fetchVideoTrimStatus() {
    return authRequest('/media/trim/status');
}
export function trimVideoServer(input) {
    return authRequest('/media/trim', {
        method: 'POST',
        body: JSON.stringify(input)
    });
}
export function fetchPost(id) {
    return authRequest(`/posts/${encodeURIComponent(id)}`);
}
export function viewPost(postId) {
    return authRequest(`/posts/${postId}/view`, { method: 'POST' });
}
export function likePost(postId) {
    return authRequest(`/posts/${postId}/like`, { method: 'POST' });
}
export function unlikePost(postId) {
    return authRequest(`/posts/${postId}/like`, { method: 'DELETE' });
}
export function bookmarkPost(postId) {
    return authRequest(`/posts/${postId}/bookmark`, { method: 'POST' });
}
export function unbookmarkPost(postId) {
    return authRequest(`/posts/${postId}/bookmark`, { method: 'DELETE' });
}
export function deletePost(postId) {
    return authRequest(`/posts/${postId}`, { method: 'DELETE' });
}
export function fetchComments(postId) {
    return authRequest(`/posts/${postId}/comments`);
}
export function createComment(postId, body, parentId) {
    return authRequest(`/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, ...(parentId ? { parentId } : {}) })
    });
}
export function deleteComment(postId, commentId) {
    return authRequest(`/posts/${postId}/comments/${commentId}`, { method: 'DELETE' });
}
export function fetchUserPosts(idOrUsername) {
    return authRequest(`/users/${encodeURIComponent(idOrUsername)}/posts`);
}
export function followUser(userId) {
    return authRequest(`/users/${userId}/follow`, { method: 'POST' });
}
export function unfollowUser(userId) {
    return authRequest(`/users/${userId}/follow`, { method: 'DELETE' });
}
export function acceptFollow(followerId) {
    return authRequest(`/users/${followerId}/follow/accept`, { method: 'POST' });
}
export function blockUser(userId) {
    return authRequest(`/users/${userId}/block`, { method: 'POST' });
}
export function unblockUser(userId) {
    return authRequest(`/users/${userId}/block`, { method: 'DELETE' });
}
export function fetchUserProfile(idOrUsername) {
    return authRequest(`/users/${encodeURIComponent(idOrUsername)}/profile`);
}
export function fetchFollowers(idOrUsername) {
    return authRequest(`/users/${encodeURIComponent(idOrUsername)}/followers`);
}
export function fetchFollowing(idOrUsername) {
    return authRequest(`/users/${encodeURIComponent(idOrUsername)}/following`);
}
export function fetchFollowRequests() {
    return authRequest('/users/me/follow-requests');
}
export function fetchStoriesFeed() {
    return authRequest('/stories/feed');
}
export function createStory(mediaId, audience = 'everyone', opts) {
    return authRequest('/stories', {
        method: 'POST',
        body: JSON.stringify({
            mediaId,
            audience,
            commentsDisabled: opts?.commentsDisabled === true
        })
    });
}
export function viewStory(storyId) {
    return authRequest(`/stories/${storyId}/view`, { method: 'POST' });
}
export function fetchStoryInsights(storyId) {
    return authRequest(`/stories/${storyId}/insights`);
}
export function reactToStory(storyId, emoji) {
    return authRequest(`/stories/${storyId}/react`, {
        method: 'POST',
        body: JSON.stringify({ emoji })
    });
}
export function replyToStory(storyId, body) {
    return authRequest(`/stories/${storyId}/replies`, {
        method: 'POST',
        body: JSON.stringify({ body })
    });
}
export function fetchStoryReplies(storyId) {
    return authRequest(`/stories/${storyId}/replies`);
}
export function deleteStory(storyId) {
    return authRequest(`/stories/${storyId}`, { method: 'DELETE' });
}
export function fetchNotifications() {
    return authRequest('/notifications');
}
export function fetchReelsFeed(cursor) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return authRequest(`/reels/feed${q}`);
}
export function fetchReel(id) {
    return authRequest(`/reels/${encodeURIComponent(id)}`);
}
export function deleteReel(id) {
    return authRequest(`/reels/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function likeReel(reelId) {
    return authRequest(`/reels/${reelId}/like`, { method: 'POST' });
}
export function unlikeReel(reelId) {
    return authRequest(`/reels/${reelId}/like`, { method: 'DELETE' });
}
export function fetchReelComments(reelId, cursor) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return authRequest(`/reels/${reelId}/comments${q}`);
}
export function createReelComment(reelId, body, parentId) {
    return authRequest(`/reels/${reelId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, ...(parentId ? { parentId } : {}) })
    });
}
export function deleteReelComment(reelId, commentId) {
    return authRequest(`/reels/${reelId}/comments/${commentId}`, { method: 'DELETE' });
}
export function viewReel(reelId) {
    return authRequest(`/reels/${reelId}/view`, { method: 'POST' });
}
export function searchAll(q, signal) {
    return authRequest(`/search?q=${encodeURIComponent(q)}`, signal ? { signal } : undefined);
}
export function fetchBookmarks(cursor) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return authRequest(`/bookmarks${q}`);
}
export function fetchMyProfile() {
    return authRequest('/users/me/profile');
}
export function updateMyProfile(input) {
    return authRequest('/users/me/profile', { method: 'PATCH', body: JSON.stringify(input) });
}
export function fetchMediaUrl(mediaId) {
    return authRequest(`/media/${mediaId}/url`);
}
export function fetchMyGroups() {
    return authRequest('/groups');
}
export function createGroup(name, appSpace = 'browse', opts) {
    return authRequest('/groups', {
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
export function fetchGroup(groupId) {
    return authRequest(`/groups/${groupId}`);
}
export function updateGroup(groupId, input) {
    return authRequest(`/groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify(input)
    });
}
export function fetchGroupInvite(groupId) {
    return authRequest(`/groups/${groupId}/invite`);
}
export function leaveGroup(groupId) {
    return authRequest(`/groups/${groupId}/leave`, { method: 'POST', body: '{}' });
}
export function deleteGroup(groupId) {
    return authRequest(`/groups/${groupId}`, { method: 'DELETE' });
}
export function fetchGroupMembers(groupId) {
    return authRequest(`/groups/${groupId}/members`);
}
export function addGroupMember(groupId, userId, role = 'member') {
    return authRequest(`/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId, role })
    });
}
export function removeGroupMember(groupId, userId) {
    return authRequest(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
}
export function fetchGroupMessages(groupId) {
    return authRequest(`/groups/${groupId}/messages`);
}
export function sendGroupMessage(groupId, encryptedContent) {
    return authRequest(`/groups/${groupId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ encryptedContent })
    });
}
export function fetchMyChannels() {
    return authRequest('/channels');
}
export function createChannel(name, appSpace = 'browse', opts) {
    return authRequest('/channels', {
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
export function fetchChannelInvite(channelId) {
    return authRequest(`/channels/${channelId}/invite`);
}
export function leaveChannel(channelId) {
    return authRequest(`/channels/${channelId}/leave`, { method: 'POST', body: '{}' });
}
export function joinChannelByInvite(inviteSlug) {
    return authRequest(`/channels/join/invite/${encodeURIComponent(inviteSlug)}`, {
        method: 'POST',
        body: '{}'
    });
}
export function pinChannelMessage(channelId, messageId) {
    return authRequest(`/channels/${channelId}/pin`, {
        method: 'POST',
        body: JSON.stringify({ messageId })
    });
}
export function fetchChannel(channelId) {
    return authRequest(`/channels/${channelId}`);
}
export function updateChannel(channelId, input) {
    return authRequest(`/channels/${channelId}`, {
        method: 'PATCH',
        body: JSON.stringify(input)
    });
}
export function fetchChannelSubscriptions(channelId) {
    return authRequest(`/channels/${channelId}/subscriptions`);
}
export function addChannelSubscriber(channelId, userId, role = 'member') {
    return authRequest(`/channels/${channelId}/subscriptions`, {
        method: 'POST',
        body: JSON.stringify({ userId, role })
    });
}
export function removeChannelSubscriber(channelId, userId) {
    return authRequest(`/channels/${channelId}/subscriptions/${userId}`, { method: 'DELETE' });
}
export function fetchChannelMessages(channelId) {
    return authRequest(`/channels/${channelId}/messages`);
}
export function sendChannelMessage(channelId, encryptedContent) {
    return authRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ encryptedContent })
    });
}
export function resolveMediaUrl(secureUrl) {
    if (!secureUrl)
        return null;
    if (/^(blob:|data:)/i.test(secureUrl))
        return secureUrl;
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
    }
    catch {
        /* fall through */
    }
    return `${apiOrigin}${secureUrl.startsWith('/') ? '' : '/'}${secureUrl}`;
}
/** SHA-256 hex digest of a File/Blob (for media deduplication). */
export async function sha256File(file) {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function createMediaUploadTicket(input) {
    return authRequest('/media/upload-ticket', {
        method: 'POST',
        body: JSON.stringify({
            ...input,
            encryptedFileKey: 'public-unencrypted'
        })
    });
}
export async function completeMediaUpload(mediaId, opts) {
    return authRequest('/media/complete', {
        method: 'POST',
        body: JSON.stringify({
            mediaId,
            ...(opts?.durationSeconds != null ? { durationSeconds: opts.durationSeconds } : {}),
            ...(opts?.contentHash ? { contentHash: opts.contentHash } : {})
        })
    });
}
export async function uploadMediaFileWithMeta(file, purpose, opts) {
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
export async function uploadFileToTicket(file, ticket, onProgress) {
    const apiOrigin = resolveApiBaseUrl().replace(/\/api\/?$/, '');
    const url = ticket.url.startsWith('http') ? ticket.url : `${apiOrigin}${ticket.url}`;
    await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(ticket.method === 'PUT' ? 'PUT' : 'POST', url);
        xhr.upload.onprogress = (ev) => {
            if (!onProgress || !ev.lengthComputable || ev.total <= 0)
                return;
            onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                onProgress?.(100);
                resolve();
            }
            else {
                reject(new Error(ticket.method === 'PUT' ? 'Direct upload to storage failed' : 'Local upload failed'));
            }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.onabort = () => reject(new Error('Upload aborted'));
        if (ticket.method === 'PUT') {
            Object.entries(ticket.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
            xhr.send(file);
        }
        else {
            const form = new FormData();
            form.append('file', file);
            xhr.send(form);
        }
    });
}
export async function uploadMediaFile(file, purpose) {
    return uploadMediaFileWithMeta(file, purpose);
}
