export interface ChatMessage {
  id: string;
  chatId: string;
  encryptedPayload: string;
  sentAt: string;
}

export interface PresenceEvent {
  userId: string;
  status: 'online' | 'offline';
  updatedAt: string;
}
