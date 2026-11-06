import { apiData } from '@/api/http';
export function fetchMessagingPins() {
    return apiData('/messaging/pins');
}
export function pinSpace(spaceType, spaceId) {
    return apiData('/messaging/pins', {
        method: 'POST',
        body: JSON.stringify({ spaceType, spaceId })
    });
}
export function unpinSpace(spaceType, spaceId) {
    return apiData(`/messaging/pins/${spaceType}/${spaceId}`, { method: 'DELETE' });
}
export function fetchIceServers() {
    return apiData('/calls/ice-servers');
}
export function startDmCallRest(peerUserId, kind) {
    return apiData('/calls/dm', {
        method: 'POST',
        body: JSON.stringify({ peerUserId, kind })
    });
}
