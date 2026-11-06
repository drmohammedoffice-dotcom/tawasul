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
import { EngagementService } from '../engagement/engagement.service';
import { MESSAGING_CHANNELS } from '../messaging/messaging.constants';
import { MessagingPubSubService } from '../messaging/messaging-pubsub.service';
import { PresenceService } from '../messaging/presence.service';
import { FeatureGateService } from '../monetization/feature-gate.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { messagePreview } from '../push/message-preview';
import { PushService } from '../push/push.service';

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly cacheService: CacheService,
    private readonly config: AppConfigService,
    private readonly featureGateService: FeatureGateService,
    private readonly engagementService: EngagementService,
    private readonly presenceService: PresenceService,
    @Inject(forwardRef(() => MessagingPubSubService))
    private readonly pubsubService: MessagingPubSubService,
    private readonly push: PushService
  ) {}

  async listMyGroups(userId: string) {
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        group: {
          include: {
            _count: { select: { members: true, messages: true } },
            owner: { select: { id: true, username: true, displayName: true } }
          }
        }
      }
    });
    return memberships.map((m) => ({
      ...m.group,
      myRole: m.role
    }));
  }

  async listMembers(actorId: string, groupId: string) {
    const membership = await this.getMembership(actorId, groupId);
    if (!membership) {
      throw new ForbiddenException('not a group member');
    }
    const rows = await this.prisma.groupMember.findMany({
      where: { groupId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      }
    });
    const withPresence = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        online: await this.presenceService.isOnline(row.userId)
      }))
    );
    // Owner first, then admins, then members.
    const rank = (role: GroupRole) =>
      role === GroupRole.owner ? 0 : role === GroupRole.admin ? 1 : 2;
    return withPresence.sort((a, b) => rank(a.role) - rank(b.role));
  }

  async getGroupForMember(userId: string, groupId: string) {
    const membership = await this.getMembership(userId, groupId);
    if (!membership) {
      throw new ForbiddenException('not a group member');
    }
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        owner: { select: { id: true, username: true, displayName: true } },
        _count: { select: { members: true, messages: true } }
      }
    });
    if (!group) throw new NotFoundException('group not found');
    return { ...group, myRole: membership.role };
  }

  async createGroup(ownerId: string, dto: CreateGroupDto) {
    await this.featureGateService.assertCanCreateGroup(ownerId);
    const memberIds = [...new Set((dto.memberIds ?? []).filter((id) => id && id !== ownerId))];
    const inviteSlug = `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const group = await this.prisma.group.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        ownerId,
        visibility: dto.visibility === 'public' ? 'public' : 'private',
        inviteSlug,
        appSpace: dto.appSpace === 'focus' ? 'focus' : 'browse',
        members: {
          create: [
            { userId: ownerId, role: GroupRole.owner },
            ...memberIds.map((userId) => ({ userId, role: GroupRole.member }))
          ]
        }
      },
      include: { members: true, _count: { select: { members: true } } }
    });
    try {
      await this.engagementService.recordGroupJoined(ownerId);
      for (const id of memberIds) {
        await this.engagementService.recordGroupJoined(id);
      }
    } catch {
      // Engagement rewards are best-effort and should not break group creation.
    }
    return group;
  }

  async updateGroup(actorId: string, groupId: string, dto: UpdateGroupDto) {
    await this.assertHasAdminRights(actorId, groupId);
    return this.prisma.group.update({
      where: { id: groupId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl || null } : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        ...(dto.historyVisibility !== undefined
          ? { historyVisibility: dto.historyVisibility }
          : {})
      },
      include: { _count: { select: { members: true } } }
    });
  }

  async ensureInviteSlug(actorId: string, groupId: string) {
    const group = await this.getGroupForMember(actorId, groupId);
    if (group.inviteSlug) {
      return { inviteSlug: group.inviteSlug, visibility: group.visibility };
    }
    await this.assertHasAdminRights(actorId, groupId);
    const inviteSlug = `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const updated = await this.prisma.group.update({
      where: { id: groupId },
      data: { inviteSlug }
    });
    return { inviteSlug: updated.inviteSlug!, visibility: updated.visibility };
  }

  async leaveSelf(userId: string, groupId: string) {
    const membership = await this.getMembership(userId, groupId);
    if (!membership) throw new NotFoundException('membership not found');
    if (membership.role === GroupRole.owner) {
      throw new ForbiddenException('owner cannot leave; delete the group or transfer ownership');
    }
    return this.prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } }
    });
  }

  async deleteGroup(actorId: string, groupId: string) {
    const membership = await this.getMembership(actorId, groupId);
    if (!membership || membership.role !== GroupRole.owner) {
      throw new ForbiddenException('only owner can delete the group');
    }
    await this.prisma.group.delete({ where: { id: groupId } });
    return { id: groupId, deleted: true };
  }

  async addMember(actorId: string, groupId: string, userId: string, role: 'admin' | 'member') {
    await this.assertHasAdminRights(actorId, groupId);
    await this.assertGroupExists(groupId);
    await this.assertUserExists(userId);

    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } }
    });
    const member = await this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: { role: role === 'admin' ? GroupRole.admin : GroupRole.member },
      create: {
        groupId,
        userId,
        role: role === 'admin' ? GroupRole.admin : GroupRole.member
      }
    });
    if (!existing) {
      try {
        await this.engagementService.recordGroupJoined(userId);
      } catch {
        // Engagement rewards are best-effort and should not break member management.
      }
    }
    return member;
  }

  async removeMember(actorId: string, groupId: string, userId: string) {
    const actor = await this.getMembership(actorId, groupId);
    if (!actor || (actor.role !== GroupRole.owner && actor.role !== GroupRole.admin)) {
      throw new ForbiddenException('only owner/admin can remove members');
    }
    const target = await this.getMembership(userId, groupId);
    if (!target) {
      throw new NotFoundException('member not found');
    }
    if (target.role === GroupRole.owner) {
      throw new ForbiddenException('owner cannot be removed');
    }
    return this.prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } }
    });
  }

  async sendGroupMessage(senderId: string, groupId: string, encryptedContent: string) {
    const spam = await this.aiService.detectSpam({
      text: encryptedContent,
      senderId,
      context: 'group'
    });
    if (spam.isSpam) {
      throw new BadRequestException(`group message flagged as spam: ${spam.reasons.join(', ')}`);
    }

    const membership = await this.getMembership(senderId, groupId);
    if (!membership) {
      throw new ForbiddenException('sender is not a group member');
    }
    const created = await this.prisma.groupMessage.create({
      data: {
        groupId,
        senderId,
        encryptedContent
      }
    });
    await this.cacheService.delByPrefix(`cache:group:${groupId}:messages:`);
    await this.pubsubService.publish(MESSAGING_CHANNELS.GROUP_MESSAGE_CREATED, {
      ...created,
      room: `group:${groupId}`
    });
    void this.pushGroupMessage(senderId, groupId, created.id, encryptedContent);
    return created;
  }

  async isMember(userId: string, groupId: string): Promise<boolean> {
    return Boolean(await this.getMembership(userId, groupId));
  }

  async getMemberIds(groupId: string): Promise<string[]> {
    const rows = await this.prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true }
    });
    return rows.map((row) => row.userId);
  }

  private async pushGroupMessage(senderId: string, groupId: string, messageId: string, content: string) {
    try {
      const [group, sender, memberIds] = await Promise.all([
      this.prisma.group.findUnique({
        where: { id: groupId },
        select: { name: true, appSpace: true }
      }),
      this.prisma.user.findUnique({
        where: { id: senderId },
        select: { displayName: true, username: true }
      }),
      this.getMemberIds(groupId)
    ]);
    const who = sender?.displayName?.trim() || sender?.username || '';
    const preview = messagePreview(content);
    const focus = group?.appSpace === 'focus';
    void this.push.dispatch({
      userIds: memberIds.filter((id) => id !== senderId),
      category: 'groups',
      title: group?.name || 'مجموعة',
      body: who ? `${who}: ${preview}` : preview,
      sensitive: true,
      mute: { targetType: 'group', targetId: groupId },
      data: {
        kind: 'group',
        groupId,
        messageId,
        route: focus ? `/focus/chats/group/${groupId}` : `/groups/${groupId}`,
        tag: `group-${groupId}`
      }
    });
    } catch {
      /* push must not break group send */
    }
  }

  async markRead(userId: string, groupId: string) {
    const membership = await this.getMembership(userId, groupId);
    if (!membership) throw new ForbiddenException('not a group member');
    const last = await this.prisma.groupMessage.findFirst({
      where: { groupId },
      orderBy: { timestamp: 'desc' },
      select: { id: true, timestamp: true }
    });
    return this.prisma.groupMessageRead.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: {
        groupId,
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

  async listGroupMessages(
    userId: string,
    groupId: string,
    opts?: { before?: string; limit?: number }
  ) {
    const membership = await this.getMembership(userId, groupId);
    if (!membership) {
      throw new ForbiddenException('not a group member');
    }
    const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);
    const before = opts?.before ? new Date(opts.before) : null;
    const cacheKey = `cache:group:${groupId}:messages:before:${before?.toISOString() ?? 'none'}:limit:${limit}`;
    const cached = await this.cacheService.getJson<Awaited<ReturnType<typeof this.prisma.groupMessage.findMany>>>(cacheKey);
    if (cached) {
      return cached;
    }

    const where = before ? { groupId, timestamp: { lt: before } } : { groupId };
    const messages = await this.prisma.groupMessage.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      }
    });
    const sorted = messages.reverse();
    await this.cacheService.setJson(cacheKey, sorted, this.config.cacheDefaultTtlSeconds);
    return sorted;
  }

  private async assertHasAdminRights(userId: string, groupId: string): Promise<void> {
    const membership = await this.getMembership(userId, groupId);
    if (!membership || (membership.role !== GroupRole.owner && membership.role !== GroupRole.admin)) {
      throw new ForbiddenException('only owner/admin can manage members');
    }
  }

  private async assertGroupExists(groupId: string): Promise<void> {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) {
      throw new NotFoundException('group not found');
    }
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('user not found');
    }
  }

  private async getMembership(userId: string, groupId: string) {
    return this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } }
    });
  }
}
