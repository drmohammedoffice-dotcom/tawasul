import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { MediaService } from '../media/media.service';
import { ModerationService } from '../moderation/moderation.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { RecommendationEventsService } from '../recommendations/events.service';

const USERNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9._]{1,30}$/;

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly recommendationEvents: RecommendationEventsService,
    private readonly mediaService: MediaService,
    private readonly moderation: ModerationService
  ) {}

  async getProfile(viewerId: string | null, usernameOrId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: usernameOrId }, { username: usernameOrId }]
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        coverUrl: true,
        isPrivate: true,
        role: true,
        accountType: true,
        isVerified: true,
        verifiedAt: true,
        usernameChangedAt: true,
        createdAt: true,
        businessProfile: true,
        _count: {
          select: {
            followers: { where: { status: 'accepted' } },
            following: { where: { status: 'accepted' } },
            posts: { where: { deletedAt: null } },
            reels: { where: { deletedAt: null } },
            storyHighlights: true
          }
        }
      }
    });
    if (!user) throw new NotFoundException('user not found');

    const isSelf = viewerId === user.id;
    let followStatus: string | null = null;
    let isBlocked = false;
    if (viewerId && !isSelf) {
      const [follow, block] = await Promise.all([
        this.prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: viewerId, followingId: user.id } }
        }),
        this.prisma.userBlock.findFirst({
          where: {
            OR: [
              { blockerId: viewerId, blockedId: user.id },
              { blockerId: user.id, blockedId: viewerId }
            ]
          }
        })
      ]);
      followStatus = follow?.status ?? null;
      isBlocked = Boolean(block);
    }

    const canViewPosts =
      isSelf ||
      !user.isPrivate ||
      followStatus === 'accepted';

    const focus = await this.prisma.focusProfile.findUnique({
      where: { userId: user.id },
      select: { hideBrowseProfile: true }
    });
    const browseProfileHidden = Boolean(focus?.hideBrowseProfile) && !isSelf;
    const [avatarUrl, coverUrl] = await Promise.all([
      this.mediaService.resolveStoredUserMediaUrl(user.avatarUrl),
      this.mediaService.resolveStoredUserMediaUrl(user.coverUrl)
    ]);

    return {
      ...user,
      avatarUrl,
      coverUrl,
      followStatus,
      isBlocked,
      canViewPosts: browseProfileHidden ? false : canViewPosts,
      isSelf,
      browseProfileHidden,
      ...(browseProfileHidden
        ? {
            _count: { followers: 0, following: 0, posts: 0, reels: 0, storyHighlights: 0 },
            bio: null,
            coverUrl: null,
            followStatus: null,
            viewerFollowStatus: null
          }
        : {})
    };
  }

  async checkUsernameAvailable(viewerId: string, raw: string) {
    const username = String(raw || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      return { available: false, reason: 'invalid', username };
    }
    const existing = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true }
    });
    if (existing && existing.id !== viewerId) {
      return { available: false, reason: 'taken', username };
    }
    return { available: true, reason: 'ok', username };
  }

  async updateMe(
    userId: string,
    input: {
      displayName?: string;
      bio?: string;
      avatarUrl?: string;
      coverUrl?: string;
      isPrivate?: boolean;
      username?: string;
    }
  ) {
    const bio =
      input.bio !== undefined
        ? String(input.bio).slice(0, 150)
        : undefined;
    const data: Record<string, unknown> = {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(input.avatarUrl !== undefined
        ? { avatarUrl: this.mediaService.normalizePersistedUserMediaRef(input.avatarUrl) }
        : {}),
      ...(input.coverUrl !== undefined
        ? { coverUrl: this.mediaService.normalizePersistedUserMediaRef(input.coverUrl) }
        : {}),
      ...(input.isPrivate !== undefined ? { isPrivate: input.isPrivate } : {})
    };

    if (input.username !== undefined) {
      const next = input.username.trim().toLowerCase();
      if (!USERNAME_RE.test(next)) {
        throw new BadRequestException('invalid username');
      }
      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, usernameChangedAt: true }
      });
      if (!me) throw new NotFoundException('user not found');
      if (next !== me.username) {
        if (me.usernameChangedAt) {
          const elapsed = Date.now() - me.usernameChangedAt.getTime();
          if (elapsed < USERNAME_COOLDOWN_MS) {
            const daysLeft = Math.ceil((USERNAME_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
            throw new BadRequestException(
              `username can only be changed once every 30 days (${daysLeft} day(s) left)`
            );
          }
        }
        const taken = await this.prisma.user.findUnique({
          where: { username: next },
          select: { id: true }
        });
        if (taken) throw new ConflictException('username already in use');
        data.username = next;
        data.usernameChangedAt = new Date();
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        coverUrl: true,
        isPrivate: true,
        usernameChangedAt: true
      }
    });
  }

  async follow(followerId: string, targetUserId: string) {
    if (followerId === targetUserId) {
      throw new BadRequestException('cannot follow yourself');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('user not found');

    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: followerId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: followerId }
        ]
      }
    });
    if (blocked) throw new ForbiddenException('cannot follow this user');

    const status = target.isPrivate ? 'pending' : 'accepted';
    const follow = await this.prisma.follow.upsert({
      where: {
        followerId_followingId: { followerId, followingId: targetUserId }
      },
      create: { followerId, followingId: targetUserId, status },
      update: { status }
    });

    await this.notifications.notify({
      recipientId: targetUserId,
      actorId: followerId,
      type: status === 'pending' ? 'follow_request' : 'follow',
      entityType: 'user',
      entityId: followerId
    });
    if (status === 'accepted') {
      void this.recommendationEvents.recordTrusted(followerId, {
        eventType: 'follow',
        contentType: 'user',
        contentId: targetUserId,
        surface: 'profile'
      });
    }

    return follow;
  }

  async unfollow(followerId: string, targetUserId: string) {
    await this.prisma.follow.deleteMany({
      where: { followerId, followingId: targetUserId }
    });
    void this.recommendationEvents.recordTrusted(followerId, {
      eventType: 'unfollow',
      contentType: 'user',
      contentId: targetUserId,
      surface: 'profile'
    });
    return { unfollowed: true };
  }

  async acceptFollow(userId: string, followerId: string) {
    const updated = await this.prisma.follow.updateMany({
      where: { followerId, followingId: userId, status: 'pending' },
      data: { status: 'accepted' }
    });
    if (!updated.count) throw new NotFoundException('follow request not found');
    return { accepted: true };
  }

  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw new BadRequestException('cannot block yourself');
    await this.prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: blockerId, followingId: blockedId },
          { followerId: blockedId, followingId: blockerId }
        ]
      }
    });
    return this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {}
    });
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
    return { unblocked: true };
  }

  async report(
    reporterId: string,
    input: { targetType: string; targetId: string; reason: string; details?: string }
  ) {
    return this.moderation.fileReport(reporterId, input);
  }

  async listFollowers(viewerId: string, usernameOrId: string) {
    const user = await this.resolveUser(usernameOrId);
    await this.assertCanListSocialGraph(viewerId, user);
    const rows = await this.prisma.follow.findMany({
      where: { followingId: user.id, status: 'accepted' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        follower: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, isPrivate: true }
        }
      }
    });
    return rows.map((r) => r.follower);
  }

  async listFollowing(viewerId: string, usernameOrId: string) {
    const user = await this.resolveUser(usernameOrId);
    await this.assertCanListSocialGraph(viewerId, user);
    const rows = await this.prisma.follow.findMany({
      where: { followerId: user.id, status: 'accepted' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        following: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, isPrivate: true }
        }
      }
    });
    return rows.map((r) => r.following);
  }

  async listPendingFollowRequests(userId: string) {
    const rows = await this.prisma.follow.findMany({
      where: { followingId: userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        follower: {
          select: { id: true, username: true, displayName: true, avatarUrl: true }
        }
      }
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      follower: r.follower
    }));
  }

  private async resolveUser(usernameOrId: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: usernameOrId }, { username: usernameOrId }] },
      select: { id: true, isPrivate: true }
    });
    if (!user) throw new NotFoundException('user not found');
    return user;
  }

  private async assertCanListSocialGraph(
    viewerId: string,
    user: { id: string; isPrivate: boolean }
  ) {
    if (viewerId === user.id) return;

    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: user.id },
          { blockerId: user.id, blockedId: viewerId }
        ]
      }
    });
    if (blocked) throw new ForbiddenException('not allowed');

    if (!user.isPrivate) return;

    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId: viewerId, followingId: user.id }
      }
    });
    if (!follow || follow.status !== 'accepted') {
      throw new ForbiddenException('private profile');
    }
  }
}
