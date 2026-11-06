import { apiData, apiRequest } from '@/api/http';
export async function register(input) {
    return apiData('/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
        public: true
    });
}
export async function login(input) {
    return apiData('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
        public: true
    });
}
export async function logout(input) {
    const options = {
        method: 'POST',
        body: JSON.stringify({ refreshToken: input.refreshToken }),
        public: true,
        skipAuthRetry: true
    };
    if (input.accessToken) {
        options.headers = { Authorization: `Bearer ${input.accessToken}` };
    }
    await apiRequest('/auth/logout', options);
}
export async function refreshSession(refreshToken) {
    return apiData('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        public: true,
        skipAuthRetry: true
    });
}
export async function getProfile(token) {
    return apiData('/users/profile', {
        headers: { Authorization: `Bearer ${token}` }
    });
}
export async function listConversations(token, space = 'browse') {
    return apiData(`/messages/conversations?space=${space}`, {
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {})
    });
}
export async function getConversation(token, peerUserId, options) {
    const query = new URLSearchParams();
    if (options?.before)
        query.set('before', options.before);
    if (options?.limit)
        query.set('limit', String(options.limit));
    query.set('space', options?.space === 'focus' ? 'focus' : 'browse');
    const suffix = `?${query.toString()}`;
    return apiData(`/messages/private/${peerUserId}${suffix}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
}
export async function getSmartReplies(token, input) {
    return apiData('/ai/smart-replies', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(input)
    });
}
export async function trackBetaEvent(input) {
    await apiData('/beta/analytics', {
        method: 'POST',
        body: JSON.stringify(input),
        public: true
    });
}
export async function submitFeedback(token, input) {
    const path = token ? '/beta/feedback' : '/beta/feedback/public';
    await apiRequest(path, {
        method: 'POST',
        ...(token ? {} : { public: true }),
        body: JSON.stringify(input)
    });
}
