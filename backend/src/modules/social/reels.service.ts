import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { STUB_VIDEO_MAX_BYTES, authorNotAutomated } from '../../common/automated-test';
import { MediaStorageService } from '../media/media.storage';
import { ContentAccessGate } from '../moderation/content-access.gate';
import { ModerationService } from '../moderation/moderation.service';
import {
  publicModerationWhere,
  mediaBytesAllowed,
  ownerBadge
} from '../moderation/moderation.visibility';
import { ContentAnalysisService } from '../recommendations/analysis.service';
import { RecommendationEventsService } from '../recommendations/events.service';
import { RecommendationPlannerService } from '../recommendations/planner.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeHashtags } from './hashtags.util';

@Injectable()
export class ReelsService {
  private readonly recommendationLog = new Logger(ReelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
    private readonly planner: RecommendationPlannerService,
    private readonly recommendationEvents: RecommendationEventsService,
    private readonly contentAnalysis: ContentAnalysisService,
    private readonly moderation: ModerationService,
    private readonly contentAccess: ContentAccessGate
  ) {}

  async create(
    authorId: string,
    input: {
      mediaId: string;
      caption?: string;
      thumbnailMediaId?: string;
      hashtags?: string[];
      aspectRatio?: '9:16' | '16:9';
      clientRequestId?: string;
    }
  ) {
    await this.moderation.assertCanPublish(authorId);
    const tags = normalizeHashtags(input.hashtags, true);

    if (input.clientRequestId) {
      const existing = await this.prisma.reel.findUnique({
        where: {
          authorId_clientRequestId: { authorId, clientRequestId: input.clientRequestId }
        },
        include: {
          media: true,
          author: { select: { id: true, username: true, avatarUrl: true, isPrivate: true } },
          hashtags: { include: { hashtag: true } },
          likes: { where: { userId: authorId }, select: { id: true } },
          _count: { select: { likes: true, comments: true } }
        }
      });
      if (existing) return this.attachMediaUrl(existing);
    }

    const media = await this.prisma.mediaAsset.findFirst({
      where: {
        id: input.mediaId,
        uploaderId: authorId,
        deletedAt: null,
        mediaType: 'video',
        uploadCompletedAt: { not: null }
      }
    });
    if (!media) throw new BadRequestException('video media not ready');
    if (media.processingStatus === 'failed') {
      throw new BadRequestException('video processing failed');
    }
    const duration = Number(media.durationSeconds || 0);
    if (!duration || duration > 60.05) {
      throw new BadRequestException('reel video must be between 0 and 60 seconds');
    }

    const hashtagRows = await Promise.all(
      tags.map((tag) =>
        this.prisma.hashtag.upsert({
          where: { tag: tag.toLowerCase() },
          create: { tag: tag.toLowerCase() },
          update: {}
        })
      )
    );

    const aspectRatio =
      input.aspectRatio === '16:9' || input.aspectRatio === '9:16' ? input.aspectRatio : '9:16';

    const reel = await this.prisma.reel.create({
      data: {
        authorId,
        mediaId: input.mediaId,
        caption: input.caption ?? null,
        aspectRatio,
        thumbnailMediaId: input.thumbnailMediaId ?? null,
        clientRequestId: input.clientRequestId || null,
        moderationStatus: 'PENDING_REVIEW',
        hashtags: { create: hashtagRows.map((h) => ({ hashtagId: h.id })) }
      },
      include: {
        media: true,
        author: { select: { id: true, username: true, avatarUrl: true, isPrivate: true } },
        hashtags: { include: { hashtag: true } },
        likes: { where: { userId: authorId }, select: { id: true } },
        _count: { select: { likes: true, comments: true } }
      }
    });
    this.contentAnalysis.enqueue('reel', reel.id, input.caption ?? '', tags);
    await this.moderation.enqueueAsync('reel', reel.id, 50);
    const attached = await this.attachMediaUrl(reel);
    const mod = await this.moderation.ownerStatus(authorId, 'reel', reel.id).catch(() => null);
    return { ...attached, moderation: mod };
  }

  async listByAuthor(viewerId: string, usernameOrId: string, cursor?: string, limit = 20) {
    const author = await this.prisma.user.findFirst({
      where: { OR: [{ id: usernameOrId }, { username: usernameOrId }] },
      select: { id: true, isPrivate: true }
    });
    if (!author) throw new NotFoundException('user not found');
    if (author.id !== viewerId) {
      const blocked = await this.prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: viewerId, blockedId: author.id },
            { blockerId: author.id, blockedId: viewerId }
          ]
        }
      });
      if (blocked) throw new ForbiddenException('not allowed');
      if (author.isPrivate) {
        const follow = await this.prisma.follow.findUnique({
          where: {
            followerId_followingId: { followerId: viewerId, followingId: author.id }
          }
        });
        if (!follow || follow.status !== 'accepted') {
          throw new ForbiddenException('private profile');
        }
      }
    }
    // Profile reels: public statuses only (owner violations → Account Moderation page).
    const reels = await this.prisma.reel.findMany({
      where: {
        authorId: author.id,
        deletedAt: null,
        archivedAt: null,
        ...publicModerationWhere(),
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      include: {
        media: true,
        author: { select: { id: true, username: true, avatarUrl: true, isPrivate: true } },
        likes: { where: { userId: viewerId }, select: { id: true } },
        _count: { select: { likes: true, comments: true } }
      }
    });
    return Promise.all(reels.map((r) => this.attachMediaUrl(r)));
  }

  async feed(userId: string, cursor?: string, limit = 20) {
    try {
      const planned = await this.planner.planReels(userId, cursor, limit);
      if (planned) return await this.hydratePlanned(userId, planned.items, planned.nextCursor);
    } catch (err) {
      this.recommendationLog.warn(
        `reels ranking failed, chronological fallback used: ${err instanceof Error ? err.message : 'error'}`
      );
    }
    const blocked = await this.prisma.userBlock.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true }
    });
    const blockedIds = new Set<string>();
    for (const row of blocked) {
      if (row.blockerId === userId) blockedIds.add(row.blockedId);
      if (row.blockedId === userId) blockedIds.add(row.blockerId);
    }

    const reels = await this.prisma.reel.findMany({
      where: {
        deletedAt: null,
        archivedAt: null,
        authorId: { notIn: [...blockedIds] },
        media: {
          processingStatus: { in: ['ready', 'processing', 'uploaded'] },
          sizeBytes: { gt: STUB_VIDEO_MAX_BYTES }
        },
        AND: [
          {
            OR: [{ authorId: userId }, { author: authorNotAutomated }]
          },
          {
            OR: [
              { author: { isPrivate: false } },
              { authorId: userId },
              {
                author: {
                  isPrivate: true,
                  followers: { some: { followerId: userId, status: 'accepted' } }
                }
              }
            ]
          }
        ],
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      include: {
        media: true,
        author: { select: { id: true, username: true, avatarUrl: true, isPrivate: true } },
        likes: { where: { userId }, select: { id: true } },
        _count: { select: { likes: true, comments: true } }
      }
    });
    return Promise.all(reels.map((r) => this.attachMediaUrl(r)));
  }

  async comment(userId: string, reelId: string, body: string, parentId?: string) {
    const reel = await this.assertCanEngage(userId, reelId);
    if (reel.commentsDisabled) {
      throw new ForbiddenException('comments are disabled on this reel');
    }
    const text = String(body || '').trim();
    if (!text || text.length > 1000) {
      throw new BadRequestException('comment body must be 1–1000 characters');
    }
    if (parentId) {
      const parent = await this.prisma.reelComment.findFirst({
        where: { id: parentId, reelId, deletedAt: null }
      });
      if (!parent) throw new NotFoundException('parent comment not found');
    }
    return this.prisma.reelComment.create({
      data: {
        reelId,
        authorId: userId,
        body: text,
        parentId: parentId ?? null
      },
      include: {
        author: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      }
    });
  }

  async listComments(userId: string, reelId: string, cursor?: string, limit = 40) {
    await this.assertCanEngage(userId, reelId);
    return this.prisma.reelComment.findMany({
      where: {
        reelId,
        deletedAt: null,
        ...(cursor ? { createdAt: { gt: new Date(cursor) } } : {})
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        author: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      }
    });
  }

  async deleteComment(userId: string, reelId: string, commentId: string) {
    const reel = await this.assertCanEngage(userId, reelId);
    const comment = await this.prisma.reelComment.findFirst({
      where: { id: commentId, reelId, deletedAt: null }
    });
    if (!comment) throw new NotFoundException('comment not found');
    if (comment.authorId !== userId && reel.authorId !== userId) {
      throw new ForbiddenException('not allowed to delete this comment');
    }
    await this.prisma.reelComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() }
    });
    return { deleted: true };
  }

  async update(
    userId: string,
    reelId: string,
    input: {
      caption?: string;
      mediaId?: string;
      hashtags?: string[];
      aspectRatio?: '9:16' | '16:9';
      thumbnailMediaId?: string | null;
    }
  ) {
    const reel = await this.prisma.reel.findFirst({
      where: { id: reelId, deletedAt: null }
    });
    if (!reel) throw new NotFoundException('reel not found');
    if (reel.authorId !== userId) throw new ForbiddenException('not reel owner');

    if (input.mediaId) {
      const media = await this.prisma.mediaAsset.findFirst({
        where: {
          id: input.mediaId,
          uploaderId: userId,
          deletedAt: null,
          mediaType: 'video',
          uploadCompletedAt: { not: null }
        }
      });
      if (!media) throw new BadRequestException('video media not ready');
      if (media.processingStatus === 'failed') {
        throw new BadRequestException('video processing failed');
      }
      const duration = Number(media.durationSeconds || 0);
      if (!duration || duration > 60.05) {
        throw new BadRequestException('reel video must be between 0 and 60 seconds');
      }
    }

    if (input.hashtags) {
      const tags = normalizeHashtags(input.hashtags, false);
      const hashtagRows = await Promise.all(
        tags.map((tag) =>
          this.prisma.hashtag.upsert({
            where: { tag: tag.toLowerCase() },
            create: { tag: tag.toLowerCase() },
            update: {}
          })
        )
      );
      await this.prisma.reelHashtag.deleteMany({ where: { reelId } });
      if (hashtagRows.length) {
        await this.prisma.reelHashtag.createMany({
          data: hashtagRows.map((h) => ({ reelId, hashtagId: h.id }))
        });
      }
    }

    const aspectRatio =
      input.aspectRatio === '16:9' || input.aspectRatio === '9:16'
        ? input.aspectRatio
        : undefined;

    await this.prisma.reel.update({
      where: { id: reelId },
      data: {
        ...(input.caption !== undefined ? { caption: input.caption || null } : {}),
        ...(input.mediaId ? { mediaId: input.mediaId } : {}),
        ...(input.thumbnailMediaId !== undefined
          ? { thumbnailMediaId: input.thumbnailMediaId }
          : {}),
        ...(aspectRatio ? { aspectRatio } : {})
      }
    });

    return this.getById(userId, reelId);
  }

  async deleteReel(userId: string, reelId: string) {
    const reel = await this.prisma.reel.findFirst({
      where: { id: reelId, deletedAt: null }
    });
    if (!reel) throw new NotFoundException('reel not found');
    if (reel.authorId !== userId) throw new ForbiddenException('not reel owner');
    await this.prisma.reel.update({
      where: { id: reelId },
      data: { deletedAt: new Date() }
    });
    void this.contentAnalysis.invalidate('reel', reelId).catch(() => undefined);
    return { deleted: true };
  }

  async getById(viewerId: string, reelId: string) {
    const access = await this.contentAccess.assertCanView(viewerId, 'reel', reelId);
    const reel = await this.prisma.reel.findFirst({
      where: { id: reelId, deletedAt: null },
      include: {
        media: true,
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            isPrivate: true
          }
        },
        likes: { where: { userId: viewerId }, select: { id: true } },
        hashtags: { include: { hashtag: true } },
        _count: { select: { likes: true, comments: true } }
      }
    });
    if (!reel) throw new NotFoundException('reel not found');
    if (reel.archivedAt && reel.authorId !== viewerId) {
      throw new NotFoundException('reel not found');
    }
    if (!reel.archivedAt && access.reason === 'public') {
      await this.assertCanEngage(viewerId, reelId);
    }
    const attached = await this.attachMediaUrl(reel);
    if (access.reason === 'owner') {
      const mod = await this.moderation.ownerStatus(viewerId, 'reel', reelId).catch(() => null);
      return { ...attached, moderation: mod };
    }
    return attached;
  }

  async like(userId: string, reelId: string) {
    await this.assertCanEngage(userId, reelId);
    await this.prisma.reelLike.upsert({
      where: { reelId_userId: { reelId, userId } },
      create: { reelId, userId },
      update: {}
    });
    void this.recommendationEvents.recordTrusted(userId, {
      eventType: 'like',
      contentType: 'reel',
      contentId: reelId,
      surface: 'reels'
    });
    return { liked: true };
  }

  async unlike(userId: string, reelId: string) {
    await this.assertCanEngage(userId, reelId);
    await this.prisma.reelLike.deleteMany({ where: { reelId, userId } });
    void this.recommendationEvents.recordTrusted(userId, {
      eventType: 'unlike',
      contentType: 'reel',
      contentId: reelId,
      surface: 'reels'
    });
    return { liked: false };
  }

  async recordView(userId: string, reelId: string) {
    await this.assertCanEngage(userId, reelId);
    await this.prisma.reel.updateMany({
      where: { id: reelId, deletedAt: null },
      data: { viewCount: { increment: 1 } }
    });
    return { recorded: true };
  }

  private async assertCanEngage(userId: string, reelId: string) {
    await this.contentAccess.assertCanView(userId, 'reel', reelId);
    const reel = await this.prisma.reel.findFirst({
      where: { id: reelId, deletedAt: null },
      include: { author: { select: { id: true, isPrivate: true } } }
    });
    if (!reel) throw new NotFoundException('reel not found');

    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: reel.authorId },
          { blockerId: reel.authorId, blockedId: userId }
        ]
      }
    });
    if (blocked) throw new ForbiddenException('not allowed');

    if (reel.authorId !== userId && reel.author.isPrivate) {
      const follow = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: { followerId: userId, followingId: reel.authorId }
        }
      });
      if (!follow || follow.status !== 'accepted') {
        throw new ForbiddenException('private reel');
      }
    }
    return reel;
  }

  private async hydratePlanned(
    userId: string,
    items: Array<{ id: string; reason: string; source: string }>,
    nextCursor: string | null
  ) {
    const ids = items.map((item) => item.id);
    if (!ids.length) return [];
    const reels = await this.prisma.reel.findMany({
      where: { id: { in: ids }, deletedAt: null, archivedAt: null },
      include: {
        media: true,
        author: { select: { id: true, username: true, avatarUrl: true, isPrivate: true } },
        likes: { where: { userId }, select: { id: true } },
        _count: { select: { likes: true, comments: true } }
      }
    });
    const hydrated = await Promise.all(reels.map((reel) => this.attachMediaUrl(reel)));
    const map = new Map(hydrated.map((reel) => [reel.id, reel]));
    const meta = new Map(items.map((item) => [item.id, item]));
    type RankedReel = (typeof hydrated)[number] & {
      recommendationReason: string;
      recommendationSource: string;
      recommendationCursor?: string;
    };
    const out: RankedReel[] = [];
    for (const id of ids) {
      const reel = map.get(id);
      const item = meta.get(id);
      if (!reel || !item) continue;
      out.push({ ...reel, recommendationReason: item.reason, recommendationSource: item.source });
    }
    if (nextCursor && out.length) {
      const last = out[out.length - 1];
      if (last) out[out.length - 1] = { ...last, recommendationCursor: nextCursor };
    }
    return out;
  }

  private async attachMediaUrl<
    T extends {
      moderationStatus?: string | null;
      thumbnailMediaId?: string | null;
      media: {
        id: string;
        storageKey: string;
        processingStatus: string;
        thumbnailKey?: string | null;
        [k: string]: unknown;
      };
    }
  >(reel: T) {
    const status = reel.moderationStatus || 'PENDING_REVIEW';
    const allowBytes = mediaBytesAllowed(status);
    const badge = ownerBadge(status);
    const playable = allowBytes && reel.media.processingStatus === 'ready';
    let secureUrl: string | null = null;
    let posterUrl: string | null = null;
    if (playable) {
      try {
        secureUrl = await this.mediaStorage.createReadUrl(reel.media.id, reel.media.storageKey);
      } catch {
        secureUrl = null;
      }
    }
    if (allowBytes && reel.media.thumbnailKey) {
      try {
        posterUrl = await this.mediaStorage.createReadUrl(reel.media.id, reel.media.thumbnailKey);
      } catch {
        posterUrl = null;
      }
    }
    if (allowBytes && !posterUrl && reel.thumbnailMediaId) {
      const thumb = await this.prisma.mediaAsset.findFirst({
        where: { id: reel.thumbnailMediaId, deletedAt: null }
      });
      if (thumb) {
        try {
          posterUrl = await this.mediaStorage.createReadUrl(thumb.id, thumb.storageKey);
        } catch {
          posterUrl = null;
        }
      }
    }
    return {
      ...reel,
      playable,
      ...(badge ? { moderation: badge } : {}),
      media: { ...reel.media, secureUrl, posterUrl, mediaRedacted: !allowBytes }
    };
  }
}
