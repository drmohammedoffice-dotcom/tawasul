import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef
} from '@nestjs/common';
import { GroupRole } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { CacheService } from '../cache/cache.service';
import { AppConfigService } from '../config/app-config.service';
import { MESSAGING_CHANNELS } from '../messaging/messaging.constants';
import { MessagingPubSubService } from '../messaging/messaging-pubsub.service';
import { FeatureGateService } from '../monetization/feature-gate.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { messagePreview } from '../push/message-preview';
import { PushService } from '../push/push.service';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly cacheService: CacheService,
    private readonly config: AppConfigService,
    private readonly featureGateService: FeatureGateService,
    @Inject(forwardRef(() => MessagingPubSubService))
    private readonly pubsubService: MessagingPubSubService,
    private readonly push: PushService
  ) {}

  async listMyChannels(userId: string) {
    const subs = await this.prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        channel: {
          include: {
            _count: { select: { subscriptions: true, messages: true } },
            createdBy: { select: { id: true, username: true, displayName: true } }
          }
        }
      }
    });
    return subs.map((s) => ({
      ...s.channel,
      myRole: s.role
    }));
  }

  async getChannelForSubscriber(userId: string, channelId: string) {
    const sub = await this.getSubscription(userId, channelId);
    if (!sub) {
      throw new ForbiddenException('must be subscribed to view channel');
    }
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        createdBy: { select: { id: true, username: true, displayName: true } },
        _count: { select: { subscriptions: true, messages: true } }
      }
    });
    if (!channel) throw new NotFoundException('channel not found');
    return { ...channel, myRole: sub.role };
  }

  async createChannel(ownerId: string, dto: CreateChannelDto) {
    await this.featureGateService.assertCanCreateChannel(ownerId);
    const memberIds = [...new Set((dto.memberIds ?? []).filter((id) => id && id !== ownerId))];
    const inviteSlug = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const channel = await this.prisma.channel.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        createdById: ownerId,
        visibility: dto.visibility === 'private' ? 'private' : 'public',
        inviteSlug,
        appSpace: dto.appSpace === 'focus' ? 'focus' : 'browse',
        subscriptions: {
          create: [
            { userId: ownerId, role: GroupRole.owner },
            ...memberIds.map((userId) => ({ userId, role: GroupRole.member }))
          ]
        }
      },
      include: {
        subscriptions: true,
        _count: { select: { subscriptions: true } }
      }
    });
    return channel;
  }

  async updateChannel(
    actorId: string,
    channelId: string,
    dto: {
      name?: string;
      description?: string;
      avatarUrl?: string | null;
      visibility?: 'public' | 'private';
    }
  ) {
    await this.assertCanManage(actorId, channelId);
    return this.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl || null } : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {})
      },
      include: { _count: { select: { subscriptions: true } } }
    });
  }

  async ensureInviteSlug(actorId: string, channelId: string) {
    const channel = await this.getChannelForSubscriber(actorId, channelId);
    if (channel.inviteSlug) {
      return { inviteSlug: channel.inviteSlug, visibility: channel.visibility };
    }
    await this.assertCanManage(actorId, channelId);
    const inviteSlug = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const updated = await this.prisma.channel.update({
      where: { id: channelId },
      data: { inviteSlug }
    });
    return { inviteSlug: updated.inviteSlug!, visibility: updated.visibility };
  }

  async leaveSelf(userId: string, channelId: string) {
    const sub = await this.getSubscription(userId, channelId);
    if (!sub) throw new NotFoundException('subscription not found');
    if (sub.role === GroupRole.owner) {
      throw new ForbiddenException('owner cannot leave; transfer ownership first');
    }
    return this.prisma.subscription.delete({
      where: { channelId_userId: { channelId, userId } }
    });
  }

  async pinMessage(actorId: string, channelId: string, messageId: string | null) {
    await this.assertCanManage(actorId, channelId);
    if (messageId) {
      const msg = await this.prisma.channelMessage.findFirst({
        where: { id: messageId, channelId }
      });
      if (!msg) throw new NotFoundException('message not found');
    }
    return this.prisma.channel.update({
      where: { id: channelId },
      data: { pinnedMessageId: messageId }
    });
  }

  async recordMessageViews(channelId: string, messageIds: string[]) {
    if (!messageIds.length) return;
    await this.prisma.channelMessage.updateMany({
      where: { channelId, id: { in: messageIds } },
      data: { viewCount: { increment: 1 } }
    });
  }

  async subscribe(actorId: string, channelId: string, userId: string, role: 'admin' | 'member') {
    await this.assertCanManage(actorId, channelId);
    await this.assertUserExists(userId);

    return this.prisma.subscription.upsert({
      where: { channelId_userId: { channelId, userId } },
      update: { role: role === 'admin' ? GroupRole.admin : GroupRole.member },
      create: {
        channelId,
        userId,
        role: role === 'admin' ? GroupRole.admin : GroupRole.member
      }
    });
  }

  async unsubscribe(actorId: string, channelId: string, userId: string) {
    await this.assertCanManage(actorId, channelId);
    const target = await this.prisma.subscription.findUnique({
      where: { channelId_userId: { channelId, userId } }
    });
    if (!target) {
      throw new NotFoundException('subscription not found');
    }
    if (target.role === GroupRole.owner) {
      throw new ForbiddenException('owner subscription cannot be removed');
    }
    return this.prisma.subscription.delete({
      where: { channelId_userId: { channelId, userId } }
    });
  }

  async postChannelMessage(senderId: string, channelId: string, encryptedContent: string) {
    const spam = await this.aiService.detectSpam({
      text: encryptedContent,
      senderId,
      context: 'channel'
    });
    if (spam.isSpam) {
      throw new BadRequestException(`channel message flagged as spam: ${spam.reasons.join(', ')}`);
    }

    const sub = await this.getSubscription(senderId, channelId);
    if (!sub || (sub.role !== GroupRole.owner && sub.role !== GroupRole.admin)) {
      throw new ForbiddenException('only channel owner/admin can post');
    }

    const created = await this.prisma.channelMessage.create({
      data: {
        channelId,
        senderId,
        encryptedContent
      }
    });
    await this.cacheService.delByPrefix(`cache:channel:${channelId}:messages:`);
    await this.pubsubService.publish(MESSAGING_CHANNELS.CHANNEL_MESSAGE_CREATED, {
      ...created,
      room: `channel:${channelId}`
    });
    void this.pushChannelMessage(senderId, channelId, created.id, encryptedContent);
    return created;
  }

  async isSubscriber(userId: string, channelId: string): Promise<boolean> {
    return Boolean(await this.getSubscription(userId, channelId));
  }

  private async pushChannelMessage(
    senderId: string,
    channelId: string,
    messageId: string,
    content: string
  ) {
    try {
      const [channel, sender, subs] = await Promise.all([
      this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { name: true, appSpace: true }
      }),
      this.prisma.user.findUnique({
        where: { id: senderId },
        select: { displayName: true, username: true }
      }),
      this.prisma.subscription.findMany({
        where: { channelId },
        select: { userId: true }
      })
    ]);
    const who = sender?.displayName?.trim() || sender?.username || '';
    const preview = messagePreview(content);
    const focus = channel?.appSpace === 'focus';
    void this.push.dispatch({
      userIds: subs.map((row) => row.userId).filter((id) => id !== senderId),
      category: 'channels',
      title: channel?.name || 'قناة',
      body: who ? `${who}: ${preview}` : preview,
      sensitive: true,
      mute: { targetType: 'channel', targetId: channelId },
      data: {
        kind: 'channel',
        channelId,
        messageId,
        route: focus ? `/focus/chats/channel/${channelId}` : `/channels/${channelId}`,
        tag: `channel-${channelId}`
      }
    });
    } catch {
      /* push must not break channel send */
    }
  }

  async markRead(userId: string, channelId: string) {
    const sub = await this.getSubscription(userId, channelId);
    if (!sub) throw new ForbiddenException('must be subscribed to view channel');
    const last = await this.prisma.channelMessage.findFirst({
      where: { channelId },
      orderBy: { timestamp: 'desc' },
      select: { id: true, timestamp: true }
    });
    return this.prisma.channelMessageRead.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: {
        channelId,
        userId,
        lastReadAt: last?.timestamp ?? new Date(),
        lastReadMessageId: last?.id ?? null
      },
      update: {
        lastReadAt: last?.timestamp ?? new Date(),
        lastReadMessageId: last?.id ?? null
      }
    });
  }

  async joinSelf(userId: string, channelId: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('channel not found');
    if (channel.visibility === 'private') {
      const existing = await this.getSubscription(userId, channelId);
      if (!existing) {
        throw new ForbiddenException('private channel requires an invite');
      }
      return existing;
    }
    return this.prisma.subscription.upsert({
      where: { channelId_userId: { channelId, userId } },
      update: {},
      create: { channelId, userId, role: GroupRole.member }
    });
  }

  async joinByInviteSlug(userId: string, inviteSlug: string) {
    const channel = await this.prisma.channel.findUnique({ where: { inviteSlug } });
    if (!channel) throw new NotFoundException('invite not found');
    const sub = await this.prisma.subscription.upsert({
      where: { channelId_userId: { channelId: channel.id, userId } },
      update: {},
      create: { channelId: channel.id, userId, role: GroupRole.member }
    });
    return { ...sub, channelId: channel.id, channelName: channel.name };
  }

  async listChannelMessages(
    userId: string,
    channelId: string,
    opts?: { before?: string; limit?: number }
  ) {
    const sub = await this.getSubscription(userId, channelId);
    if (!sub) {
      throw new ForbiddenException('must be subscribed to view channel messages');
    }
    const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);
    const before = opts?.before ? new Date(opts.before) : null;
    const cacheKey = `cache:channel:${channelId}:messages:before:${before?.toISOString() ?? 'none'}:limit:${limit}`;
    const cached =
      await this.cacheService.getJson<Awaited<ReturnType<typeof this.prisma.channelMessage.findMany>>>(cacheKey);
    if (cached) {
      return cached;
    }

    const where = before ? { channelId, timestamp: { lt: before } } : { channelId };
    const messages = await this.prisma.channelMessage.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      }
    });
    const sorted = messages.reverse();
    if (sorted.length) {
      void this.recordMessageViews(
        channelId,
        sorted.map((m) => m.id)
      );
    }
    await this.cacheService.setJson(cacheKey, sorted, this.config.cacheDefaultTtlSeconds);
    return sorted;
  }

  async getSubscriberIds(channelId: string): Promise<string[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { channelId },
      select: { userId: true }
    });
    return rows.map((item) => item.userId);
  }

  async getChannelMessageById(messageId: string) {
    const message = await this.prisma.channelMessage.findUnique({
      where: { id: messageId }
    });
    if (!message) {
      throw new NotFoundException('channel message not found');
    }
    return message;
  }

  async listSubscriptions(userId: string, channelId: string) {
    const sub = await this.getSubscription(userId, channelId);
    if (!sub || (sub.role !== GroupRole.owner && sub.role !== GroupRole.admin)) {
      throw new ForbiddenException('only owner/admin can view subscribers');
    }
    return this.prisma.subscription.findMany({
      where: { channelId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      }
    });
  }

  private async assertCanManage(actorId: string, channelId: string): Promise<void> {
    const sub = await this.getSubscription(actorId, channelId);
    if (!sub || (sub.role !== GroupRole.owner && sub.role !== GroupRole.admin)) {
      throw new ForbiddenException('only owner/admin can manage subscriptions');
    }
  }

  private async assertChannelExists(channelId: string): Promise<void> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('channel not found');
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('user not found');
    }
  }

  private async getSubscription(userId: string, channelId: string) {
    return this.prisma.subscription.findUnique({
      where: { channelId_userId: { channelId, userId } }
    });
  }
}
