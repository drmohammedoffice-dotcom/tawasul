import { apiData } from '@/api/http';

export type InboxItemType = 'dm' | 'group' | 'channel';

export type UnifiedInboxItem = {
  type: InboxItemType;
  id: string;
  title: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
  username?: string | null;
  lastMessage: string | null;
  lastAt: string | null;
  unreadCount: number;
  muted: boolean;
  pinned: boolean;
  pinSortOrder?: number | null;
};

export type CallHistoryItem = {
  id: string;
  kind: 'audio' | 'video';
  scope: 'dm' | 'group' | 'channel';
  status: string;
  createdAt: string;
  endedAt?: string | null;
  missed: boolean;
  peer?: {
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
  spaceName?: string | null;
  direction: 'outgoing' | 'incoming';
};

export type FocusContact = {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  online?: boolean;
  lastSeenAt?: string | null;
  source: 'following' | 'follower' | 'peer' | 'phone' | 'search';
  onSecureChat?: boolean;
};

export function fetchUnifiedInbox(limit = 60, space: 'focus' | 'browse' = 'focus') {
  return apiData<UnifiedInboxItem[]>(`/messaging/inbox?limit=${limit}&space=${space}`);
}

export type FocusProfile = {
  userId: string;
  displayName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  hideBrowseProfile?: boolean;
};

export function fetchFocusProfile() {
  return apiData<FocusProfile>('/focus/profile');
}

export function updateFocusProfile(input: {
  displayName?: string;
  bio?: string;
  avatarUrl?: string | null;
  hideBrowseProfile?: boolean;
}) {
  return apiData<FocusProfile>('/focus/profile', {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function setChatMute(targetType: InboxItemType, targetId: string, muted: boolean) {
  if (muted) {
    return apiData('/messaging/mutes', {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId })
    });
  }
  return apiData(`/messaging/mutes/${targetType}/${targetId}`, { method: 'DELETE' });
}

export function pinInboxItem(spaceType: 'dm' | 'group' | 'channel', spaceId: string) {
  return apiData('/messaging/pins', {
    method: 'POST',
    body: JSON.stringify({ spaceType, spaceId })
  });
}

export function unpinInboxItem(spaceType: 'dm' | 'group' | 'channel', spaceId: string) {
  return apiData(`/messaging/pins/${spaceType}/${spaceId}`, { method: 'DELETE' });
}

export function fetchCallHistory(filter: 'all' | 'missed' = 'all') {
  return apiData<CallHistoryItem[]>(`/calls/history?filter=${filter}`);
}

export function fetchFocusContacts(q?: string) {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return apiData<FocusContact[]>(`/contacts/suggested${qs}`);
}

export function matchPhoneContacts(hashes: string[]) {
  return apiData<FocusContact[]>('/contacts/match', {
    method: 'POST',
    body: JSON.stringify({ hashes })
  });
}

export function markGroupRead(groupId: string) {
  return apiData(`/groups/${groupId}/read`, { method: 'POST', body: '{}' });
}

export function markChannelRead(channelId: string) {
  return apiData(`/channels/${channelId}/read`, { method: 'POST', body: '{}' });
}
