import { Injectable, Logger, Optional } from '@nestjs/common';
import { MediaStorageService } from '../media/media.storage';
import {
  mediaBytesAllowed,
  publicModerationWhere
} from '../moderation/moderation.visibility';
import { RecommendationEventsService } from '../recommendations/events.service';
import { RecommendationFeatureService } from '../recommendations/feature.service';
import { SemanticSearchService } from '../recommendations/semantic-search.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
    private readonly recommendationEvents: RecommendationEventsService,
    private readonly features: RecommendationFeatureService,
    @Optional() private readonly semanticSearch?: SemanticSearchService
  ) {}

  async search(viewerId: string, q: string, limit = 20) {
    const query = q.trim().slice(0, 80);
    if (query.length < 1) {
      return { users: [], posts: [], hashtags: [], taggedPosts: [] };
    }
    void this.recommendationEvents.recordSearch(viewerId, query);
    const tagQuery = query.replace(/^#+/, '').trim();
    const take = Math.min(Math.max(limit, 1), 40);

    const blocked = await this.prisma.userBlock.findMany({
      where: {
        OR: [{ blockerId: viewerId }, { blockedId: viewerId }]
      },
      select: { blockerId: true, blockedId: true }
    });
    const blockedIds = new Set<string>();
    for (const row of blocked) {
      if (row.blockerId === viewerId) blockedIds.add(row.blockedId);
      if (row.blockedId === viewerId) blockedIds.add(row.blockerId);
    }

    // Search keeps fixture accounts findable by exact intent (ACL tests + username lookup).
    // Explore/Reels hide isAutomatedTest — that is the product discovery surface.
    const usersRaw = await this.prisma.user.findMany({
      where: {
        id: { notIn: [...blockedIds] },
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } }
        ]
      },
      take,
      orderBy: { username: 'asc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        isPrivate: true,
        bio: true
      }
    });

    const followAccepted = await this.prisma.follow.findMany({
      where: {
        followerId: viewerId,
        status: 'accepted',
        followingId: { in: usersRaw.filter((u) => u.isPrivate).map((u) => u.id) }
      },
      select: { followingId: true }
    });
    const canSeePrivateBio = new Set(followAccepted.map((f) => f.followingId));
    const users = usersRaw.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      isPrivate: u.isPrivate,
      // Do not leak private bios to non-followers.
      bio: !u.isPrivate || u.id === viewerId || canSeePrivateBio.has(u.id) ? u.bio : null
    }));

    const visibilityOr = [
      { author: { isPrivate: false } },
      { authorId: viewerId },
      {
        author: {
          isPrivate: true,
          followers: { some: { followerId: viewerId, status: 'accepted' as const } }
        }
      }
    ];

    const ocrMatches = await this.prisma.contentUnderstanding.findMany({
      where: {
        contentType: 'post',
        status: 'ready',
        ocrSearch: { contains: query, mode: 'insensitive' }
      },
      take,
      select: { contentId: true }
    });
    const ocrIds = ocrMatches.map((row) => row.contentId);

    const postsRaw = await this.prisma.post.findMany({
      where: {
        deletedAt: null,
        ...publicModerationWhere(),
        authorId: { notIn: [...blockedIds] },
        AND: [
          { OR: visibilityOr },
          {
            OR: [
              { caption: { contains: query, mode: 'insensitive' } },
              ...(ocrIds.length ? [{ id: { in: ocrIds } }] : [])
            ]
          }
        ]
      },
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        media: { include: { media: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
        _count: { select: { likes: true, comments: true } }
      }
    });

    let semanticMeta: {
      mode: 'off' | 'shadow' | 'live';
      hitCount: number;
      topScore: number | null;
    } = { mode: 'off', hitCount: 0, topScore: null };

    let mergedRaw = postsRaw;
    const featureMode = await this.features.modeFor(viewerId);
    if (this.semanticSearch && (featureMode.semanticLive || featureMode.semanticShadow)) {
      if (featureMode.semanticLive) {
        try {
          const probe = await this.semanticSearch.searchPublicPosts(viewerId, query, take);
          semanticMeta = {
            mode: 'live',
            hitCount: probe.hits.length,
            topScore: probe.hits[0]?.score ?? null
          };
          if (probe.hits.length) {
            const lexicalIds = postsRaw.map((p) => p.id);
            const semanticIds = probe.hits.map((h) => h.contentId);
            const mergedIds = this.semanticSearch.mergePostIds(lexicalIds, semanticIds, take);
            const missing = mergedIds.filter((id) => !lexicalIds.includes(id));
            if (missing.length) {
              const extra = await this.prisma.post.findMany({
                where: {
                  deletedAt: null,
                  id: { in: missing },
                  ...publicModerationWhere(),
                  authorId: { notIn: [...blockedIds] },
                  OR: visibilityOr
                },
                include: {
                  author: {
                    select: { id: true, username: true, displayName: true, avatarUrl: true }
                  },
                  media: { include: { media: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
                  _count: { select: { likes: true, comments: true } }
                }
              });
              const byId = new Map([...postsRaw, ...extra].map((p) => [p.id, p]));
              mergedRaw = mergedIds
                .map((id) => byId.get(id))
                .filter((p): p is (typeof postsRaw)[number] => Boolean(p));
            }
          }
        } catch (err) {
          this.logger.warn(
            `semantic live search skipped: ${err instanceof Error ? err.message : 'error'}`
          );
        }
      } else {
        semanticMeta = { mode: 'shadow', hitCount: 0, topScore: null };
        void this.semanticSearch.searchPublicPosts(viewerId, query, take).catch((err) => {
          this.logger.debug(
            `semantic shadow skipped: ${err instanceof Error ? err.message : 'error'}`
          );
        });
      }
    }

    const posts = await this.attachSearchMedia(mergedRaw);

    const hashtagRows = tagQuery
      ? await this.prisma.hashtag.findMany({
          where: { tag: { contains: tagQuery.toLowerCase(), mode: 'insensitive' } },
          take: Math.min(take, 20),
          orderBy: { tag: 'asc' },
          select: { id: true, tag: true }
        })
      : [];

    // Count only publicly visible posts/reels so HIDDEN spam tags don't surface.
    const hashtags = (
      await Promise.all(
        hashtagRows.map(async (h) => {
          const [postCount, reelCount] = await Promise.all([
            this.prisma.postHashtag.count({
              where: {
                hashtagId: h.id,
                post: { deletedAt: null, archivedAt: null, ...publicModerationWhere() }
              }
            }),
            this.prisma.reelHashtag.count({
              where: {
                hashtagId: h.id,
                reel: { deletedAt: null, archivedAt: null, ...publicModerationWhere() }
              }
            })
          ]);
          return {
            id: h.id,
            tag: h.tag,
            _count: { posts: postCount, reels: reelCount }
          };
        })
      )
    ).filter((h) => h._count.posts + h._count.reels > 0);

    const taggedPostsRaw =
      tagQuery.length > 0
        ? await this.prisma.post.findMany({
            where: {
              deletedAt: null,
              archivedAt: null,
              ...publicModerationWhere(),
              authorId: { notIn: [...blockedIds] },
              hashtags: {
                some: { hashtag: { tag: { equals: tagQuery.toLowerCase(), mode: 'insensitive' } } }
              },
              OR: [
                { author: { isPrivate: false } },
                { authorId: viewerId },
                {
                  author: {
                    isPrivate: true,
                    followers: { some: { followerId: viewerId, status: 'accepted' } }
                  }
                }
              ]
            },
            take,
            orderBy: { createdAt: 'desc' },
            include: {
              author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
              media: { include: { media: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
              hashtags: { include: { hashtag: true } },
              _count: { select: { likes: true, comments: true } }
            }
          })
        : [];

    const taggedPosts = await this.attachSearchMedia(taggedPostsRaw);

    return {
      users,
      posts,
      hashtags,
      taggedPosts,
      query,
      semantic: semanticMeta
    };
  }

  private async attachSearchMedia<
    T extends {
      moderationStatus?: string | null;
      media: Array<{
        media: { id: string; storageKey: string; [k: string]: unknown };
      }>;
    }
  >(rows: T[]): Promise<T[]> {
    return Promise.all(
      rows.map(async (post) => {
        const allow = mediaBytesAllowed(post.moderationStatus);
        return {
          ...post,
          media: await Promise.all(
            post.media.map(async (row) => {
              if (!allow) {
                return { ...row, media: { ...row.media, secureUrl: null, mediaRedacted: true } };
              }
              try {
                const secureUrl = await this.mediaStorage.createReadUrl(
                  row.media.id,
                  row.media.storageKey
                );
                return { ...row, media: { ...row.media, secureUrl, mediaRedacted: false } };
              } catch {
                return { ...row, media: { ...row.media, secureUrl: null, mediaRedacted: false } };
              }
            })
          )
        };
      })
    );
  }
}
