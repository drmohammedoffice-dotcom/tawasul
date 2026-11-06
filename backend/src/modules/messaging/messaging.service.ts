import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AppSpace, Message, MessageReaction, MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { CacheService } from '../cache/cache.service';
import { AppConfigService } from '../config/app-config.service';
import { EngagementService } from '../engagement/engagement.service';
import { SendPrivateMessageDto } from './dto/send-private-message.dto';
import { MessageEntity, MessageReactionEntity } from './entities/message.entity';
import { EditMessageDto } from './dto/edit-message.dto';
import { messagePreview } from '../push/message-preview';
import { PushService } from '../push/push.service';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly cacheService: CacheService,
    private readonly config: AppConfigService,
    private readonly engagementService: EngagementService,
    private readonly push: PushService
  ) {}

  async createPrivateMessage(
    senderId: string,
    dto: SendPrivateMessageDto,
    options?: { receiverOnline?: boolean }
  ): Promise<MessageEntity> {
    const spam = await this.aiService.detectSpam({
      text: dto.encryptedContent,
      senderId,
      context: 'private'
    });
    if (spam.isSpam) {
      throw new BadRequestException(`message flagged as spam: ${spam.reasons.join(', ')}`);
    }

    await this.assertUserExists(dto.receiverId);
    await this.assertNotBlocked(senderId, dto.receiverId);
    if (dto.replyToMessageId) {
      await this.assertMessageInConversation(senderId, dto.receiverId, dto.replyToMessageId);
    }

    let mediaIds = [...new Set((dto.mediaIds || []).filter(Boolean))].slice(0, 30);
    let forwardMediaCopied = false;
    if (dto.forwardFromMessageId) {
      const src = await this.prisma.message.findUnique({
        where: { id: dto.forwardFromMessageId },
        include: { mediaAttachments: true }
      });
      if (!src) {
        throw new NotFoundException('forward source message not found');
      }
      const inThread =
        (src.senderId === senderId && src.receiverId === dto.receiverId) ||
        (src.senderId === dto.receiverId && src.receiverId === senderId) ||
        src.senderId === senderId ||
        src.receiverId === senderId;
      if (!inThread) {
        throw new ForbiddenException('not authorized for this message');
      }
      if (!mediaIds.length && src.mediaAttachments.length) {
        mediaIds = src.mediaAttachments.map((a) => a.mediaId).slice(0, 30);
        forwardMediaCopied = true;
      }
    }

    if (mediaIds.length && !forwardMediaCopied) {
      await this.assertOwnedReadyMedia(senderId, mediaIds);
    }

    const appSpace = dto.appSpace === 'focus' ? AppSpace.focus : AppSpace.browse;

    const created = await this.prisma.message.create({
      data: {
        senderId,
        receiverId: dto.receiverId,
        encryptedContent: dto.encryptedContent,
        appSpace,
        status: options?.receiverOnline ? MessageStatus.delivered : MessageStatus.sent,
        deliveredAt: options?.receiverOnline ? new Date() : null,
        replyToMessageId: dto.replyToMessageId ?? null,
        forwardFromId: dto.forwardFromMessageId ?? null,
        ...(mediaIds.length
          ? {
              mediaAttachments: {
                create: mediaIds.map((mediaId) => ({ mediaId }))
              }
            }
          : {})
      },
      include: {
        reactions: true,
        mediaAttachments: { include: { media: true } }
      }
    });
    await this.invalidateConversationCache(senderId, dto.receiverId);
    try {
      await this.engagementService.recordMessageSent(senderId);
    } catch {
      // Engagement rewards are best-effort and must not block messaging.
    }
    void this.pushPrivateMessage(senderId, dto.receiverId, created.id, dto.encryptedContent, appSpace, mediaIds.length > 0);
    return this.toEntity(created);
  }

  async listConversations(
    currentUserId: string,
    limit = 40,
    appSpace: 'browse' | 'focus' = 'browse'
  ) {
    const take = Math.min(Math.max(limit, 1), 100);
    const space = appSpace === 'focus' ? AppSpace.focus : AppSpace.browse;
    const recent = await this.prisma.message.findMany({
      where: {
        appSpace: space,
        OR: [{ senderId: currentUserId }, { receiverId: currentUserId }]
      },
      orderBy: { timestamp: 'desc' },
      take: 400,
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        receiver: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      }
    });

    const byPeer = new Map<
      string,
      {
        peer: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
        lastMessage: MessageEntity;
        unreadCount: number;
      }
    >();

    for (const row of recent) {
      const peerUser = row.senderId === currentUserId ? row.receiver : row.sender;
      if (!peerUser || byPeer.has(peerUser.id)) continue;
      byPeer.set(peerUser.id, {
        peer: {
          id: peerUser.id,
          username: peerUser.username,
          displayName: peerUser.displayName,
          avatarUrl: peerUser.avatarUrl
        },
        lastMessage: this.toEntity(row),
        unreadCount: 0
      });
      if (byPeer.size >= take) break;
    }

    const peerIds = [...byPeer.keys()];
    if (peerIds.length) {
      const unread = await this.prisma.message.groupBy({
        by: ['senderId'],
        where: {
          appSpace: space,
          receiverId: currentUserId,
          senderId: { in: peerIds },
          status: { not: MessageStatus.read },
          isDeleted: false
        },
        _count: { _all: true }
      });
      for (const row of unread) {
        const entry = byPeer.get(row.senderId);
        if (entry) entry.unreadCount = row._count._all;
      }

      // Focus Mode shows FocusProfile names/avatars — never Browse profile edits.
      if (space === AppSpace.focus) {
        const focusProfiles = await this.prisma.focusProfile.findMany({
          where: { userId: { in: peerIds } }
        });
        for (const fp of focusProfiles) {
          const entry = byPeer.get(fp.userId);
          if (!entry) continue;
          if (fp.displayName) entry.peer.displayName = fp.displayName;
          if (fp.avatarUrl) entry.peer.avatarUrl = fp.avatarUrl;
        }
      }
    }

    return [...byPeer.values()];
  }

  async listPrivateConversation(
    currentUserId: string,
    peerUserId: string,
    opts?: { before?: string; limit?: number; appSpace?: 'browse' | 'focus' }
  ): Promise<MessageEntity[]> {
    // Opening an empty thread must not 403 — block is enforced on send only.
    if (currentUserId === peerUserId) {
      throw new BadRequestException('cannot message yourself');
    }
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: currentUserId, blockedId: peerUserId },
          { blockerId: peerUserId, blockedId: currentUserId }
        ]
      },
      select: { id: true }
    });
    if (blocked) {
      return [];
    }
    const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);
    const before = opts?.before ? new Date(opts.before) : null;
    const space = opts?.appSpace === 'focus' ? AppSpace.focus : AppSpace.browse;
    const cacheKey = this.conversationCacheKey(
      currentUserId,
      peerUserId,
      before?.toISOString(),
      limit,
      space
    );
    const cached = await this.cacheService.getJson<MessageEntity[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const items = await this.prisma.message.findMany({
      where: {
        appSpace: space,
        OR: [
          { senderId: currentUserId, receiverId: peerUserId },
          { senderId: peerUserId, receiverId: currentUserId }
        ],
        ...(before ? { timestamp: { lt: before } } : {})
      },
      include: {
        reactions: true,
        mediaAttachments: { include: { media: true } }
      },
      orderBy: { timestamp: 'desc' },
      take: limit
    });
    const mapped = items.map((item) => this.toEntity(item)).reverse();
    await this.cacheService.setJson(cacheKey, mapped, this.config.cacheDefaultTtlSeconds);
    return mapped;
  }

  async getMessageById(messageId: string): Promise<MessageEntity> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        reactions: true,
        mediaAttachments: { include: { media: true } }
      }
    });
    if (!message) {
      throw new NotFoundException('message not found');
    }
    return this.toEntity(message);
  }

  async editMessage(senderId: string, dto: EditMessageDto): Promise<MessageEntity> {
    const message = await this.prisma.message.findUnique({
      where: { id: dto.messageId },
      include: { reactions: true }
    });
    if (!message) {
      throw new NotFoundException('message not found');
    }
    if (message.senderId !== senderId) {
      throw new ForbiddenException('only sender can edit message');
    }
    if (message.isDeleted) {
      throw new BadRequestException('deleted messages cannot be edited');
    }

    const updated = await this.prisma.message.update({
      where: { id: dto.messageId },
      data: {
        encryptedContent: dto.encryptedContent,
        editedAt: new Date()
      },
      include: { reactions: true }
    });
    await this.invalidateConversationCache(updated.senderId, updated.receiverId);
    return this.toEntity(updated);
  }

  async deleteMessage(senderId: string, messageId: string): Promise<MessageEntity> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { reactions: true }
    });
    if (!message) {
      throw new NotFoundException('message not found');
    }
    if (message.senderId !== senderId) {
      throw new ForbiddenException('only sender can delete message');
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        encryptedContent: '',
        isDeleted: true,
        deletedAt: new Date()
      },
      include: { reactions: true }
    });
    await this.invalidateConversationCache(updated.senderId, updated.receiverId);
    return this.toEntity(updated);
  }

  async addOrToggleReaction(
    userId: string,
    messageId: string,
    emoji: string
  ): Promise<{ action: 'added' | 'removed'; reaction: MessageReactionEntity }> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
      throw new NotFoundException('message not found');
    }
    if (message.senderId !== userId && message.receiverId !== userId) {
      throw new ForbiddenException('not authorized for this message');
    }

    const existing = await this.prisma.messageReaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji
        }
      }
    });

    if (existing) {
      await this.prisma.messageReaction.delete({ where: { id: existing.id } });
      await this.invalidateConversationCache(message.senderId, message.receiverId);
      return { action: 'removed', reaction: this.toReactionEntity(existing) };
    }

    const created = await this.prisma.messageReaction.create({
      data: { messageId, userId, emoji }
    });
    await this.invalidateConversationCache(message.senderId, message.receiverId);
    const recipientId = userId === message.senderId ? message.receiverId : message.senderId;
    void this.pushReaction(userId, recipientId, message, emoji);
    return { action: 'added', reaction: this.toReactionEntity(created) };
  }

  async updateStatus(
    messageId: string,
    userId: string,
    status: 'delivered' | 'read'
  ): Promise<MessageEntity> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { reactions: true }
    });
    if (!message) {
      throw new NotFoundException('message not found');
    }
    if (message.receiverId !== userId) {
      throw new ForbiddenException('only receiver can update message status');
    }

    const nextStatus =
      status === 'read' || message.status === MessageStatus.read
        ? MessageStatus.read
        : MessageStatus.delivered;

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        status: nextStatus,
        deliveredAt: new Date(),
        readAt: nextStatus === MessageStatus.read ? new Date() : null
      },
      include: { reactions: true }
    });
    await this.invalidateConversationCache(updated.senderId, updated.receiverId);
    return this.toEntity(updated);
  }

  private async pushPrivateMessage(
    senderId: string,
    receiverId: string,
    messageId: string,
    content: string,
    appSpace: AppSpace,
    hasMedia: boolean
  ) {
    try {
      const sender = await this.prisma.user.findUnique({
        where: { id: senderId },
        select: { displayName: true, username: true }
      });
      const senderName = sender?.displayName?.trim() || sender?.username || 'رسالة جديدة';
      const focus = appSpace === AppSpace.focus;
      void this.push.dispatch({
        userIds: [receiverId],
        category: 'privateChats',
        title: senderName,
        body: messagePreview(content, hasMedia),
        sensitive: true,
        mute: { targetType: 'dm', targetId: senderId },
        data: {
          kind: 'dm',
          peerId: senderId,
          messageId,
          appSpace: focus ? 'focus' : 'browse',
          route: focus ? `/focus/chats/dm/${senderId}` : '/messages',
          tag: `dm-${senderId}`
        }
      });
    } catch {
      /* push must not break sending */
    }
  }

  private async pushReaction(
    actorId: string,
    recipientId: string,
    message: { id: string; appSpace: AppSpace },
    emoji: string
  ) {
    try {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId },
        select: { displayName: true, username: true }
      });
      const name = actor?.displayName?.trim() || actor?.username || 'تفاعل';
      const focus = message.appSpace === AppSpace.focus;
      void this.push.dispatch({
        userIds: [recipientId],
        category: 'reactions',
        title: name,
        body: `تفاعل ${emoji}`,
        sensitive: false,
        mute: { targetType: 'dm', targetId: actorId },
        data: {
          kind: 'reaction',
          peerId: actorId,
          messageId: message.id,
          appSpace: focus ? 'focus' : 'browse',
          route: focus ? `/focus/chats/dm/${actorId}` : '/messages',
          tag: `react-${message.id}`
        }
      });
    } catch {
      /* push must not break reactions */
    }
  }

  private toEntity(
    message: Message & {
      reactions?: MessageReaction[];
      mediaAttachments?: Array<{
        mediaId: string;
        media?: {
          mimeType: string;
          mediaType: string;
          purpose: string;
          durationSeconds: number | null;
          originalFileName: string;
          deletedAt: Date | null;
        };
      }>;
    }
  ): MessageEntity {
    return {
      id: message.id,
      senderId: message.senderId,
      receiverId: message.receiverId,
      encryptedContent: message.encryptedContent,
      appSpace: message.appSpace === AppSpace.focus ? 'focus' : 'browse',
      timestamp: message.timestamp,
      status: message.status,
      replyToMessageId: message.replyToMessageId,
      forwardFromId: message.forwardFromId,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
      isDeleted: message.isDeleted,
      reactions: (message.reactions ?? []).map((item) => this.toReactionEntity(item)),
      mediaAttachments: (message.mediaAttachments ?? [])
        .filter((row) => row.media && !row.media.deletedAt)
        .map((row) => ({
          mediaId: row.mediaId,
          mimeType: row.media!.mimeType,
          mediaType: row.media!.mediaType,
          purpose: row.media!.purpose,
          durationSeconds: row.media!.durationSeconds,
          originalFileName: row.media!.originalFileName
        }))
    };
  }

  private async assertOwnedReadyMedia(userId: string, mediaIds: string[]) {
    const rows = await this.prisma.mediaAsset.findMany({
      where: {
        id: { in: mediaIds },
        uploaderId: userId,
        deletedAt: null,
        uploadCompletedAt: { not: null }
      }
    });
    if (rows.length !== mediaIds.length) {
      throw new BadRequestException('invalid or incomplete media attachment');
    }
  }

  private toReactionEntity(reaction: MessageReaction): MessageReactionEntity {
    return {
      id: reaction.id,
      messageId: reaction.messageId,
      userId: reaction.userId,
      emoji: reaction.emoji,
      createdAt: reaction.createdAt
    };
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('receiver not found');
    }
  }

  private async assertNotBlocked(userA: string, userB: string): Promise<void> {
    if (userA === userB) {
      throw new BadRequestException('cannot message yourself');
    }
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userA, blockedId: userB },
          { blockerId: userB, blockedId: userA }
        ]
      }
    });
    if (blocked) {
      throw new ForbiddenException('messaging not allowed between these users');
    }
  }

  private async assertMessageExists(messageId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
      throw new NotFoundException('forward source message not found');
    }
  }

  private async assertMessageInConversation(
    senderId: string,
    receiverId: string,
    messageId: string
  ): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
      throw new NotFoundException('replied message not found');
    }
    const sameConversation =
      (message.senderId === senderId && message.receiverId === receiverId) ||
      (message.senderId === receiverId && message.receiverId === senderId);
    if (!sameConversation) {
      throw new BadRequestException('reply target must be in same conversation');
    }
  }

  private conversationCacheKey(
    userA: string,
    userB: string,
    beforeIso: string | undefined,
    limit: number,
    appSpace: AppSpace = AppSpace.browse
  ): string {
    const [a, b] = [userA, userB].sort();
    return `cache:conversation:${appSpace}:${a}:${b}:before:${beforeIso ?? 'none'}:limit:${limit}`;
  }

  private async invalidateConversationCache(userA: string, userB: string): Promise<void> {
    const [a, b] = [userA, userB].sort();
    await this.cacheService.delByPrefix(`cache:conversation:browse:${a}:${b}:`);
    await this.cacheService.delByPrefix(`cache:conversation:focus:${a}:${b}:`);
  }
}
