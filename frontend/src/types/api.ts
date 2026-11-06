export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T;
};

export type AuthUser = {
  id: string;
  username: string;
  email: string | null;
  role?: 'free' | 'premium';
};

export type AuthPayload = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  requiresMfa?: false;
};

export type AuthMfaChallenge = {
  requiresMfa: true;
  mfaToken: string;
};

export type AuthLoginResult = AuthPayload | AuthMfaChallenge;

export type MessageMediaAttachment = {
  mediaId: string;
  mimeType: string;
  mediaType: string;
  purpose: string;
  durationSeconds: number | null;
  originalFileName: string;
};

export type PrivateMessage = {
  id: string;
  senderId: string;
  receiverId: string;
  encryptedContent: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  editedAt: string | null;
  deletedAt: string | null;
  isDeleted: boolean;
  replyToMessageId?: string | null;
  forwardFromId?: string | null;
  mediaAttachments?: MessageMediaAttachment[];
};

export type SmartReplyResult = {
  suggestions: string[];
  provider: string;
};
