import { apiData } from '@/api/http';
export function registerPushDevice(token, platform) {
    return apiData('/notifications/devices', {
        method: 'POST',
        body: JSON.stringify({ token, platform })
    });
}
export function removePushDevice(token) {
    return apiData('/notifications/devices', {
        method: 'DELETE',
        body: JSON.stringify({ token })
    });
}
export function fetchPushPrefs() {
    return apiData('/notifications/preferences');
}
export function savePushPrefs(prefs) {
    return apiData('/notifications/preferences', {
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
    return apiData('/notifications/push-status');
}
