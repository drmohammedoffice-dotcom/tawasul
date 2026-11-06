export const MESSAGING_CHANNELS = {
  MESSAGE_CREATED: 'ws:message:created',
  MESSAGE_UPDATED: 'ws:message:updated',
  MESSAGE_DELETED: 'ws:message:deleted',
  MESSAGE_REACTION: 'ws:message:reaction',
  GIFT_SENT: 'ws:gift:sent',
  USER_TYPING: 'ws:user:typing',
  PRESENCE_UPDATED: 'ws:presence:updated',
  GROUP_MESSAGE_CREATED: 'ws:group:message:created',
  CHANNEL_MESSAGE_CREATED: 'ws:channel:message:created'
} as const;
