import { apiData } from '@/api/http';
export function fetchUnifiedInbox(limit = 60, space = 'focus') {
    return apiData(`/messaging/inbox?limit=${limit}&space=${space}`);
}
export function fetchFocusProfile() {
    return apiData('/focus/profile');
}
export function updateFocusProfile(input) {
    return apiData('/focus/profile', {
        method: 'PATCH',
        body: JSON.stringify(input)
    });
}
export function setChatMute(targetType, targetId, muted) {
    if (muted) {
        return apiData('/messaging/mutes', {
            method: 'POST',
            body: JSON.stringify({ targetType, targetId })
        });
    }
    return apiData(`/messaging/mutes/${targetType}/${targetId}`, { method: 'DELETE' });
}
export function pinInboxItem(spaceType, spaceId) {
    return apiData('/messaging/pins', {
        method: 'POST',
        body: JSON.stringify({ spaceType, spaceId })
    });
}
export function unpinInboxItem(spaceType, spaceId) {
    return apiData(`/messaging/pins/${spaceType}/${spaceId}`, { method: 'DELETE' });
}
export function fetchCallHistory(filter = 'all') {
    return apiData(`/calls/history?filter=${filter}`);
}
export function fetchFocusContacts(q) {
    const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    return apiData(`/contacts/suggested${qs}`);
}
export function matchPhoneContacts(hashes) {
    return apiData('/contacts/match', {
        method: 'POST',
        body: JSON.stringify({ hashes })
    });
}
export function markGroupRead(groupId) {
    return apiData(`/groups/${groupId}/read`, { method: 'POST', body: '{}' });
}
export function markChannelRead(channelId) {
    return apiData(`/channels/${channelId}/read`, { method: 'POST', body: '{}' });
}
