import { apiData, resolveApiBaseUrl } from '@/api/http';
async function authRequest(path, init) {
    return apiData(path, init);
}
async function publicRequest(path, init) {
    const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers || {})
        }
    });
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    }
    catch {
        json = null;
    }
    if (!response.ok) {
        throw new Error(json?.message ? String(json.message) : text.slice(0, 200) || 'Request failed');
    }
    return (json?.data ?? json);
}
export function fetchBusinessCategories() {
    return publicRequest('/business/categories');
}
export function fetchMyBusiness() {
    return authRequest('/business/me');
}
export function switchToBusiness(body) {
    return authRequest('/business/switch', { method: 'POST', body: JSON.stringify(body) });
}
export function switchToPersonal() {
    return authRequest('/business/switch-personal', { method: 'POST', body: JSON.stringify({}) });
}
export function fetchBusinessInsights() {
    return authRequest('/business/insights');
}
export function updateBusiness(body) {
    return authRequest('/business/me', { method: 'PATCH', body: JSON.stringify(body) });
}
export function fetchStoreCatalog(idOrUsername) {
    return authRequest(`/store/${encodeURIComponent(idOrUsername)}/catalog`);
}
export function upsertStoreProduct(body) {
    return authRequest('/store/products', { method: 'POST', body: JSON.stringify(body) });
}
export function patchStoreProduct(id, body) {
    return authRequest(`/store/products/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
    });
}
export function fetchMyStoreCatalog() {
    return authRequest('/store/owner/catalog');
}
export function deleteStoreProduct(id) {
    return authRequest(`/store/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function checkUsernameAvailable(u) {
    return authRequest(`/users/username-available?u=${encodeURIComponent(u)}`);
}
export function fetchStoreOrders() {
    return authRequest('/store/orders');
}
export function placeStoreOrder(idOrUsername, body) {
    return authRequest(`/store/${encodeURIComponent(idOrUsername)}/orders`, {
        method: 'POST',
        body: JSON.stringify(body)
    });
}
export function fetchBusinessLocation(idOrUsername) {
    return authRequest(`/users/${encodeURIComponent(idOrUsername)}/business/location`);
}
export function fetchVerificationStatus() {
    return authRequest('/verification/me');
}
export function submitVerification(body) {
    return authRequest('/verification/submit', { method: 'POST', body: JSON.stringify(body) });
}
export function adminListVerifications(status) {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return authRequest(`/admin/verification${q}`);
}
export function adminGetVerification(id) {
    return authRequest(`/admin/verification/${encodeURIComponent(id)}`);
}
export function adminReviewVerification(id, body) {
    return authRequest(`/admin/verification/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        body: JSON.stringify(body)
    });
}
export function fetchOtpProviderStatus() {
    return publicRequest('/auth/otp/provider-status');
}
export function fetchHighlights(idOrUsername) {
    return authRequest(`/users/${encodeURIComponent(idOrUsername)}/highlights`);
}
export function fetchHighlight(id) {
    return authRequest(`/highlights/${id}`);
}
export function createHighlight(body) {
    return authRequest('/highlights', { method: 'POST', body: JSON.stringify(body) });
}
export function deleteHighlight(id) {
    return authRequest(`/highlights/${id}`, { method: 'DELETE' });
}
export function addHighlightStories(id, storyIds) {
    return authRequest(`/highlights/${id}/stories`, {
        method: 'POST',
        body: JSON.stringify({ storyIds })
    });
}
export function fetchCloseFriends() {
    return authRequest('/close-friends');
}
export function fetchCloseFriendCandidates() {
    return authRequest('/close-friends/candidates');
}
export function addCloseFriend(friendId) {
    return authRequest(`/close-friends/${friendId}`, { method: 'POST' });
}
export function removeCloseFriend(friendId) {
    return authRequest(`/close-friends/${friendId}`, { method: 'DELETE' });
}
export function fetchAccount() {
    return authRequest('/account');
}
export function setAccountCountry(countryCode) {
    return authRequest('/account/country', {
        method: 'PATCH',
        body: JSON.stringify({ countryCode })
    });
}
export function setInterests(keys) {
    return authRequest('/account/interests', { method: 'POST', body: JSON.stringify({ keys }) });
}
export function changePassword(currentPassword, newPassword) {
    return authRequest('/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
    });
}
export function requestEmail2faOtp() {
    return authRequest('/account/2fa/email/request', { method: 'POST', body: '{}' });
}
export function setEmail2fa(enabled, code) {
    return authRequest('/account/2fa/email', {
        method: 'POST',
        body: JSON.stringify({ enabled, code })
    });
}
export function requestLinkEmail(email) {
    return authRequest('/account/email/request', {
        method: 'POST',
        body: JSON.stringify({ email })
    });
}
export function confirmLinkEmail(email, code) {
    return authRequest('/account/email/confirm', {
        method: 'POST',
        body: JSON.stringify({ email, code })
    });
}
export function revokeSession(id) {
    return authRequest(`/account/sessions/${id}`, { method: 'DELETE' });
}
export function fetchBlockedUsers() {
    return authRequest('/account/blocked');
}
export function requestPhoneOtp(body) {
    return publicRequest('/auth/phone/otp', { method: 'POST', body: JSON.stringify(body) });
}
export function verifyPhoneAuth(body) {
    return publicRequest('/auth/phone/verify', { method: 'POST', body: JSON.stringify(body) });
}
export function requestPhoneEmail2fa(input) {
    return publicRequest('/auth/phone/2fa/email', {
        method: 'POST',
        body: JSON.stringify(input)
    });
}
export function fetchUserReels(idOrUsername) {
    return authRequest(`/reels/user/${encodeURIComponent(idOrUsername)}`);
}
