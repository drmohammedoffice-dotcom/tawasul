import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import {
  STUB_IMAGE_MAX_BYTES,
  STUB_VIDEO_MAX_BYTES,
  authorNotAutomated
} from '../../common/automated-test';
import { MediaService } from '../media/media.service';
import { MediaStorageService } from '../media/media.storage';
import { ContentAccessGate } from '../moderation/content-access.gate';
import { ModerationService } from '../moderation/moderation.service';
import {
  publicModerationWhere,
  discoveryModerationWhere,
  mediaBytesAllowed,
  ownerBadge
} from '../moderation/moderation.visibility';
import { ContentAnalysisService } from '../recommendations/analysis.service';
import { RecommendationEventsService } from '../recommendations/events.service';
import { RecommendationPlannerService, type PlanPage } from '../recommendations/planner.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { normalizeHashtags } from './hashtags.util';

@Injectable()
export class PostsService {
  private readonly recommendationLog = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mediaStorage: MediaStorageService,
    private readonly mediaService: MediaService,
    private readonly planner: RecommendationPlannerService,
    private readonly recommendationEvents: RecommendationEventsService,
    private readonly contentAnalysis: ContentAnalysisService,
    private readonly moderation: ModerationService,
    private readonly contentAccess: ContentAccessGate
  ) {}

  async create(
    authorId: string,
    input: {
      caption?: string;
      mediaIds: string[];
      hashtags?: string[];
      aspectRatio?: '1:1' | '3:4';
      clientRequestId?: string;
    }
  ) {
    await this.moderation.assertCanPublish(authorId);
    if (!input.mediaIds?.length) {
      throw new BadRequestException('at least one mediaId is required');
    }
    if (input.mediaIds.length > 10) {
      throw new BadRequestException('at most 10 media items');
    }
    const tags = normalizeHashtags(input.hashtags, true);
    if (input.clientRequestId) {
      const existing = await this.prisma.post.findUnique({
        where: {
          authorId_clientRequestId: { authorId, clientRequestId: input.clientRequestId }
        },
        include: {
          media: { include: { media: true }, orderBy: { sortOrder: 'asc' } },
          author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          hashtags: { include: { hashtag: true } },
          _count: { select: { likes: true, comments: true } }
        }
      });
      if (existing) {
        return this.attachMediaUrls([existing], authorId).then((rows) => rows[0]);
      }
    }

    const media = await this.prisma.mediaAsset.findMany({
      where: {
        id: { in: input.mediaIds },
        uploaderId: authorId,
        deletedAt: null,
        uploadCompletedAt: { not: null },
        processingStatus: { in: ['ready', 'uploaded', 'processing'] }
      }
    });
    if (media.length !== input.mediaIds.length) {
      throw new BadRequestException('one or more media items are invalid or not ready');
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
      input.aspectRatio === '3:4' || input.aspectRatio === '1:1' ? input.aspectRatio : '1:1';

    const created = await this.prisma.post.create({
      data: {
        authorId,
        caption: input.caption ?? null,
        aspectRatio,
        clientRequestId: input.clientRequestId || null,
        moderationStatus: 'PENDING_REVIEW',
        media: {
          create: input.mediaIds.map((mediaId, index) => ({
            mediaId,
            sortOrder: index
          }))
        },
        hashtags: {
          create: hashtagRows.map((h) => ({ hashtagId: h.id }))
        }
      },
      include: {
        media: { include: { media: true }, orderBy: { sortOrder: 'asc' } },
        author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        hashtags: { include: { hashtag: true } },
        _count: { select: { likes: true, comments: true } }
      }
    });
    this.contentAnalysis.enqueue('post', created.id, input.caption ?? '', tags);
    // Quarantine first — await job enqueue so status cannot race to public.
    await this.moderation.enqueueAsync('post', created.id, 50);
    const withUrls = (await this.attachMediaUrls([created], authorId))[0];
    const mod = await this.moderation.ownerStatus(authorId, 'post', created.id).catch(() => null);
    return { ...withUrls, moderation: mod };
  }

  async feed(userId: string, cursor?: string, limit = 20) {
    try {
      const planned = await this.planner.planHome(userId, cursor, limit);
      if (planned) return await this.hydratePlanned(userId, planned);
    } catch (err) {
      this.recommendationLog.warn(
        `feed ranking failed, chronological fallback used: ${err instanceof Error ? err.message : 'error'}`
      );
    }
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

    const cursorDate = cursor ? new Date(cursor) : null;
    const cursorFilter =
      cursorDate && !Number.isNaN(cursorDate.getTime()) ? { createdAt: { lt: cursorDate } } : {};
    const take = Math.min(Math.max(limit * 2, limit), 60);

    const [posts, reels] = await Promise.all([
      this.prisma.post.findMany({
        where: {
          deletedAt: null,
          archivedAt: null,
          ...publicModerationWhere(),
          authorId: { in: authorIds },
          ...cursorFilter
        },
        orderBy: { createdAt: 'desc' },
        take,
        include: this.postInclude(userId)
      }),
      this.prisma.reel.findMany({
        where: {
          deletedAt: null,
          archivedAt: null,
          ...publicModerationWhere(),
          authorId: { in: authorIds },
          ...cursorFilter
        },
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          media: true,
          author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          likes: { where: { userId }, select: { id: true } },
          _count: { select: { likes: true, comments: true } }
        }
      })
    ]);

    const withMediaPosts = await this.attachMediaUrls(posts);
    const withMediaReels = await Promise.all(reels.map((r) => this.attachReelMediaUrl(r)));
    let mixed = [
      ...withMediaPosts.map((p) => ({ kind: 'post' as const, sortAt: p.createdAt, item: p })),
      ...withMediaReels.map((r) => ({ kind: 'reel' as const, sortAt: r.createdAt, item: r }))
    ]
      .sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime())
      .slice(0, Math.min(limit, 50))
      .map((row) => ({ kind: row.kind, ...row.item, createdAt: row.sortAt }));

    const preference = await this.prisma.recommendationPreference.findUnique({
      where: { userId },
      select: { feedMode: true }
    });
    const chronological = preference?.feedMode === 'following_chronological';
    // A short following list is filled only while the viewer is still on the ranked home.
    if (mixed.length < Math.min(8, limit) && !cursor && !chronological) {
      const discovery = await this.discoveryForUser(userId, limit);
      const seen = new Set(mixed.map((m) => m.id));
      for (const row of discovery) {
        if (seen.has(row.id)) continue;
        // Discovery rows are structurally feed-compatible after media attach.
        mixed.push(row as any);
        seen.add(row.id);
        if (mixed.length >= limit) break;
      }
    }

    return mixed;
  }

  /**
   * New-user / discovery home: prefer same-country public authors, boost interest
   * hashtags and content the viewer engaged with (more_like_this / views).
   */
  private async discoveryForUser(userId: string, limit = 20) {
    const [me, interests, signals, hideSignals] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { countryCode: true }
      }),
      this.prisma.userInterest.findMany({
        where: { userId },
        select: { interestKey: true }
      }),
      this.prisma.contentSignal.findMany({
        where: { userId, signal: 'more_like_this', targetType: { in: ['post', 'reel'] } },
        select: { targetId: true, targetType: true },
        take: 40
      }),
      this.prisma.contentSignal.findMany({
        where: { userId, signal: 'not_interested', targetType: { in: ['post', 'reel'] } },
        select: { targetId: true, targetType: true }
      })
    ]);
    const country = (me?.countryCode || 'IQ').toUpperCase();
    const interestKeys = interests.map((i) => i.interestKey.toLowerCase());
    const hide = new Set(hideSignals.map((s) => `${s.targetType}:${s.targetId}`));
    const lookback = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const take = Math.min(Math.max(limit * 4, 40), 120);

    const authorBase = {
      ...authorNotAutomated,
      isPrivate: false,
      id: { not: userId },
      blocksReceived: { none: { blockerId: userId } },
      blocksInitiated: { none: { blockedId: userId } }
    };

    const [countryPosts, countryReels, globalPosts, globalReels] = await Promise.all([
      this.prisma.post.findMany({
        where: {
          deletedAt: null,
          archivedAt: null,
          createdAt: { gte: lookback },
          author: { ...authorBase, countryCode: country }
        },
        orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
        take,
        include: this.postInclude(userId)
      }),
      this.prisma.reel.findMany({
        where: {
          deletedAt: null,
          archivedAt: null,
          createdAt: { gte: lookback },
          author: { ...authorBase, countryCode: country }
        },
        orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
        take,
        include: {
          media: true,
          author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          likes: { where: { userId }, select: { id: true } },
          hashtags: { include: { hashtag: true } },
          _count: { select: { likes: true, comments: true } }
        }
      }),
      this.prisma.post.findMany({
        where: {
          deletedAt: null,
          archivedAt: null,
          createdAt: { gte: lookback },
          author: authorBase
        },
        orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
        take: Math.ceil(take / 2),
        include: this.postInclude(userId)
      }),
      this.prisma.reel.findMany({
        where: {
          deletedAt: null,
          archivedAt: null,
          createdAt: { gte: lookback },
          author: authorBase
        },
        orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
        take: Math.ceil(take / 2),
        include: {
          media: true,
          author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          likes: { where: { userId }, select: { id: true } },
          hashtags: { include: { hashtag: true } },
          _count: { select: { likes: true, comments: true } }
        }
      })
    ]);

    const likedPostIds = new Set(
      signals.filter((s) => s.targetType === 'post').map((s) => s.targetId)
    );
    const likedReelIds = new Set(
      signals.filter((s) => s.targetType === 'reel').map((s) => s.targetId)
    );

    const scoreItem = (
      kind: 'post' | 'reel',
      row: {
        id: string;
        caption?: string | null;
        viewCount?: number | null;
        createdAt: Date;
        _count?: { likes?: number; comments?: number };
        hashtags?: Array<{ hashtag?: { tag?: string } | null }>;
        author?: { id?: string };
      },
      sameCountry: boolean
    ) => {
      if (hide.has(`${kind}:${row.id}`)) return null;
      const tags = (row.hashtags || [])
        .map((h) => (h.hashtag?.tag || '').toLowerCase())
        .filter(Boolean);
      const caption = String(row.caption || '').toLowerCase();
      let interestBoost = 0;
      for (const key of interestKeys) {
        if (tags.some((t) => t.includes(key) || key.includes(t)) || caption.includes(key)) {
          interestBoost += 40;
        }
      }
      const signalBoost =
        (kind === 'post' && likedPostIds.has(row.id)) || (kind === 'reel' && likedReelIds.has(row.id))
          ? 60
          : 0;
      const likes = row._count?.likes ?? 0;
      const comments = row._count?.comments ?? 0;
      const views = row.viewCount ?? 0;
      const countryBoost = sameCountry ? 90 : 0;
      const score =
        views * 2 + likes * 5 + comments * 3 + interestBoost + signalBoost + countryBoost;
      return { kind, score, sortAt: row.createdAt, item: row };
    };

    const countryPostIds = new Set(countryPosts.map((p) => p.id));
    const countryReelIds = new Set(countryReels.map((r) => r.id));

    const postsMedia = await this.attachMediaUrls(
      [...countryPosts, ...globalPosts].filter(
        (p, i, arr) => arr.findIndex((x) => x.id === p.id) === i
      )
    );
    const reelsMedia = await Promise.all(
      [...countryReels, ...globalReels]
        .filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i)
        .map((r) => this.attachReelMediaUrl(r))
    );

    const scored = [
      ...postsMedia.map((p) => scoreItem('post', p, countryPostIds.has(p.id))),
      ...reelsMedia.map((r) => scoreItem('reel', r, countryReelIds.has(r.id)))
    ].filter((row): row is NonNullable<typeof row> => Boolean(row));

    scored.sort((a, b) => b.score - a.score || b.sortAt.getTime() - a.sortAt.getTime());
    return scored
      .slice(0, Math.min(limit, 50))
      .map((row) => ({ kind: row.kind, ...row.item, createdAt: row.sortAt }));
  }

  /**
   * Instagram-style Explore: posts + reels ranked by today's engagement
   * (views + likes + comments), then recent activity.
   */
  async explore(userId: string, cursor?: string, limit = 36) {
    try {
      const planned = await this.planner.planExplore(userId, cursor, limit);
      return await this.hydratePlanned(userId, planned);
    } catch (err) {
      this.recommendationLog.warn(
        `explore ranking failed, legacy sort used: ${err instanceof Error ? err.message : 'error'}`
      );
    }
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const lookback = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const take = Math.min(Math.max(limit * 3, limit), 120);
    const authorFilter = {
      ...authorNotAutomated,
      isPrivate: false,
      blocksReceived: { none: { blockerId: userId } },
      blocksInitiated: { none: { blockedId: userId } }
    };

    const [posts, reels] = await Promise.all([
      this.prisma.post.findMany({
        where: {
          deletedAt: null,
          archivedAt: null,
          createdAt: { gte: lookback },
          author: authorFilter
        },
        orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
        take,
        include: this.postInclude(userId)
      }),
      this.prisma.reel.findMany({
        where: {
          deletedAt: null,
          archivedAt: null,
          createdAt: { gte: lookback },
          author: authorFilter,
          media: {
            processingStatus: { in: ['ready', 'processing', 'uploaded'] },
            sizeBytes: { gt: STUB_VIDEO_MAX_BYTES }
          }
        },
        orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
        take,
        include: {
          media: true,
          author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          likes: { where: { userId }, select: { id: true } },
          _count: { select: { likes: true, comments: true } }
        }
      })
    ]);

    const realPosts = posts.filter((p) => !this.isStubOnlyPost(p));
    const withMediaPosts = await this.attachMediaUrls(realPosts);
    const withMediaReels = await Promise.all(reels.map((r) => this.attachReelMediaUrl(r)));

    const signals = await this.prisma.contentSignal.findMany({
      where: {
        userId,
        signal: 'not_interested',
        targetType: { in: ['post', 'reel'] }
      },
      select: { targetId: true, targetType: true }
    });
    const hide = new Set(signals.map((s) => `${s.targetType}:${s.targetId}`));

    const scored = [
      ...withMediaPosts.map((p) => {
        if (hide.has(`post:${p.id}`)) return null;
        const likes = p._count?.likes ?? 0;
        const comments = p._count?.comments ?? 0;
        const views = p.viewCount ?? 0;
        const todayBoost = p.createdAt >= dayStart ? 80 : 0;
        const score = views * 2 + likes * 5 + comments * 3 + todayBoost;
        return { kind: 'post' as const, score, sortAt: p.createdAt, item: p };
      }),
      ...withMediaReels.map((r) => {
        if (hide.has(`reel:${r.id}`)) return null;
        const likes = r._count?.likes ?? 0;
        const comments = r._count?.comments ?? 0;
        const views = r.viewCount ?? 0;
        const todayBoost = r.createdAt >= dayStart ? 100 : 0;
        const score = views * 2 + likes * 5 + comments * 3 + todayBoost + 15;
        return { kind: 'reel' as const, score, sortAt: r.createdAt, item: r };
      })
    ].filter((row): row is NonNullable<typeof row> => Boolean(row));

    scored.sort((a, b) => b.score - a.score || b.sortAt.getTime() - a.sortAt.getTime());

    let out = scored.map((row) => ({ kind: row.kind, ...row.item, createdAt: row.sortAt }));
    if (cursor) {
      const idx = out.findIndex((x) => x.id === cursor);
      if (idx >= 0) out = out.slice(idx + 1);
    }
    return out.slice(0, Math.min(limit, 60));
  }

  private async attachReelMediaUrl<
    T extends { media: { id: string; storageKey: string; [k: string]: unknown } | null }
  >(
    reel: T
  ): Promise<
    T & {
      playable: boolean;
      media: (T['media'] & { secureUrl: string | null; playable?: boolean }) | null;
    }
  > {
    if (!reel.media) return { ...reel, playable: false, media: null };
    try {
      const secureUrl = await this.mediaStorage.createReadUrl(reel.media.id, reel.media.storageKey);
      const status = String((reel.media as { processingStatus?: string }).processingStatus || '');
      const playable = status === 'ready' || status === 'uploaded' || !status;
      return {
        ...reel,
        playable,
        media: {
          ...reel.media,
          secureUrl,
          playable
        }
      };
    } catch {
      return { ...reel, playable: false, media: { ...reel.media, secureUrl: null, playable: false } };
    }
  }

  /**
   * Deterministic explore ranking (not ML): demote not_interested, boost more_like_this
   * hashtag overlap and user interest keywords in captions/tags. Privacy/block already filtered.
   */
  private async rankExplore<T extends { id: string; caption?: string | null; hashtags?: Array<{ hashtag?: { tag?: string } }> }>(
    userId: string,
    posts: T[]
  ): Promise<T[]> {
    if (!posts.length) return posts;
    const [signals, interests] = await Promise.all([
      this.prisma.contentSignal.findMany({
        where: { userId, targetType: 'post' },
        select: { targetId: true, signal: true }
      }),
      this.prisma.userInterest.findMany({
        where: { userId },
        select: { interestKey: true }
      })
    ]);
    const notInterested = new Set(
      signals.filter((s) => s.signal === 'not_interested').map((s) => s.targetId)
    );
    const moreLike = signals.filter((s) => s.signal === 'more_like_this').map((s) => s.targetId);
    const likedTags = new Set<string>();
    if (moreLike.length) {
      const likedPosts = await this.prisma.post.findMany({
        where: { id: { in: moreLike } },
        include: { hashtags: { include: { hashtag: true } } }
      });
      for (const p of likedPosts) {
        for (const h of p.hashtags) {
          if (h.hashtag?.tag) likedTags.add(h.hashtag.tag.toLowerCase());
        }
      }
    }
    const interestKeys = interests.map((i) => i.interestKey.toLowerCase());

    const scored = posts.map((p, index) => {
      let score = posts.length - index; // recency baseline
      if (notInterested.has(p.id)) score -= 1000;
      const tags = (p.hashtags || [])
        .map((h) => h.hashtag?.tag?.toLowerCase())
        .filter(Boolean) as string[];
      for (const t of tags) {
        if (likedTags.has(t)) score += 40;
      }
      const caption = (p.caption || '').toLowerCase();
      for (const key of interestKeys) {
        if (caption.includes(key) || tags.some((t) => t.includes(key))) score += 15;
      }
      return { p, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.p);
  }

  /** Smoke 1×1 PNG / tiny MP4 fixtures — keep in DB, hide from product Explore. */
  private isStubOnlyPost(post: {
    media: Array<{ media: { sizeBytes?: number | null; mimeType?: string | null; originalFileName?: string | null } }>;
  }): boolean {
    const rows = post.media || [];
    if (!rows.length) return true;
    return rows.every((row) => {
      const m = row.media;
      const name = String(m.originalFileName || '').toLowerCase();
      if (name === 't.png' || name === 'test.png') return true;
      const bytes = Number(m.sizeBytes || 0);
      const mime = String(m.mimeType || '');
      if (mime.startsWith('image/') && bytes > 0 && bytes <= STUB_IMAGE_MAX_BYTES) return true;
      if (mime.startsWith('video/') && bytes > 0 && bytes <= STUB_VIDEO_MAX_BYTES) return true;
      return false;
    });
  }

  async view(userId: string, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null, archivedAt: null }
    });
    if (!post) throw new NotFoundException('post not found');
    const existing = await this.prisma.postView.findUnique({
      where: { postId_viewerId: { postId, viewerId: userId } }
    });
    if (existing) {
      return { viewed: true, viewCount: post.viewCount, firstView: false };
    }
    await this.prisma.$transaction([
      this.prisma.postView.create({ data: { postId, viewerId: userId } }),
      this.prisma.post.update({
        where: { id: postId },
        data: { viewCount: { increment: 1 } }
      })
    ]);
    return { viewed: true, viewCount: post.viewCount + 1, firstView: true };
  }

  async like(userId: string, postId: string) {
    const post = await this.assertCanEngageWithPost(userId, postId);
    await this.prisma.postLike.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId },
      update: {}
    });
    await this.notifications.notify({
      recipientId: post.authorId,
      actorId: userId,
      type: 'post_like',
      entityType: 'post',
      entityId: postId
    });
    void this.recommendationEvents.recordTrusted(userId, {
      eventType: 'like',
      contentType: 'post',
      contentId: postId,
      surface: 'feed'
    });
    return { liked: true };
  }

  async unlike(userId: string, postId: string) {
    await this.assertCanEngageWithPost(userId, postId);
    await this.prisma.postLike.deleteMany({ where: { postId, userId } });
    void this.recommendationEvents.recordTrusted(userId, {
      eventType: 'unlike',
      contentType: 'post',
      contentId: postId,
      surface: 'feed'
    });
    return { liked: false };
  }

  async comment(userId: string, postId: string, body: string, parentId?: string) {
    const post = await this.assertCanEngageWithPost(userId, postId);
    if (post.commentsDisabled) {
      throw new ForbiddenException('comments are disabled on this post');
    }
    const comment = await this.prisma.comment.create({
      data: { postId, authorId: userId, body, parentId: parentId ?? null },
      include: {
        author: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      }
    });
    await this.notifications.notify({
      recipientId: post.authorId,
      actorId: userId,
      type: 'post_comment',
      entityType: 'comment',
      entityId: comment.id,
      payload: { postId }
    });
    void this.recommendationEvents.recordTrusted(userId, {
      eventType: 'comment',
      contentType: 'post',
      contentId: postId,
      surface: 'feed'
    });
    return comment;
  }

  async listComments(userId: string, postId: string, cursor?: string, limit = 40) {
    await this.assertCanEngageWithPost(userId, postId);
    return this.prisma.comment.findMany({
      where: {
        postId,
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

  async deleteComment(userId: string, postId: string, commentId: string) {
    const post = await this.assertCanEngageWithPost(userId, postId);
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, postId, deletedAt: null }
    });
    if (!comment) throw new NotFoundException('comment not found');
    if (comment.authorId !== userId && post.authorId !== userId) {
      throw new ForbiddenException('not allowed to delete this comment');
    }
    await this.prisma.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() }
    });
    return { deleted: true };
  }

  async postsByUser(viewerId: string, usernameOrId: string, cursor?: string, limit = 20) {
    const author = await this.prisma.user.findFirst({
      where: { OR: [{ id: usernameOrId }, { username: usernameOrId }] },
      select: { id: true, isPrivate: true }
    });
    if (!author) throw new NotFoundException('user not found');

    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: author.id },
          { blockerId: author.id, blockedId: viewerId }
        ]
      }
    });
    if (blocked) throw new ForbiddenException('not allowed');

    if (author.id !== viewerId && author.isPrivate) {
      const follow = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: { followerId: viewerId, followingId: author.id }
        }
      });
      if (!follow || follow.status !== 'accepted') {
        throw new ForbiddenException('private profile');
      }
    }

    // Profile grid shows only publicly visible content — even for the owner.
    // Quarantined / violating items live exclusively under Account → Violations.
    const posts = await this.prisma.post.findMany({
      where: {
        authorId: author.id,
        deletedAt: null,
        archivedAt: null,
        ...publicModerationWhere(),
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      include: this.postInclude(viewerId)
    });
    return this.attachMediaUrls(posts, viewerId);
  }

  async bookmark(userId: string, postId: string) {
    await this.assertCanEngageWithPost(userId, postId);
    await this.prisma.bookmark.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId },
      update: {}
    });
    void this.recommendationEvents.recordTrusted(userId, {
      eventType: 'save',
      contentType: 'post',
      contentId: postId,
      surface: 'feed'
    });
    return { bookmarked: true };
  }

  async unbookmark(userId: string, postId: string) {
    await this.assertCanEngageWithPost(userId, postId);
    await this.prisma.bookmark.deleteMany({ where: { postId, userId } });
    void this.recommendationEvents.recordTrusted(userId, {
      eventType: 'unsave',
      contentType: 'post',
      contentId: postId,
      surface: 'feed'
    });
    return { bookmarked: false };
  }

  async listBookmarks(userId: string, cursor?: string, limit = 20) {
    const rows = await this.prisma.bookmark.findMany({
      where: {
        userId,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
        post: { deletedAt: null, ...publicModerationWhere() }
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      include: {
        post: {
          include: this.postInclude(userId)
        }
      }
    });
    const posts = rows
      .map((r) => ({ ...r.post, bookmarkedAt: r.createdAt }))
      .filter(Boolean);
    return this.attachMediaUrls(posts, userId);
  }

  async update(
    userId: string,
    postId: string,
    input: {
      caption?: string;
      mediaIds?: string[];
      hashtags?: string[];
      aspectRatio?: '1:1' | '3:4';
    }
  ) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null }
    });
    if (!post) throw new NotFoundException('post not found');
    if (post.authorId !== userId) throw new ForbiddenException('not post owner');

    if (input.mediaIds) {
      if (!input.mediaIds.length) throw new BadRequestException('at least one mediaId is required');
      if (input.mediaIds.length > 10) throw new BadRequestException('at most 10 media items');
      const media = await this.prisma.mediaAsset.findMany({
        where: {
          id: { in: input.mediaIds },
          uploaderId: userId,
          deletedAt: null,
          uploadCompletedAt: { not: null },
          processingStatus: { in: ['ready', 'uploaded', 'processing'] }
        }
      });
      if (media.length !== input.mediaIds.length) {
        throw new BadRequestException('one or more media items are invalid or not ready');
      }
      await this.prisma.postMedia.deleteMany({ where: { postId } });
      await this.prisma.postMedia.createMany({
        data: input.mediaIds.map((mediaId, index) => ({
          postId,
          mediaId,
          sortOrder: index
        }))
      });
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
      await this.prisma.postHashtag.deleteMany({ where: { postId } });
      if (hashtagRows.length) {
        await this.prisma.postHashtag.createMany({
          data: hashtagRows.map((h) => ({ postId, hashtagId: h.id }))
        });
      }
    }

    const aspectRatio =
      input.aspectRatio === '3:4' || input.aspectRatio === '1:1'
        ? input.aspectRatio
        : undefined;

    await this.prisma.post.update({
      where: { id: postId },
      data: {
        ...(input.caption !== undefined ? { caption: input.caption || null } : {}),
        ...(aspectRatio ? { aspectRatio } : {})
      }
    });

    if (input.caption !== undefined || input.mediaIds || input.hashtags) {
      const tags =
        input.hashtags !== undefined
          ? normalizeHashtags(input.hashtags, false)
          : (
              await this.prisma.postHashtag.findMany({
                where: { postId },
                select: { hashtag: { select: { tag: true } } }
              })
            ).map((row) => row.hashtag.tag);
      const caption =
        input.caption !== undefined
          ? input.caption || ''
          : (await this.prisma.post.findUnique({ where: { id: postId }, select: { caption: true } }))
              ?.caption || '';
      this.contentAnalysis.enqueue('post', postId, caption, tags);
    }

    return this.getById(userId, postId);
  }

  async deletePost(userId: string, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null }
    });
    if (!post) throw new NotFoundException('post not found');
    if (post.authorId !== userId) throw new ForbiddenException('not post owner');
    await this.prisma.post.update({
      where: { id: postId },
      data: { deletedAt: new Date() }
    });
    void this.contentAnalysis.invalidate('post', postId).catch(() => undefined);
    return { deleted: true };
  }

  private async requirePost(postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null, archivedAt: null }
    });
    if (!post) throw new NotFoundException('post not found');
    return post;
  }

  async getById(viewerId: string, postId: string) {
    const access = await this.contentAccess.assertCanView(viewerId, 'post', postId);
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      include: this.postInclude(viewerId)
    });
    if (!post) throw new NotFoundException('post not found');
    // Archived posts are owner-only.
    if (post.archivedAt && post.authorId !== viewerId) {
      throw new NotFoundException('post not found');
    }
    if (!post.archivedAt && access.reason === 'public') {
      await this.assertCanEngageWithPost(viewerId, postId);
    }
    const attached = (await this.attachMediaUrls([post], viewerId))[0];
    if (access.reason === 'owner') {
      const mod = await this.moderation.ownerStatus(viewerId, 'post', postId).catch(() => null);
      return { ...attached, moderation: mod };
    }
    return attached;
  }

  /**
   * Viewer may engage if: owns the post, OR author is public and not blocked,
   * OR author is private and viewer has an accepted follow. Blocks always deny.
   */
  private async assertCanEngageWithPost(viewerId: string, postId: string) {
    await this.contentAccess.assertCanView(viewerId, 'post', postId);
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null, archivedAt: null },
      include: { author: { select: { id: true, isPrivate: true } } }
    });
    if (!post) throw new NotFoundException('post not found');

    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: post.authorId },
          { blockerId: post.authorId, blockedId: viewerId }
        ]
      }
    });
    if (blocked) {
      throw new ForbiddenException('not allowed to interact with this post');
    }

    if (post.authorId === viewerId) {
      return post;
    }

    if (post.author.isPrivate) {
      const follow = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: { followerId: viewerId, followingId: post.authorId }
        }
      });
      if (!follow || follow.status !== 'accepted') {
        throw new ForbiddenException('private post');
      }
    }

    return post;
  }

  private async attachMediaUrls<
    T extends {
      moderationStatus?: string | null;
      authorId?: string;
      author?: { avatarUrl?: string | null; [k: string]: unknown };
      media: Array<{
        media: {
          id: string;
          storageKey: string;
          thumbnailKey?: string | null;
          [k: string]: unknown;
        };
      }>;
    }
  >(
    posts: T[],
    viewerId?: string
  ): Promise<Array<T & { moderation?: ReturnType<typeof ownerBadge> }>> {
    const avatarMap = await this.mediaService.resolveStoredUserMediaUrls(
      posts.map((post) => post.author?.avatarUrl)
    );
    return Promise.all(
      posts.map(async (post) => {
        const status = post.moderationStatus || 'PENDING_REVIEW';
        const isOwner = Boolean(viewerId && post.authorId && viewerId === post.authorId);
        const allowBytes = mediaBytesAllowed(status, { isOwner });
        const publiclyVisible = mediaBytesAllowed(status);
        const badge = isOwner ? ownerBadge(status) : null;
        const author = post.author
          ? {
              ...post.author,
              avatarUrl: avatarMap.get(String(post.author.avatarUrl || '')) ?? post.author.avatarUrl
            }
          : post.author;
        return {
          ...post,
          ...(author ? { author } : {}),
          ...(badge ? { moderation: badge } : {}),
          media: await Promise.all(
            post.media.map(async (row) => {
              let secureUrl: string | null = null;
              let posterUrl: string | null = null;
              if (allowBytes) {
                try {
                  secureUrl = await this.mediaStorage.createReadUrl(
                    row.media.id,
                    row.media.storageKey
                  );
                } catch {
                  secureUrl = null;
                }
                if (row.media.thumbnailKey) {
                  try {
                    posterUrl = await this.mediaStorage.createReadUrl(
                      row.media.id,
                      row.media.thumbnailKey
                    );
                  } catch {
                    posterUrl = null;
                  }
                }
              }
              return {
                ...row,
                media: {
                  ...row.media,
                  secureUrl,
                  posterUrl,
                  // Quarantined for everyone except public statuses; owner may still get a preview URL.
                  mediaRedacted: !publiclyVisible
                }
              };
            })
          )
        };
      })
    );
  }

  async hashtagFeed(userId: string, tag: string, cursor?: string, limit = 20) {
    const planned = await this.planner.planHashtag(userId, tag, cursor, limit);
    return this.hydratePlanned(userId, planned);
  }

  private async hydratePlanned(userId: string, page: PlanPage) {
    const postIds = page.items.filter((item) => item.kind === 'post').map((item) => item.id);
    const reelIds = page.items.filter((item) => item.kind === 'reel').map((item) => item.id);
    const [posts, reels] = await Promise.all([
      postIds.length
        ? this.prisma.post.findMany({
            where: {
              id: { in: postIds },
              deletedAt: null,
              archivedAt: null,
              ...publicModerationWhere()
            },
            include: this.postInclude(userId)
          })
        : [],
      reelIds.length
        ? this.prisma.reel.findMany({
            where: {
              id: { in: reelIds },
              deletedAt: null,
              archivedAt: null,
              ...publicModerationWhere()
            },
            include: {
              media: true,
              author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
              likes: { where: { userId }, select: { id: true } },
              hashtags: { include: { hashtag: true } },
              _count: { select: { likes: true, comments: true } }
            }
          })
        : []
    ]);
    const postsMedia = await this.attachMediaUrls(posts);
    const reelsMedia = await Promise.all(reels.map((reel) => this.attachReelMediaUrl(reel)));
    const postMap = new Map(postsMedia.map((row) => [row.id, row]));
    const reelMap = new Map(reelsMedia.map((row) => [row.id, row]));
    const out: Array<Record<string, unknown>> = [];
    for (const item of page.items) {
      if (item.kind === 'post') {
        const row = postMap.get(item.id);
        if (!row) continue;
        out.push({
          kind: 'post',
          ...row,
          recommendationReason: item.reason,
          recommendationSource: item.source
        });
      } else {
        const row = reelMap.get(item.id);
        if (!row) continue;
        out.push({
          kind: 'reel',
          ...row,
          recommendationReason: item.reason,
          recommendationSource: item.source
        });
      }
    }
    if (page.nextCursor && out.length) {
      const last = out[out.length - 1];
      if (last) out[out.length - 1] = { ...last, recommendationCursor: page.nextCursor };
    }
    return out;
  }

  private postInclude(userId: string) {
    return {
      media: { include: { media: true }, orderBy: { sortOrder: 'asc' as const } },
      author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      likes: { where: { userId }, select: { id: true } },
      bookmarks: { where: { userId }, select: { id: true } },
      hashtags: { include: { hashtag: true } },
      _count: { select: { likes: true, comments: true } }
    };
  }
}
