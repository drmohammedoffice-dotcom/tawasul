import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { ContentAccessGate } from '../moderation/content-access.gate';
import { MediaStorageService } from '../media/media.storage';
import { ModerationService } from '../moderation/moderation.service';
import { publicModerationWhere, mediaBytesAllowed, ownerBadge } from '../moderation/moderation.visibility';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { RecommendationEventsService } from '../recommendations/events.service';
import { RecommendationPlannerService } from '../recommendations/planner.service';

const USER_PUBLIC = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true
} as const;

@Injectable()
export class StoriesService {
  private readonly recommendationLog = new Logger(StoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
    private readonly notifications: NotificationsService,
    private readonly planner: RecommendationPlannerService,
    private readonly recommendationEvents: RecommendationEventsService,
    private readonly moderation: ModerationService,
    private readonly contentAccess: ContentAccessGate
  ) {}

  async create(
    authorId: string,
    mediaId: string,
    audience: 'everyone' | 'close_friends' | 'family' = 'everyone',
    opts?: { commentsDisabled?: boolean }
  ) {
    await this.moderation.assertCanPublish(authorId);
    const media = await this.prisma.mediaAsset.findFirst({
      where: {
        id: mediaId,
        uploaderId: authorId,
        deletedAt: null,
        uploadCompletedAt: { not: null }
      }
    });
    if (!media) throw new BadRequestException('media not ready');
    if (audience !== 'everyone' && audience !== 'close_friends' && audience !== 'family') {
      throw new BadRequestException('invalid audience');
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const story = await this.prisma.story.create({
      data: {
        authorId,
        mediaId,
        expiresAt,
        audience,
        commentsDisabled: opts?.commentsDisabled === true,
        moderationStatus: 'PENDING_REVIEW'
      },
      include: { media: true, author: { select: USER_PUBLIC } }
    });
    await this.moderation.enqueueAsync('story', story.id, 50);
    const attached = await this.attachMediaUrl(story);
    const mod = await this.moderation.ownerStatus(authorId, 'story', story.id).catch(() => null);
    return { ...attached, moderation: mod };
  }

  async feed(userId: string) {
    const following = await this.prisma.follow.findMany({
      where: { followerId: userId, status: 'accepted' },
      select: { followingId: true }
    });
    const blocked = await this.prisma.userBlock.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true }
    });
    const blockedIds = new Set<string>();
    for (const row of blocked) {
      if (row.blockerId === userId) blockedIds.add(row.blockedId);
      if (row.blockedId === userId) blockedIds.add(row.blockerId);
    }
    const authorIds = [userId, ...following.map((f) => f.followingId)].filter(
      (id) => id === userId || !blockedIds.has(id)
    );
    const closeFriendOf = await this.prisma.closeFriend.findMany({
      where: { friendId: userId },
      select: { ownerId: true }
    });
    const closeOwnerIds = new Set(
      closeFriendOf.map((c) => c.ownerId).filter((id) => !blockedIds.has(id))
    );
    const now = new Date();
    const stories = await this.prisma.story.findMany({
      where: {
        deletedAt: null,
        ...publicModerationWhere(),
        expiresAt: { gt: now },
        authorId: { in: authorIds },
        OR: [
          { audience: 'everyone' },
          { authorId: userId },
          { audience: 'close_friends', authorId: { in: [...closeOwnerIds] } },
          { audience: 'family', authorId: { in: [...closeOwnerIds] } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      include: {
        media: true,
        author: { select: USER_PUBLIC },
        views: { where: { viewerId: userId }, select: { id: true } },
        _count: { select: { views: true, replies: true, reactions: true } }
      }
    });
    const hydrated = await Promise.all(stories.map((s) => this.attachMediaUrl(s)));
    try {
      const orderedIds = await this.planner.orderStories(
        userId,
        stories.map((story) => ({
          id: story.id,
          authorId: story.authorId,
          createdAt: story.createdAt,
          audience: story.audience,
          seen: story.views.length > 0,
          hasMedia: Boolean(story.media)
        }))
      );
      const byId = new Map(hydrated.map((story) => [story.id, story]));
      return orderedIds
        .map((id) => byId.get(id))
        .filter((story): story is (typeof hydrated)[number] => Boolean(story));
    } catch (err) {
      this.recommendationLog.warn(
        `story ranking failed, original order kept: ${err instanceof Error ? err.message : 'error'}`
      );
      return hydrated;
    }
  }

  async view(viewerId: string, storyId: string) {
    await this.contentAccess.assertCanView(viewerId, 'story', storyId);
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, deletedAt: null, expiresAt: { gt: new Date() } }
    });
    if (!story) throw new NotFoundException('story not found');
    await this.assertCanViewStory(viewerId, story.authorId, story.audience);
    await this.prisma.storyView.upsert({
      where: { storyId_viewerId: { storyId, viewerId } },
      create: { storyId, viewerId },
      update: { viewedAt: new Date() }
    });
    void this.recommendationEvents.recordTrusted(viewerId, {
      eventType: 'story_view',
      contentType: 'story',
      contentId: storyId,
      surface: 'stories'
    });
    return { viewed: true };
  }

  async insights(ownerId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, deletedAt: null }
    });
    if (!story) throw new NotFoundException('story not found');
    if (story.authorId !== ownerId) throw new ForbiddenException('not story owner');

    const [views, reactions, replies] = await Promise.all([
      this.prisma.storyView.findMany({
        where: { storyId },
        orderBy: { viewedAt: 'desc' },
        include: { viewer: { select: USER_PUBLIC } }
      }),
      this.prisma.storyReaction.findMany({
        where: { storyId },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: USER_PUBLIC } }
      }),
      this.prisma.storyReply.findMany({
        where: { storyId },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: USER_PUBLIC } }
      })
    ]);

    const reactionByUser = new Map(reactions.map((r) => [r.userId, r.emoji]));
    const viewers = views.map((v) => ({
      id: v.id,
      viewedAt: v.viewedAt,
      user: v.viewer,
      reaction: reactionByUser.get(v.viewerId) || null
    }));

    return {
      viewCount: views.length,
      reactionCount: reactions.length,
      replyCount: replies.length,
      viewers,
      reactions: reactions.map((r) => ({
        id: r.id,
        emoji: r.emoji,
        createdAt: r.createdAt,
        user: r.user
      })),
      replies: replies.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.createdAt,
        author: r.author
      }))
    };
  }

  async react(userId: string, storyId: string, emoji: string) {
    const clean = String(emoji || '').trim().slice(0, 16);
    if (!clean) throw new BadRequestException('emoji required');
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, deletedAt: null, expiresAt: { gt: new Date() } }
    });
    if (!story) throw new NotFoundException('story not found');
    await this.assertCanViewStory(userId, story.authorId, story.audience);
    await this.prisma.storyView.upsert({
      where: { storyId_viewerId: { storyId, viewerId: userId } },
      create: { storyId, viewerId: userId },
      update: { viewedAt: new Date() }
    });
    const row = await this.prisma.storyReaction.upsert({
      where: { storyId_userId: { storyId, userId } },
      create: { storyId, userId, emoji: clean },
      update: { emoji: clean },
      include: { user: { select: USER_PUBLIC } }
    });
    await this.notifications.notify({
      recipientId: story.authorId,
      actorId: userId,
      type: 'story_reaction',
      entityType: 'story',
      entityId: storyId,
      payload: { emoji: clean }
    });
    return row;
  }

  async reply(userId: string, storyId: string, body: string) {
    const text = String(body || '').trim();
    if (!text || text.length > 500) throw new BadRequestException('invalid reply');
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, deletedAt: null, expiresAt: { gt: new Date() } }
    });
    if (!story) throw new NotFoundException('story not found');
    if (story.commentsDisabled) throw new ForbiddenException('comments disabled');
    await this.assertCanViewStory(userId, story.authorId, story.audience);
    await this.prisma.storyView.upsert({
      where: { storyId_viewerId: { storyId, viewerId: userId } },
      create: { storyId, viewerId: userId },
      update: { viewedAt: new Date() }
    });
    const reply = await this.prisma.storyReply.create({
      data: { storyId, authorId: userId, body: text },
      include: { author: { select: USER_PUBLIC } }
    });
    await this.notifications.notify({
      recipientId: story.authorId,
      actorId: userId,
      type: 'story_reply',
      entityType: 'story',
      entityId: storyId,
      payload: { body: text.slice(0, 140) }
    });
    return reply;
  }

  async listReplies(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, deletedAt: null }
    });
    if (!story) throw new NotFoundException('story not found');
    if (story.authorId !== userId) {
      await this.assertCanViewStory(userId, story.authorId, story.audience);
    }
    return this.prisma.storyReply.findMany({
      where: { storyId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: USER_PUBLIC } }
    });
  }

  async remove(userId: string, storyId: string) {
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story || story.deletedAt) throw new NotFoundException('story not found');
    if (story.authorId !== userId) throw new ForbiddenException('not story owner');
    await this.prisma.story.update({
      where: { id: storyId },
      data: { deletedAt: new Date() }
    });
    return { deleted: true };
  }

  private async assertCanViewStory(
    viewerId: string,
    authorId: string,
    audience: 'everyone' | 'close_friends' | 'family' = 'everyone'
  ) {
    if (viewerId === authorId) return;
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: authorId },
          { blockerId: authorId, blockedId: viewerId }
        ]
      }
    });
    if (blocked) throw new ForbiddenException('not allowed');
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId: viewerId, followingId: authorId }
      }
    });
    if (!follow || follow.status !== 'accepted') {
      throw new ForbiddenException('story not visible');
    }
    if (audience === 'close_friends' || audience === 'family') {
      const cf = await this.prisma.closeFriend.findUnique({
        where: { ownerId_friendId: { ownerId: authorId, friendId: viewerId } }
      });
      if (!cf) throw new ForbiddenException('story not visible');
    }
  }

  private async attachMediaUrl<
    T extends {
      moderationStatus?: string | null;
      media: { id: string; storageKey: string; [k: string]: unknown } | null;
    }
  >(
    story: T
  ): Promise<
    T & {
      moderation?: ReturnType<typeof ownerBadge>;
      media: (NonNullable<T['media']> & { secureUrl: string | null; mediaRedacted?: boolean }) | null;
    }
  > {
    const status = story.moderationStatus || 'PENDING_REVIEW';
    const allowBytes = mediaBytesAllowed(status);
    const badge = ownerBadge(status);
    if (!story.media) {
      return { ...story, ...(badge ? { moderation: badge } : {}), media: null };
    }
    if (!allowBytes) {
      return {
        ...story,
        ...(badge ? { moderation: badge } : {}),
        media: { ...story.media, secureUrl: null, mediaRedacted: true }
      };
    }
    try {
      const secureUrl = await this.mediaStorage.createReadUrl(
        story.media.id,
        story.media.storageKey
      );
      return {
        ...story,
        ...(badge ? { moderation: badge } : {}),
        media: { ...story.media, secureUrl, mediaRedacted: false }
      };
    } catch {
      return {
        ...story,
        ...(badge ? { moderation: badge } : {}),
        media: { ...story.media, secureUrl: null, mediaRedacted: false }
      };
    }
  }
}
