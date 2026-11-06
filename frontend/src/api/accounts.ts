import { apiData, resolveApiBaseUrl } from '@/api/http';

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return apiData<T>(path, init);
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(json?.message ? String(json.message) : text.slice(0, 200) || 'Request failed');
  }
  return (json?.data ?? json) as T;
}

export function fetchBusinessCategories() {
  return publicRequest<any[]>('/business/categories');
}

export function fetchMyBusiness() {
  return authRequest<any>('/business/me');
}

export function switchToBusiness(body: {
  categoryKey: string;
  businessName?: string;
  subcategoryKey?: string;
  description?: string;
}) {
  return authRequest('/business/switch', { method: 'POST', body: JSON.stringify(body) });
}

export function switchToPersonal() {
  return authRequest('/business/switch-personal', { method: 'POST', body: JSON.stringify({}) });
}

export function fetchBusinessInsights() {
  return authRequest<any>('/business/insights');
}

export function updateBusiness(body: Record<string, unknown>) {
  return authRequest('/business/me', { method: 'PATCH', body: JSON.stringify(body) });
}

export function fetchStoreCatalog(idOrUsername: string) {
  return authRequest<any>(`/store/${encodeURIComponent(idOrUsername)}/catalog`);
}

export function upsertStoreProduct(body: {
  postId: string;
  priceIqd: number;
  title?: string;
  active?: boolean;
  inStock?: boolean;
  deliveryFeeIqd?: number | null;
  sortOrder?: number;
}) {
  return authRequest('/store/products', { method: 'POST', body: JSON.stringify(body) });
}

export function patchStoreProduct(
  id: string,
  body: {
    title?: string;
    priceIqd?: number;
    active?: boolean;
    inStock?: boolean;
    deliveryFeeIqd?: number | null;
    sortOrder?: number;
  }
) {
  return authRequest(`/store/products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}

export function fetchMyStoreCatalog() {
  return authRequest<any>('/store/owner/catalog');
}

export function deleteStoreProduct(id: string) {
  return authRequest(`/store/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function checkUsernameAvailable(u: string) {
  return authRequest<{ available: boolean; reason: string; username: string }>(
    `/users/username-available?u=${encodeURIComponent(u)}`
  );
}

export function fetchStoreOrders() {
  return authRequest<any[]>('/store/orders');
}

export function placeStoreOrder(
  idOrUsername: string,
  body: {
    customerName: string;
    phone: string;
    countryCode?: string;
    governorate: string;
    area: string;
    landmark?: string;
    items: Array<{ productId: string; quantity: number }>;
  }
) {
  return authRequest(`/store/${encodeURIComponent(idOrUsername)}/orders`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function fetchBusinessLocation(idOrUsername: string) {
  return authRequest<{
    mapsUrl: string;
    businessName: string;
    addressText?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }>(`/users/${encodeURIComponent(idOrUsername)}/business/location`);
}

export function fetchVerificationStatus() {
  return authRequest<any>('/verification/me');
}

export function submitVerification(body: Record<string, unknown>) {
  return authRequest('/verification/submit', { method: 'POST', body: JSON.stringify(body) });
}

export function adminListVerifications(status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return authRequest<any[]>(`/admin/verification${q}`);
}

export function adminGetVerification(id: string) {
  return authRequest<any>(`/admin/verification/${encodeURIComponent(id)}`);
}

export function adminReviewVerification(
  id: string,
  body: { status: 'approved' | 'rejected' | 'more_info_required'; adminNote?: string }
) {
  return authRequest(`/admin/verification/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function fetchOtpProviderStatus() {
  return publicRequest<{
    mode: string;
    smsConfigured: boolean;
    whatsappConfigured: boolean;
    note: string;
  }>('/auth/otp/provider-status');
}

export function fetchHighlights(idOrUsername: string) {
  return authRequest<any[]>(`/users/${encodeURIComponent(idOrUsername)}/highlights`);
}

export function fetchHighlight(id: string) {
  return authRequest<any>(`/highlights/${id}`);
}

export function createHighlight(body: { title: string; coverMediaId?: string; storyIds?: string[] }) {
  return authRequest('/highlights', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteHighlight(id: string) {
  return authRequest(`/highlights/${id}`, { method: 'DELETE' });
}

export function addHighlightStories(id: string, storyIds: string[]) {
  return authRequest(`/highlights/${id}/stories`, {
    method: 'POST',
    body: JSON.stringify({ storyIds })
  });
}

export function fetchCloseFriends() {
  return authRequest<any[]>('/close-friends');
}

export function fetchCloseFriendCandidates() {
  return authRequest<any[]>('/close-friends/candidates');
}

export function addCloseFriend(friendId: string) {
  return authRequest(`/close-friends/${friendId}`, { method: 'POST' });
}

export function removeCloseFriend(friendId: string) {
  return authRequest(`/close-friends/${friendId}`, { method: 'DELETE' });
}

export function fetchAccount() {
  return authRequest<any>('/account');
}

export function setAccountCountry(countryCode: string) {
  return authRequest('/account/country', {
    method: 'PATCH',
    body: JSON.stringify({ countryCode })
  });
}

export function setInterests(keys: string[]) {
  return authRequest('/account/interests', { method: 'POST', body: JSON.stringify({ keys }) });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return authRequest('/account/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export function requestEmail2faOtp() {
  return authRequest<any>('/account/2fa/email/request', { method: 'POST', body: '{}' });
}

export function setEmail2fa(enabled: boolean, code?: string) {
  return authRequest('/account/2fa/email', {
    method: 'POST',
    body: JSON.stringify({ enabled, code })
  });
}

export function requestLinkEmail(email: string) {
  return authRequest<any>('/account/email/request', {
    method: 'POST',
    body: JSON.stringify({ email })
  });
}

export function confirmLinkEmail(email: string, code: string) {
  return authRequest('/account/email/confirm', {
    method: 'POST',
    body: JSON.stringify({ email, code })
  });
}

export function revokeSession(id: string) {
  return authRequest(`/account/sessions/${id}`, { method: 'DELETE' });
}

export function fetchTotpStatus() {
  return authRequest<{ totpEnabled: boolean }>('/auth/mfa/totp/status');
}

export function beginTotpSetup(password: string) {
  return authRequest<{ secretBase32: string; otpauthUrl: string; qrDataUrl: string }>(
    '/auth/mfa/totp/begin',
    { method: 'POST', body: JSON.stringify({ password }) }
  );
}

export function confirmTotpSetup(code: string) {
  return authRequest<{ enabled: boolean; recoveryCodes: string[] }>('/auth/mfa/totp/confirm', {
    method: 'POST',
    body: JSON.stringify({ code })
  });
}

export function disableTotp(password: string, code: string) {
  return authRequest<{ enabled: boolean }>('/auth/mfa/totp/disable', {
    method: 'POST',
    body: JSON.stringify({ password, code })
  });
}

export function fetchBlockedUsers() {
  return authRequest<any[]>('/account/blocked');
}

export function requestPhoneOtp(body: {
  phone: string;
  dialPrefix?: string;
  purpose: 'register' | 'login' | 'link';
  channel?: 'sms' | 'whatsapp';
}) {
  return publicRequest<any>('/auth/phone/otp', { method: 'POST', body: JSON.stringify(body) });
}

export function verifyPhoneAuth(body: Record<string, unknown>) {
  return publicRequest<any>('/auth/phone/verify', { method: 'POST', body: JSON.stringify(body) });
}

export function requestPhoneEmail2fa(input: {
  userId: string;
  phoneChallengeId: string;
  phone: string;
  dialPrefix?: string;
  purpose: 'register' | 'login';
  code: string;
}) {
  return publicRequest<any>('/auth/phone/2fa/email', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function fetchUserReels(idOrUsername: string) {
  return authRequest<any[]>(`/reels/user/${encodeURIComponent(idOrUsername)}`);
}
