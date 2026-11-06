import { Injectable } from '@nestjs/common';
import { AppSpace } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from './messaging.service';

export type UnifiedInboxItem = {
  type: 'dm' | 'group' | 'channel';
  id: string;
  title: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
  username?: string | null;
  lastMessage: string | null;
  lastAt: string | null;
  unreadCount: number;
  muted: boolean;
  pinned: boolean;
  pinSortOrder?: number | null;
};

@Injectable()
export class UnifiedInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messagingService: MessagingService
  ) {}

  async listInbox(
    userId: string,
    limit = 60,
    appSpace: 'browse' | 'focus' = 'focus'
  ): Promise<UnifiedInboxItem[]> {
    const take = Math.min(Math.max(limit, 1), 120);
    const space = appSpace === 'browse' ? AppSpace.browse : AppSpace.focus;
    const [dms, memberships, subscriptions, mutes, pins] = await Promise.all([
      this.messagingService.listConversations(userId, take, appSpace),
      this.prisma.groupMember.findMany({
        where: { userId, group: { appSpace: space } },
        include: {
          group: {
            include: {
              messages: {
                orderBy: { timestamp: 'desc' },
                take: 1,
                include: { sender: { select: { username: true, displayName: true } } }
              }
            }
          }
        }
      }),
      this.prisma.subscription.findMany({
        where: { userId, channel: { appSpace: space } },
        include: {
          channel: {
            include: {
              messages: {
                orderBy: { timestamp: 'desc' },
                take: 1,
                include: { sender: { select: { username: true, displayName: true } } }
              },
              _count: { select: { subscriptions: true } }
            }
          }
        }
      }),
      this.prisma.chatMute.findMany({ where: { userId } }),
      this.prisma.spacePin.findMany({ where: { userId } })
    ]);

    const muteSet = new Set(mutes.map((m) => `${m.targetType}:${m.targetId}`));
    const pinMap = new Map(pins.map((p) => [`${p.spaceType}:${p.spaceId}`, p]));

    const items: UnifiedInboxItem[] = [];

    for (const dm of dms) {
      const key = `dm:${dm.peer.id}`;
      const pin = pinMap.get(key);
      const preview =
        typeof dm.lastMessage?.encryptedContent === 'string'
          ? dm.lastMessage.encryptedContent.slice(0, 160)
          : null;
      items.push({
        type: 'dm',
        id: dm.peer.id,
        title: dm.peer.displayName || dm.peer.username,
        subtitle: `@${dm.peer.username}`,
        avatarUrl: dm.peer.avatarUrl,
        username: dm.peer.username,
        lastMessage: preview,
        lastAt: dm.lastMessage?.timestamp
          ? new Date(dm.lastMessage.timestamp).toISOString()
          : null,
        unreadCount: dm.unreadCount || 0,
        muted: muteSet.has(key),
        pinned: Boolean(pin),
        pinSortOrder: pin?.sortOrder ?? null
      });
    }

    const groupReads = await this.prisma.groupMessageRead.findMany({
      where: { userId, groupId: { in: memberships.map((m) => m.groupId) } }
    });
    const groupReadMap = new Map(groupReads.map((r) => [r.groupId, r.lastReadAt]));

    for (const m of memberships) {
      const g = m.group;
      const last = g.messages[0];
      const key = `group:${g.id}`;
      const pin = pinMap.get(key);
      const lastReadAt = groupReadMap.get(g.id);
      let unreadCount = 0;
      if (last) {
        unreadCount = await this.prisma.groupMessage.count({
          where: {
            groupId: g.id,
            senderId: { not: userId },
            timestamp: { gt: lastReadAt ?? new Date(0) }
          }
        });
      }
      items.push({
        type: 'group',
        id: g.id,
        title: g.name,
        subtitle: null,
        avatarUrl: g.avatarUrl,
        username: null,
        lastMessage: last
          ? `${last.sender.displayName || last.sender.username}: ${last.encryptedContent.slice(0, 120)}`
          : null,
        lastAt: last ? last.timestamp.toISOString() : g.updatedAt.toISOString(),
        unreadCount,
        muted: muteSet.has(key),
        pinned: Boolean(pin),
        pinSortOrder: pin?.sortOrder ?? null
      });
    }

    const channelReads = await this.prisma.channelMessageRead.findMany({
      where: { userId, channelId: { in: subscriptions.map((s) => s.channelId) } }
    });
    const channelReadMap = new Map(channelReads.map((r) => [r.channelId, r.lastReadAt]));

    for (const s of subscriptions) {
      const c = s.channel;
      const last = c.messages[0];
      const key = `channel:${c.id}`;
      const pin = pinMap.get(key);
      const lastReadAt = channelReadMap.get(c.id);
      let unreadCount = 0;
      if (last) {
        unreadCount = await this.prisma.channelMessage.count({
          where: {
            channelId: c.id,
            senderId: { not: userId },
            timestamp: { gt: lastReadAt ?? new Date(0) }
          }
        });
      }
      items.push({
        type: 'channel',
        id: c.id,
        title: c.name,
        subtitle: `${c._count.subscriptions} subscribers`,
        avatarUrl: c.avatarUrl,
        username: null,
        lastMessage: last ? last.encryptedContent.slice(0, 140) : null,
        lastAt: last ? last.timestamp.toISOString() : c.updatedAt.toISOString(),
        unreadCount,
        muted: muteSet.has(key),
        pinned: Boolean(pin),
        pinSortOrder: pin?.sortOrder ?? null
      });
    }

    items.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned && b.pinned) return (a.pinSortOrder ?? 0) - (b.pinSortOrder ?? 0);
      const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
      const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
      return tb - ta;
    });

    return items.slice(0, take);
  }

  async mute(userId: string, targetType: string, targetId: string) {
    return this.prisma.chatMute.upsert({
      where: { userId_targetType_targetId: { userId, targetType, targetId } },
      create: { userId, targetType, targetId },
      update: {}
    });
  }

  async unmute(userId: string, targetType: string, targetId: string) {
    await this.prisma.chatMute.deleteMany({ where: { userId, targetType, targetId } });
    return { ok: true };
  }
}
