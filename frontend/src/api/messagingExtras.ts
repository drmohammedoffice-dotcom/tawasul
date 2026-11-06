import { apiData } from '@/api/http';

export function fetchMessagingPins() {
  return apiData<any[]>('/messaging/pins');
}

export function pinSpace(spaceType: 'dm' | 'group' | 'channel', spaceId: string) {
  return apiData('/messaging/pins', {
    method: 'POST',
    body: JSON.stringify({ spaceType, spaceId })
  });
}

export function unpinSpace(spaceType: 'dm' | 'group' | 'channel', spaceId: string) {
  return apiData(`/messaging/pins/${spaceType}/${spaceId}`, { method: 'DELETE' });
}

export function fetchIceServers() {
  return apiData<{
    iceServers: RTCIceServer[];
    turnConfigured: boolean;
    maxMeshParticipants: number;
    note?: string;
  }>('/calls/ice-servers');
}

export function startDmCallRest(peerUserId: string, kind: 'audio' | 'video') {
  return apiData<any>('/calls/dm', {
    method: 'POST',
    body: JSON.stringify({ peerUserId, kind })
  });
}
