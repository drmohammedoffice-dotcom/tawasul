import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { STUB_IMAGE_MAX_BYTES, STUB_VIDEO_MAX_BYTES } from '../../common/automated-test';
import { PrismaService } from '../prisma/prisma.service';
import { captionTokens } from './engine/events';
import type { CandidateSource, ContentKind, RankCandidate } from './engine/types';
import { growthScore } from './engine/rank';
import { discoveryModerationWhere } from '../moderation/moderation.visibility';
import { RecommendationFeatureService } from './feature.service';
import { InterestProfileService } from './interest-profile.service';

const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const POOL = 80;

type ViewerPack = {
  userId: string;
  country: string;
  feedMode: 'personalized' | 'following_chronological';
  personalization: boolean;
  clearedAt: Date | null;
  followingIds: string[];
  blockedIds: string[];
  closeOwnerIds: Set<string>;
  hidden: Set<string>;
  mutedAuthors: Set<string>;
  reported: Set<string>;
  halfLifeDays: number;
};

type Row = {
  id: string;
  kind: ContentKind;
  authorId: string;
  createdAt: Date;
  caption: string | null;
  viewCount: number;
  shareCount: number;
  likeCount: number;
  commentCount: number;
  saveCount: number;
  tags: string[];
  authorCreatedAt: Date;
  authorCountry: string | null;
  privateAuthor: boolean;
  hasPlayableMedia: boolean;
  stubMedia: boolean;
  sources: CandidateSource[];
};

@Injectable()
export class CandidateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly interests: InterestProfileService,
    @Optional() private readonly features?: RecommendationFeatureService
  ) {}

  async viewer(userId: string, halfLifeDays: number): Promise<ViewerPack> {
    const [me, follows, blocks, closes, mutes, reports, pref] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { countryCode: true }
      }),
      this.prisma.follow.findMany({
        where: { followerId: userId, status: 'accepted' },
        select: { followingId: true }
      }),
      this.prisma.userBlock.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        select: { blockerId: true, blockedId: true }
      }),
      this.prisma.closeFriend.findMany({
        where: { friendId: userId },
        select: { ownerId: true }
      }),
      this.prisma.recommendationMute.findMany({
        where: { userId },
        select: { targetType: true, targetId: true }
      }),
      this.prisma.report.findMany({
        where: { reporterId: userId, targetType: { in: ['post', 'reel', 'story', 'user'] } },
        select: { targetType: true, targetId: true },
        take: 200
      }),
      this.interests.preference(userId)
    ]);
    const blockedIds: string[] = [];
    for (const row of blocks) {
      if (row.blockerId === userId) blockedIds.push(row.blockedId);
      if (row.blockedId === userId) blockedIds.push(row.blockerId);
    }
    const hidden = new Set<string>();
    const mutedAuthors = new Set<string>();
    for (const mute of mutes) {
      if (mute.targetType === 'author') mutedAuthors.add(mute.targetId);
      else hidden.add(`${mute.targetType}:${mute.targetId}`);
    }
    const reported = new Set(reports.map((row) => `${row.targetType}:${row.targetId}`));
    return {
      userId,
      country: (me?.countryCode || 'IQ').toUpperCase(),
      feedMode: pref.feedMode === 'following_chronological' ? 'following_chronological' : 'personalized',
      personalization: pref.personalizationEnabled !== false,
      clearedAt: pref.clearedAt,
      followingIds: follows.map((row) => row.followingId),
      blockedIds,
      closeOwnerIds: new Set(closes.map((row) => row.ownerId)),
      hidden,
      mutedAuthors,
      reported,
      halfLifeDays
    };
  }

  async homeCandidates(viewer: ViewerPack): Promise<RankCandidate[]> {
    const since = new Date(Date.now() - LOOKBACK_MS);
    const authorIds = [viewer.userId, ...viewer.followingIds].filter((id) => !viewer.blockedIds.includes(id));
    const [followingPosts, followingReels, interestPosts, freshPosts, freshReels, newPosts] = await Promise.all([
      this.posts(viewer, { authorId: { in: authorIds }, createdAt: { gte: since } }, 'following'),
      this.reels(viewer, { authorId: { in: authorIds }, createdAt: { gte: since } }, 'following'),
      this.interestPosts(viewer, since),
      this.posts(
        viewer,
        {
          createdAt: { gte: new Date(Date.now() - 36 * 60 * 60 * 1000) },
          viewCount: { lte: 30 },
          author: this.publicAuthor(viewer)
        },
        'fresh'
      ),
      this.reels(
        viewer,
        {
          createdAt: { gte: new Date(Date.now() - 36 * 60 * 60 * 1000) },
          viewCount: { lte: 30 },
          author: this.publicAuthor(viewer)
        },
        'fresh'
      ),
      this.posts(
        viewer,
        {
          createdAt: { gte: since },
          author: { ...this.publicAuthor(viewer), createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }
        },
        'new_account'
      )
    ]);
    const similar = await this.similarPosts(viewer, since);
    const trending = await this.trendingRows(viewer);
    return this.finish(viewer, [
      ...followingPosts,
      ...followingReels,
      ...interestPosts,
      ...freshPosts,
      ...freshReels,
      ...newPosts,
      ...similar,
      ...trending
    ]);
  }

  async exploreCandidates(viewer: ViewerPack): Promise<RankCandidate[]> {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const where = { createdAt: { gte: since }, author: this.publicAuthor(viewer) };
    const [posts, reels, trending] = await Promise.all([
      this.posts(viewer, where, 'fresh'),
      this.reels(viewer, where, 'fresh'),
      this.trendingRows(viewer)
    ]);
    return this.finish(viewer, [...posts, ...reels, ...trending]);
  }

  async reelCandidates(viewer: ViewerPack): Promise<RankCandidate[]> {
    const since = new Date(Date.now() - LOOKBACK_MS);
    const authorIds = [viewer.userId, ...viewer.followingIds].filter((id) => !viewer.blockedIds.includes(id));
    const [followed, fresh, trending] = await Promise.all([
      this.reels(viewer, { authorId: { in: authorIds }, createdAt: { gte: since } }, 'following'),
      this.reels(
        viewer,
        { createdAt: { gte: new Date(Date.now() - 72 * 60 * 60 * 1000) }, author: this.publicAuthor(viewer) },
        'fresh'
      ),
      this.trendingRows(viewer)
    ]);
    return this.finish(
      viewer,
      [...followed, ...fresh, ...trending].filter((row) => row.kind === 'reel')
    );
  }

  async hashtagCandidates(viewer: ViewerPack, tag: string): Promise<RankCandidate[]> {
    const clean = tag.toLowerCase();
    const posts = await this.posts(
      viewer,
      {
        author: this.publicAuthor(viewer),
        hashtags: { some: { hashtag: { tag: clean } } }
      },
      'interest'
    );
    const reels = await this.reels(
      viewer,
      {
        author: this.publicAuthor(viewer),
        hashtags: { some: { hashtag: { tag: clean } } }
      },
      'interest'
    );
    return this.finish(viewer, [...posts, ...reels]);
  }

  async people(viewer: ViewerPack, vectorTopics: string[]) {
    const excluded = new Set([viewer.userId, ...viewer.followingIds, ...viewer.blockedIds, ...viewer.mutedAuthors]);
    const fof = viewer.followingIds.length
      ? await this.prisma.follow.findMany({
          where: {
            followerId: { in: viewer.followingIds.slice(0, 50) },
            status: 'accepted',
            followingId: { notIn: [...excluded] },
            following: { isAutomatedTest: false }
          },
          select: { followingId: true }
        })
      : [];
    const mutuals = new Map<string, number>();
    for (const row of fof) mutuals.set(row.followingId, (mutuals.get(row.followingId) ?? 0) + 1);
    const topicUsers = vectorTopics.length
      ? await this.prisma.userInterest.findMany({
          where: {
            interestKey: { in: vectorTopics.slice(0, 12) },
            userId: { notIn: [...excluded] },
            user: { isAutomatedTest: false }
          },
          select: { userId: true, interestKey: true },
          take: 200
        })
      : [];
    const overlap = new Map<string, number>();
    for (const row of topicUsers) overlap.set(row.userId, (overlap.get(row.userId) ?? 0) + 1);
    const ids = [...new Set([...mutuals.keys(), ...overlap.keys()])].slice(0, 80);
    if (!ids.length) return [];
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: ids },
        isAutomatedTest: false,
        blocksReceived: { none: { blockerId: viewer.userId } },
        blocksInitiated: { none: { blockedId: viewer.userId } }
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true, isPrivate: true, countryCode: true }
    });
    return users
      .map((user) => {
        const shared = mutuals.get(user.id) ?? 0;
        const topics = overlap.get(user.id) ?? 0;
        const country = (user.countryCode || '').toUpperCase() === viewer.country ? 1 : 0;
        const score = shared * 0.5 + topics * 0.4 + country * 0.15;
        const reason = topics > shared ? 'shared_interests' : shared > 0 ? 'followed_by_people_you_follow' : 'same_country';
        return {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          isPrivate: user.isPrivate,
          score,
          reason
        };
      })
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, 20)
      .map(({ score: _score, ...row }) => row);
  }

  async trendingTopics(): Promise<Array<{ tag: string; recentUsers: number; previousUsers: number; growth: number }>> {
    const rows = await this.prisma.$queryRaw<Array<{ tag: string; recent: number; previous: number }>>(Prisma.sql`
      SELECT tag, SUM(recent)::int AS recent, SUM(previous)::int AS previous
      FROM (
        SELECT h.tag,
          COUNT(DISTINCT e."userId") FILTER (WHERE e."createdAt" >= NOW() - INTERVAL '6 hours') AS recent,
          COUNT(DISTINCT e."userId") FILTER (
            WHERE e."createdAt" < NOW() - INTERVAL '6 hours'
              AND e."createdAt" >= NOW() - INTERVAL '12 hours'
          ) AS previous
        FROM "RecommendationEvent" e
        JOIN "PostHashtag" ph ON ph."postId" = e."contentId" AND e."contentType" = 'post'
        JOIN "Hashtag" h ON h.id = ph."hashtagId"
        WHERE e."createdAt" >= NOW() - INTERVAL '12 hours'
          AND e."eventType" IN ('qualified_view', 'like', 'save', 'share', 'comment', 'video_complete')
        GROUP BY h.tag
        UNION ALL
        SELECT h.tag,
          COUNT(DISTINCT e."userId") FILTER (WHERE e."createdAt" >= NOW() - INTERVAL '6 hours') AS recent,
          COUNT(DISTINCT e."userId") FILTER (
            WHERE e."createdAt" < NOW() - INTERVAL '6 hours'
              AND e."createdAt" >= NOW() - INTERVAL '12 hours'
          ) AS previous
        FROM "RecommendationEvent" e
        JOIN "ReelHashtag" rh ON rh."reelId" = e."contentId" AND e."contentType" = 'reel'
        JOIN "Hashtag" h ON h.id = rh."hashtagId"
        WHERE e."createdAt" >= NOW() - INTERVAL '12 hours'
          AND e."eventType" IN ('qualified_view', 'like', 'save', 'share', 'comment', 'video_complete')
        GROUP BY h.tag
      ) buckets
      GROUP BY tag
    `);
    return rows
      .map((row) => ({
        tag: row.tag,
        recentUsers: Number(row.recent) || 0,
        previousUsers: Number(row.previous) || 0,
        growth: growthScore(Number(row.recent) || 0, Number(row.previous) || 0)
      }))
      .filter((row) => row.growth > 0)
      .sort((a, b) => b.growth - a.growth || b.recentUsers - a.recentUsers)
      .slice(0, 20);
  }

  private publicAuthor(viewer: ViewerPack) {
    return {
      isPrivate: false,
      isAutomatedTest: false,
      id: { notIn: [viewer.userId, ...viewer.blockedIds, ...viewer.mutedAuthors] },
      blocksReceived: { none: { blockerId: viewer.userId } },
      blocksInitiated: { none: { blockedId: viewer.userId } }
    };
  }

  private async interestPosts(viewer: ViewerPack, since: Date): Promise<Row[]> {
    const declared = await this.prisma.userInterest.findMany({
      where: { userId: viewer.userId },
      select: { interestKey: true }
    });
    const tags = declared.map((row) => row.interestKey.toLowerCase());
    if (!tags.length) return [];
    return this.posts(
      viewer,
      {
        createdAt: { gte: since },
        author: this.publicAuthor(viewer),
        OR: [
          { hashtags: { some: { hashtag: { tag: { in: tags } } } } },
          ...tags.map((tag) => ({ caption: { contains: tag, mode: 'insensitive' as const } }))
        ]
      },
      'interest'
    );
  }

  private async similarPosts(viewer: ViewerPack, since: Date): Promise<Row[]> {
    if (!viewer.followingIds.length) return [];
    const tags = await this.prisma.postHashtag.findMany({
      where: { post: { authorId: { in: viewer.followingIds.slice(0, 40) }, deletedAt: null } },
      select: { hashtag: { select: { tag: true } } },
      take: 30
    });
    const keys = [...new Set(tags.map((row) => row.hashtag.tag))];
    if (!keys.length) return [];
    return this.posts(
      viewer,
      {
        createdAt: { gte: since },
        authorId: { notIn: [viewer.userId, ...viewer.followingIds, ...viewer.blockedIds] },
        author: this.publicAuthor(viewer),
        hashtags: { some: { hashtag: { tag: { in: keys } } } }
      },
      'similar'
    );
  }

  private async trendingRows(viewer: ViewerPack): Promise<Row[]> {
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const previousSince = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const [recent, previous] = await Promise.all([
      this.prisma.recommendationEvent.groupBy({
        by: ['contentType', 'contentId'],
        where: {
          createdAt: { gte: since },
          contentId: { not: null },
          eventType: { in: ['qualified_view', 'like', 'save', 'share', 'comment', 'video_complete', 'replay'] }
        },
        _count: { _all: true }
      }),
      this.prisma.recommendationEvent.groupBy({
        by: ['contentType', 'contentId'],
        where: {
          createdAt: { gte: previousSince, lt: since },
          contentId: { not: null },
          eventType: { in: ['qualified_view', 'like', 'save', 'share', 'comment', 'video_complete', 'replay'] }
        },
        _count: { _all: true }
      })
    ]);
    const prev = new Map<string, number>();
    for (const row of previous) {
      if (row.contentId) prev.set(`${row.contentType}:${row.contentId}`, row._count._all);
    }
    const rising = recent.filter((row) => {
      if (!row.contentId) return false;
      const before = prev.get(`${row.contentType}:${row.contentId}`) ?? 0;
      return growthScore(row._count._all, before) > 0;
    });
    const postIds = rising.filter((row) => row.contentType === 'post' && row.contentId).map((row) => row.contentId as string);
    const reelIds = rising.filter((row) => row.contentType === 'reel' && row.contentId).map((row) => row.contentId as string);
    const [posts, reels] = await Promise.all([
      postIds.length
        ? this.posts(viewer, { id: { in: postIds.slice(0, 40) }, author: this.publicAuthor(viewer) }, 'trending')
        : [],
      reelIds.length
        ? this.reels(viewer, { id: { in: reelIds.slice(0, 40) }, author: this.publicAuthor(viewer) }, 'trending')
        : []
    ]);
    const windows = new Map<string, { recent: number; previous: number }>();
    for (const row of rising) {
      if (!row.contentId) continue;
      windows.set(row.contentId, {
        recent: row._count._all,
        previous: prev.get(`${row.contentType}:${row.contentId}`) ?? 0
      });
    }
    for (const row of [...posts, ...reels]) {
      const window = windows.get(row.id);
      if (!window) continue;
      (row as Row & { recentEngagement?: number }).recentEngagement = window.recent;
      (row as Row & { previousEngagement?: number }).previousEngagement = window.previous;
    }
    return [...posts, ...reels];
  }

  private async attachUnderstoodTopics(viewer: ViewerPack, rows: Row[]): Promise<void> {
    if (!this.features || !viewer.personalization) return;
    try {
      const mode = await this.features.modeFor(viewer.userId);
      if (!mode.hybrid) return;
      const ids = rows.map((row) => row.id);
      const found = await this.prisma.contentUnderstanding.findMany({
        where: { contentId: { in: ids }, status: 'ready', quality: 'ok' },
        select: { contentType: true, contentId: true, topics: true }
      });
      const extra = new Map<string, string[]>();
      for (const row of found) {
        if (!Array.isArray(row.topics)) continue;
        const keys = row.topics
          .map((topic) => (topic && typeof topic === 'object' && 'key' in topic ? String(topic.key) : ''))
          .filter((key) => key.length > 0);
        extra.set(`${row.contentType}:${row.contentId}`, keys);
      }
      for (const row of rows) {
        for (const key of extra.get(`${row.kind}:${row.id}`) || []) {
          if (!row.tags.includes(key)) row.tags.push(key);
        }
      }
    } catch {
      /* ranking continues with hashtags when analysis storage is unavailable */
    }
  }

  private async posts(
    viewer: ViewerPack,
    where: Prisma.PostWhereInput,
    source: CandidateSource
  ): Promise<Row[]> {
    const idFilter = this.notHidden(where, viewer, 'post');
    const rest = { ...where };
    delete rest.id;
    const rows = await this.prisma.post.findMany({
      where: {
        deletedAt: null,
        archivedAt: null,
        ...discoveryModerationWhere(),
        ...rest,
        ...(idFilter !== undefined ? { id: idFilter } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: POOL,
      select: {
        id: true,
        authorId: true,
        caption: true,
        createdAt: true,
        viewCount: true,
        shareCount: true,
        author: { select: { createdAt: true, countryCode: true, isPrivate: true } },
        hashtags: { select: { hashtag: { select: { tag: true } } } },
        media: { select: { media: { select: { sizeBytes: true, mimeType: true, processingStatus: true } } } },
        _count: { select: { likes: true, comments: true, bookmarks: true } }
      }
    });
    return rows.map((row) => this.toRow(row, 'post', source, viewer));
  }

  private async reels(
    viewer: ViewerPack,
    where: Prisma.ReelWhereInput,
    source: CandidateSource
  ): Promise<Row[]> {
    const idFilter = this.notHidden(where, viewer, 'reel');
    const rest = { ...where };
    delete rest.id;
    const rows = await this.prisma.reel.findMany({
      where: {
        deletedAt: null,
        archivedAt: null,
        ...discoveryModerationWhere(),
        media: {
          processingStatus: { in: ['ready', 'processing', 'uploaded'] },
          sizeBytes: { gt: STUB_VIDEO_MAX_BYTES }
        },
        ...rest,
        ...(idFilter !== undefined ? { id: idFilter } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: POOL,
      select: {
        id: true,
        authorId: true,
        caption: true,
        createdAt: true,
        viewCount: true,
        shareCount: true,
        author: { select: { createdAt: true, countryCode: true, isPrivate: true } },
        hashtags: { select: { hashtag: { select: { tag: true } } } },
        media: { select: { sizeBytes: true, mimeType: true, processingStatus: true } },
        _count: { select: { likes: true, comments: true } }
      }
    });
    return rows.map((row) =>
      this.toRow(
        {
          ...row,
          media: [{ media: row.media }],
          _count: { likes: row._count.likes, comments: row._count.comments, bookmarks: 0 }
        },
        'reel',
        source,
        viewer
      )
    );
  }

  private notHidden(
    where: { id?: unknown },
    viewer: ViewerPack,
    kind: 'post' | 'reel'
  ): Prisma.StringFilter | string | undefined {
    const hiddenIds = [...viewer.hidden]
      .filter((key) => key.startsWith(`${kind}:`))
      .map((key) => key.slice(kind.length + 1));
    const reportedIds = [...viewer.reported]
      .filter((key) => key.startsWith(`${kind}:`))
      .map((key) => key.slice(kind.length + 1));
    const banned = [...hiddenIds, ...reportedIds];
    if (!banned.length) return (where.id as Prisma.StringFilter | string | undefined) ?? undefined;
    const current = where.id;
    if (current && typeof current === 'object' && current && 'in' in (current as object)) {
      const allowed = ((current as { in: string[] }).in || []).filter((id) => !banned.includes(id));
      return { in: allowed.length ? allowed : ['__none__'] };
    }
    return { notIn: banned.slice(0, 200) };
  }

  private toRow(
    row: {
      id: string;
      authorId: string;
      caption: string | null;
      createdAt: Date;
      viewCount: number;
      shareCount: number;
      author: { createdAt: Date; countryCode: string | null; isPrivate: boolean };
      hashtags: Array<{ hashtag: { tag: string } }>;
      media: Array<{ media: { sizeBytes: number | null; mimeType: string | null; processingStatus: string } | null }>;
      _count: { likes: number; comments: number; bookmarks: number };
    },
    kind: ContentKind,
    source: CandidateSource,
    _viewer: ViewerPack
  ): Row {
    const media = row.media.map((item) => item.media).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const stub =
      media.length === 0 ||
      media.every((item) => {
        const bytes = Number(item.sizeBytes || 0);
        const mime = String(item.mimeType || '');
        if (mime.startsWith('image/') && bytes > 0 && bytes <= STUB_IMAGE_MAX_BYTES) return true;
        if (mime.startsWith('video/') && bytes > 0 && bytes <= STUB_VIDEO_MAX_BYTES) return true;
        return false;
      });
    const playable = media.some((item) => item.processingStatus !== 'failed' && item.processingStatus !== 'deleted');
    return {
      id: row.id,
      kind,
      authorId: row.authorId,
      createdAt: row.createdAt,
      caption: row.caption,
      viewCount: row.viewCount,
      shareCount: row.shareCount,
      likeCount: row._count.likes,
      commentCount: row._count.comments,
      saveCount: row._count.bookmarks,
      tags: row.hashtags.map((item) => item.hashtag.tag.toLowerCase()),
      authorCreatedAt: row.author.createdAt,
      authorCountry: row.author.countryCode,
      privateAuthor: row.author.isPrivate,
      hasPlayableMedia: playable && media.length > 0,
      stubMedia: stub,
      sources: [source]
    };
  }

  private async finish(viewer: ViewerPack, rows: Array<Row & { recentEngagement?: number; previousEngagement?: number }>) {
    const merged = new Map<string, Row & { recentEngagement?: number; previousEngagement?: number }>();
    for (const row of rows) {
      if (viewer.mutedAuthors.has(row.authorId) || viewer.blockedIds.includes(row.authorId)) continue;
      const prev = merged.get(row.id);
      if (!prev) {
        merged.set(row.id, row);
        continue;
      }
      for (const source of row.sources) {
        if (!prev.sources.includes(source)) prev.sources.push(source);
      }
      prev.recentEngagement = Math.max(prev.recentEngagement ?? 0, row.recentEngagement ?? 0);
      prev.previousEngagement = Math.max(prev.previousEngagement ?? 0, row.previousEngagement ?? 0);
    }
    const list = [...merged.values()].slice(0, 200);
    await this.attachUnderstoodTopics(viewer, list);
    const ids = list.map((row) => row.id);
    const windows = await this.eventWindows(ids, viewer.clearedAt);
    const now = Date.now();
    return list.map((row) => {
      const stats = windows.get(row.id);
      const candidate: RankCandidate = {
        id: row.id,
        kind: row.kind,
        authorId: row.authorId,
        createdAtMs: row.createdAt.getTime(),
        sources: row.sources,
        tags: row.tags,
        primaryTag: row.tags[0] ?? null,
        captionTokens: captionTokens(row.caption),
        viewCount: row.viewCount,
        likeCount: row.likeCount,
        commentCount: row.commentCount,
        saveCount: row.saveCount,
        shareCount: row.shareCount,
        impressionCount: stats?.impression ?? 0,
        qualifiedViewCount: stats?.qualified ?? 0,
        completeCount: stats?.complete ?? 0,
        replayCount: stats?.replay ?? 0,
        negativeCount: stats?.negative ?? 0,
        recentEngagement: row.recentEngagement ?? stats?.recent ?? 0,
        previousEngagement: row.previousEngagement ?? stats?.previous ?? 0,
        following: viewer.followingIds.includes(row.authorId),
        closeFriend: viewer.closeOwnerIds.has(row.authorId),
        sameCountry: (row.authorCountry || '').toUpperCase() === viewer.country,
        authorAgeDays: Math.max(0, (now - row.authorCreatedAt.getTime()) / 86_400_000),
        authorImpressionCount: stats?.authorImpressions ?? 0,
        hasPlayableMedia: row.hasPlayableMedia,
        stubMedia: row.stubMedia,
        privateAuthor: row.privateAuthor,
        blocked: false,
        viewerReported: viewer.reported.has(`${row.kind}:${row.id}`),
        hidden: viewer.hidden.has(`${row.kind}:${row.id}`),
        deleted: false,
        expired: false,
        archived: false,
        seen: false,
        storyAudience: 'n/a',
        viewerIsCloseFriend: viewer.closeOwnerIds.has(row.authorId),
        self: row.authorId === viewer.userId
      };
      return candidate;
    });
  }

  private async eventWindows(ids: string[], clearedAt: Date | null) {
    const map = new Map<
      string,
      {
        impression: number;
        qualified: number;
        complete: number;
        replay: number;
        negative: number;
        recent: number;
        previous: number;
        authorImpressions: number;
      }
    >();
    if (!ids.length) return map;
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const floor = clearedAt && clearedAt > since ? clearedAt : since;
    const grouped = await this.prisma.recommendationEvent.groupBy({
      by: ['contentId', 'eventType'],
      where: {
        contentId: { in: ids },
        createdAt: { gte: floor },
        eventType: {
          in: [
            'impression',
            'qualified_view',
            'video_complete',
            'replay',
            'not_interested',
            'hide_post',
            'like',
            'save',
            'share',
            'comment'
          ]
        }
      },
      _count: { _all: true }
    });
    for (const row of grouped) {
      if (!row.contentId) continue;
      const stats = map.get(row.contentId) ?? {
        impression: 0,
        qualified: 0,
        complete: 0,
        replay: 0,
        negative: 0,
        recent: 0,
        previous: 0,
        authorImpressions: 0
      };
      if (row.eventType === 'impression') stats.impression += row._count._all;
      if (row.eventType === 'qualified_view') stats.qualified += row._count._all;
      if (row.eventType === 'video_complete') stats.complete += row._count._all;
      if (row.eventType === 'replay') stats.replay += row._count._all;
      if (row.eventType === 'not_interested' || row.eventType === 'hide_post') stats.negative += row._count._all;
      if (['qualified_view', 'like', 'save', 'share', 'comment', 'video_complete'].includes(row.eventType)) {
        stats.recent += row._count._all;
      }
      map.set(row.contentId, stats);
    }
    return map;
  }
}
