import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SpacePinsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const pins = await this.prisma.spacePin.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
    });

    const groupIds = pins.filter((p) => p.spaceType === 'group').map((p) => p.spaceId);
    const channelIds = pins.filter((p) => p.spaceType === 'channel').map((p) => p.spaceId);

    const [groups, channels, memberships, subscriptions] = await Promise.all([
      groupIds.length
        ? this.prisma.group.findMany({
            where: { id: { in: groupIds } },
            select: { id: true, name: true, avatarUrl: true, description: true }
          })
        : Promise.resolve([]),
      channelIds.length
        ? this.prisma.channel.findMany({
            where: { id: { in: channelIds } },
            select: { id: true, name: true, avatarUrl: true, description: true }
          })
        : Promise.resolve([]),
      this.prisma.groupMember.findMany({
        where: { userId },
        select: {
          groupId: true,
          role: true,
          group: { select: { id: true, name: true, avatarUrl: true, description: true } }
        }
      }),
      this.prisma.subscription.findMany({
        where: { userId },
        select: {
          channelId: true,
          role: true,
          channel: { select: { id: true, name: true, avatarUrl: true, description: true } }
        }
      })
    ]);

    const groupMap = new Map(groups.map((g) => [g.id, g]));
    const channelMap = new Map(channels.map((c) => [c.id, c]));
    const memberSet = new Set(memberships.map((m) => m.groupId));
    const subSet = new Set(subscriptions.map((s) => s.channelId));

    const pinned = pins
      .map((p) => {
        if (p.spaceType === 'group') {
          if (!memberSet.has(p.spaceId)) return null;
          const g = groupMap.get(p.spaceId);
          if (!g) return null;
          return {
            pinId: p.id,
            spaceType: 'group' as const,
            spaceId: g.id,
            name: g.name,
            avatarUrl: g.avatarUrl,
            description: g.description,
            pinned: true,
            sortOrder: p.sortOrder
          };
        }
        if (!subSet.has(p.spaceId)) return null;
        const c = channelMap.get(p.spaceId);
        if (!c) return null;
        return {
          pinId: p.id,
          spaceType: 'channel' as const,
          spaceId: c.id,
          name: c.name,
          avatarUrl: c.avatarUrl,
          description: c.description,
          pinned: true,
          sortOrder: p.sortOrder
        };
      })
      .filter(Boolean);

    const pinnedKeys = new Set(pinned.map((p) => `${p!.spaceType}:${p!.spaceId}`));
    const unpinnedGroups = memberships
      .filter((m) => !pinnedKeys.has(`group:${m.groupId}`))
      .map((m) => ({
        pinId: null as string | null,
        spaceType: 'group' as const,
        spaceId: m.group.id,
        name: m.group.name,
        avatarUrl: m.group.avatarUrl,
        description: m.group.description,
        pinned: false,
        sortOrder: 9999
      }));
    const unpinnedChannels = subscriptions
      .filter((s) => !pinnedKeys.has(`channel:${s.channelId}`))
      .map((s) => ({
        pinId: null as string | null,
        spaceType: 'channel' as const,
        spaceId: s.channel.id,
        name: s.channel.name,
        avatarUrl: s.channel.avatarUrl,
        description: s.channel.description,
        pinned: false,
        sortOrder: 9999
      }));

    return [...pinned, ...unpinnedGroups, ...unpinnedChannels];
  }

  async pin(userId: string, spaceType: 'dm' | 'group' | 'channel', spaceId: string) {
    await this.assertMembership(userId, spaceType, spaceId);
    const max = await this.prisma.spacePin.aggregate({
      where: { userId },
      _max: { sortOrder: true }
    });
    return this.prisma.spacePin.upsert({
      where: { userId_spaceType_spaceId: { userId, spaceType, spaceId } },
      create: {
        userId,
        spaceType,
        spaceId,
        sortOrder: (max._max.sortOrder ?? -1) + 1
      },
      update: {}
    });
  }

  async unpin(userId: string, spaceType: 'dm' | 'group' | 'channel', spaceId: string) {
    const existing = await this.prisma.spacePin.findUnique({
      where: { userId_spaceType_spaceId: { userId, spaceType, spaceId } }
    });
    if (!existing) throw new NotFoundException('pin not found');
    await this.prisma.spacePin.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  async reorder(
    userId: string,
    ordered: Array<{ spaceType: 'dm' | 'group' | 'channel'; spaceId: string }>
  ) {
    if (!Array.isArray(ordered) || ordered.length > 50) {
      throw new BadRequestException('invalid order payload');
    }
    let i = 0;
    for (const item of ordered) {
      await this.prisma.spacePin.updateMany({
        where: { userId, spaceType: item.spaceType, spaceId: item.spaceId },
        data: { sortOrder: i++ }
      });
    }
    return this.list(userId);
  }

  private async assertMembership(userId: string, spaceType: string, spaceId: string) {
    if (spaceType === 'dm') {
      const peer = await this.prisma.user.findUnique({ where: { id: spaceId }, select: { id: true } });
      if (!peer) throw new NotFoundException('user not found');
      if (peer.id === userId) throw new BadRequestException('cannot pin self');
      return;
    }
    if (spaceType === 'group') {
      const m = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: spaceId, userId } }
      });
      if (!m) throw new ForbiddenException('not a group member');
      return;
    }
    if (spaceType === 'channel') {
      const s = await this.prisma.subscription.findUnique({
        where: { channelId_userId: { channelId: spaceId, userId } }
      });
      if (!s) throw new ForbiddenException('not a channel subscriber');
      return;
    }
    throw new BadRequestException('invalid spaceType');
  }
}
