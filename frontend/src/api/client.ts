import { apiData, apiRequest } from '@/api/http';
import type {
  AuthLoginResult,
  AuthPayload,
  AuthUser,
  PrivateMessage,
  SmartReplyResult
} from '@/types/api';

type LoginInput = {
  identifier: string;
  password: string;
  deviceId: string;
  totpCode?: string;
};

type RegisterInput = {
  username: string;
  password: string;
  deviceId: string;
};

export async function register(input: RegisterInput): Promise<AuthPayload> {
  return apiData<AuthPayload>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
    public: true
  });
}

export async function login(input: LoginInput): Promise<AuthLoginResult> {
  return apiData<AuthLoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
    public: true
  });
}

export async function verifyMfaLogin(input: {
  mfaToken: string;
  code: string;
  deviceId: string;
}): Promise<AuthPayload> {
  return apiData<AuthPayload>('/auth/mfa/verify', {
    method: 'POST',
    body: JSON.stringify(input),
    public: true
  });
}

export async function logout(input: {
  accessToken?: string;
  refreshToken?: string;
}): Promise<void> {
  const options: Parameters<typeof apiRequest>[1] = {
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

export async function refreshSession(refreshToken: string): Promise<AuthPayload> {
  return apiData<AuthPayload>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
    public: true,
    skipAuthRetry: true
  });
}

export async function getProfile(token: string): Promise<AuthUser> {
  return apiData<AuthUser>('/users/profile', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export type ConversationSummary = {
  peer: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  lastMessage: PrivateMessage;
  unreadCount: number;
};

export async function listConversations(
  token?: string,
  space: 'browse' | 'focus' = 'browse'
): Promise<ConversationSummary[]> {
  return apiData<ConversationSummary[]>(`/messages/conversations?space=${space}`, {
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {})
  });
}

export async function getConversation(
  token: string,
  peerUserId: string,
  options?: { before?: string; limit?: number; space?: 'browse' | 'focus' }
): Promise<PrivateMessage[]> {
  const query = new URLSearchParams();
  if (options?.before) query.set('before', options.before);
  if (options?.limit) query.set('limit', String(options.limit));
  query.set('space', options?.space === 'focus' ? 'focus' : 'browse');
  const suffix = `?${query.toString()}`;

  return apiData<PrivateMessage[]>(`/messages/private/${peerUserId}${suffix}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function getSmartReplies(
  token: string,
  input: { latestMessage: string; recentMessages: string[]; maxSuggestions?: number }
): Promise<SmartReplyResult> {
  return apiData<SmartReplyResult>('/ai/smart-replies', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input)
  });
}

export async function trackBetaEvent(input: {
  eventName: string;
  path: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await apiData<{ accepted: boolean }>('/beta/analytics', {
    method: 'POST',
    body: JSON.stringify(input),
    public: true
  });
}

export async function submitFeedback(
  token: string | null,
  input: {
    email?: string;
    category: string;
    message: string;
    rating?: number;
  }
): Promise<void> {
  const path = token ? '/beta/feedback' : '/beta/feedback/public';
  await apiRequest(path, {
    method: 'POST',
    ...(token ? {} : { public: true }),
    body: JSON.stringify(input)
  });
}
