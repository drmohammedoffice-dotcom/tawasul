export type MessageStatus = 'sent' | 'delivered' | 'read';

export class MessageReactionEntity {
  id!: string;
  messageId!: string;
  userId!: string;
  emoji!: string;
  createdAt!: Date;
}

export class MessageMediaAttachment {
  mediaId!: string;
  mimeType!: string;
  mediaType!: string;
  purpose!: string;
  durationSeconds!: number | null;
  originalFileName!: string;
}

export class MessageEntity {
  id!: string;
  senderId!: string;
  receiverId!: string;
  encryptedContent!: string;
  appSpace?: 'browse' | 'focus';
  timestamp!: Date;
  status!: MessageStatus;
  replyToMessageId!: string | null;
  forwardFromId!: string | null;
  editedAt!: Date | null;
  deletedAt!: Date | null;
  isDeleted!: boolean;
  reactions!: MessageReactionEntity[];
  mediaAttachments!: MessageMediaAttachment[];
}
