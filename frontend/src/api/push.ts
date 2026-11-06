import { apiData } from '@/api/http';
import type { FocusNotifPrefs } from '@/app/focus/focusPrefs';

export type PushPlatform = 'android' | 'ios' | 'web';

export type PushPrefsResponse = {
  saved: boolean;
  privateChats: boolean;
  groups: boolean;
  channels: boolean;
  stories: boolean;
  reactions: boolean;
  newContacts: boolean;
  social: boolean;
  calls: boolean;
  inAppPreview: boolean;
  namesOnLockScreen: boolean;
};

export type PushServerStatus = {
  enabled: boolean;
  projectId: string | null;
};

export function registerPushDevice(token: string, platform: PushPlatform) {
  return apiData<{ id: string; platform: string }>('/notifications/devices', {
    method: 'POST',
    body: JSON.stringify({ token, platform })
  });
}

export function removePushDevice(token: string) {
  return apiData('/notifications/devices', {
    method: 'DELETE',
    body: JSON.stringify({ token })
  });
}

export function fetchPushPrefs() {
  return apiData<PushPrefsResponse>('/notifications/preferences');
}

export function savePushPrefs(prefs: FocusNotifPrefs) {
  return apiData<PushPrefsResponse>('/notifications/preferences', {
    method: 'PUT',
    body: JSON.stringify({
      privateChats: prefs.privateChats,
      groups: prefs.groups,
      channels: prefs.channels,
      stories: prefs.stories,
      reactions: prefs.reactions,
      newContacts: prefs.newContacts,
      inAppPreview: prefs.inAppPreview,
      namesOnLockScreen: prefs.namesOnLockScreen
    })
  });
}

export function fetchPushStatus() {
  return apiData<PushServerStatus>('/notifications/push-status');
}
