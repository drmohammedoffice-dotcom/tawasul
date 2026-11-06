import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { CandidateService } from './candidate.service';
import { RecommendationConfigService } from './config.service';
import { captionTokens } from './engine/events';
import {
  distribution,
  emptyInterest,
  orderStoryIds,
  pageByCursor,
  publicReason,
  rankCandidates,
  RankingRegistry
} from './engine/rank';
import { rankStaged } from './engine/stages';
import type { ContentKind, RankCandidate } from './engine/types';
import { RecommendationFeatureService } from './feature.service';
import { InterestProfileService } from './interest-profile.service';
import { RecommendationMetricsService } from './metrics.service';

export type PlannedItem = {
  id: string;
  kind: 'post' | 'reel';
  reason: string;
  source: string;
};

export type PlanPage = {
  items: PlannedItem[];
  nextCursor: string | null;
  version: string;
};

type CacheShape = { items: PlannedItem[]; version: string };

@Injectable()
export class RecommendationPlannerService {
  private readonly logger = new Logger(RecommendationPlannerService.name);

  constructor(
    private readonly candidates: CandidateService,
    private readonly interests: InterestProfileService,
    private readonly config: RecommendationConfigService,
    private readonly cache: CacheService,
    private readonly metrics: RecommendationMetricsService,
    private readonly features: RecommendationFeatureService
  ) {}

  async planHome(userId: string, cursor: string | undefined, limit: number): Promise<PlanPage | null> {
    if (cursor && !cursor.startsWith('rk1:')) return null;
    const viewer = await this.candidates.viewer(userId, 21);
    if (viewer.feedMode === 'following_chronological' || !viewer.personalization) return null;
    return this.plan(userId, 'feed', cursor, limit, () => this.candidates.homeCandidates(viewer), viewer.halfLifeDays);
  }

  async planExplore(userId: string, cursor: string | undefined, limit: number): Promise<PlanPage> {
    const { weights } = await this.config.active();
    const viewer = await this.candidates.viewer(userId, weights.interestHalfLifeDays);
    return this.plan(
      userId,
      'explore',
      cursor,
      limit,
      () => this.candidates.exploreCandidates(viewer),
      weights.interestHalfLifeDays
    );
  }

  async planReels(userId: string, cursor: string | undefined, limit: number): Promise<PlanPage | null> {
    if (cursor && !cursor.startsWith('rk1:') && cursor.includes('T')) return null;
    const { weights } = await this.config.active();
    const viewer = await this.candidates.viewer(userId, weights.interestHalfLifeDays);
    return this.plan(
      userId,
      'reels',
      cursor,
      limit,
      () => this.candidates.reelCandidates(viewer),
      weights.interestHalfLifeDays
    );
  }

  async planHashtag(userId: string, tag: string, cursor: string | undefined, limit: number): Promise<PlanPage> {
    const { weights } = await this.config.active();
    const viewer = await this.candidates.viewer(userId, weights.interestHalfLifeDays);
    return this.plan(
      userId,
      `hashtag:${tag.toLowerCase()}`,
      cursor,
      limit,
      () => this.candidates.hashtagCandidates(viewer, tag),
      weights.interestHalfLifeDays,
      'hashtag'
    );
  }

  async planPeople(userId: string) {
    const { weights } = await this.config.active();
    const viewer = await this.candidates.viewer(userId, weights.interestHalfLifeDays);
    const vector = viewer.personalization
      ? await this.interests.vectorFor(userId, weights.interestHalfLifeDays, viewer.clearedAt)
      : emptyInterest();
    const topics = Object.keys(vector.topics);
    return this.candidates.people(viewer, topics);
  }

  async planTrending() {
    return this.candidates.trendingTopics();
  }

  async orderStories(
    userId: string,
    stories: Array<{
      id: string;
      authorId: string;
      createdAt: Date;
      audience: 'everyone' | 'close_friends' | 'family';
      seen: boolean;
      hasMedia: boolean;
    }>
  ): Promise<string[]> {
    const { weights, version } = await this.config.active();
    const viewer = await this.candidates.viewer(userId, weights.interestHalfLifeDays);
    const vector = viewer.personalization
      ? await this.interests.vectorFor(userId, weights.interestHalfLifeDays, viewer.clearedAt)
      : emptyInterest();
    const now = Date.now();
    const candidates: RankCandidate[] = stories
      .filter((story) => !viewer.blockedIds.includes(story.authorId) && !viewer.mutedAuthors.has(story.authorId))
      .filter((story) => !viewer.hidden.has(`story:${story.id}`) && !viewer.reported.has(`story:${story.id}`))
      .map((story) => ({
        id: story.id,
        kind: 'story' as const,
        authorId: story.authorId,
        createdAtMs: story.createdAt.getTime(),
        sources: ['following'] as RankCandidate['sources'],
        tags: [],
        primaryTag: null,
        captionTokens: captionTokens(null),
        viewCount: 0,
        likeCount: 0,
        commentCount: 0,
        saveCount: 0,
        shareCount: 0,
        impressionCount: 0,
        qualifiedViewCount: 0,
        completeCount: 0,
        replayCount: 0,
        negativeCount: 0,
        recentEngagement: 0,
        previousEngagement: 0,
        following: story.authorId === userId || viewer.followingIds.includes(story.authorId),
        closeFriend: viewer.closeOwnerIds.has(story.authorId),
        sameCountry: false,
        authorAgeDays: 30,
        authorImpressionCount: 0,
        hasPlayableMedia: story.hasMedia,
        stubMedia: false,
        privateAuthor: false,
        blocked: false,
        viewerReported: false,
        hidden: false,
        deleted: false,
        expired: false,
        archived: false,
        seen: story.seen,
        storyAudience: story.audience,
        viewerIsCloseFriend: viewer.closeOwnerIds.has(story.authorId),
        self: story.authorId === userId
      }));
    const registry = new RankingRegistry(version);
    return orderStoryIds(candidates, vector, weights, now, registry.current());
  }

  async findRanked(userId: string, id: string): Promise<PlannedItem | null> {
    const { version } = await this.config.active();
    const viewer = await this.candidates.viewer(userId, 21);
    const mode = await this.features.modeFor(userId);
    const suffix = `:h${mode.hybrid ? 1 : 0}:m${mode.multiStage ? 1 : 0}`;
    const keys = ['explore', 'reels'];
    if (viewer.feedMode !== 'following_chronological' && viewer.personalization) keys.unshift('feed');
    for (const key of keys) {
      if (key === 'feed') await this.planHome(userId, undefined, 1);
      else if (key === 'explore') await this.planExplore(userId, undefined, 1);
      else await this.planReels(userId, undefined, 1);
      try {
        const cached = await this.cache.getJson<CacheShape>(`rec:page:${userId}:${key}:${version}${suffix}`);
        const found = cached?.items.find((item) => item.id === id);
        if (found) return found;
      } catch {
        /* cache miss still tried a live plan */
      }
    }
    return null;
  }

  async invalidate(userId: string) {
    try {
      await this.cache.delByPrefix(`rec:page:${userId}:`);
    } catch (err) {
      this.logger.warn(`cache invalidate skipped: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  private async plan(
    userId: string,
    cacheKey: string,
    cursor: string | undefined,
    limit: number,
    load: () => Promise<RankCandidate[]>,
    _halfLife: number,
    surface: 'feed' | 'reels' | 'explore' | 'hashtag' = cacheKey.startsWith('hashtag')
      ? 'hashtag'
      : (cacheKey as 'feed' | 'reels' | 'explore')
  ): Promise<PlanPage> {
    const started = Date.now();
    const { weights, version } = await this.config.active();
    const mode = await this.features.modeFor(userId);
    const key = `rec:page:${userId}:${cacheKey}:${version}:h${mode.hybrid ? 1 : 0}:m${mode.multiStage ? 1 : 0}`;
    let cached: CacheShape | null = null;
    try {
      cached = await this.cache.getJson<CacheShape>(key);
    } catch {
      cached = null;
    }
    if (!cached) {
      const viewer = await this.candidates.viewer(userId, weights.interestHalfLifeDays);
      const [rows, vector] = await Promise.all([
        load(),
        viewer.personalization
          ? this.interests.vectorFor(userId, weights.interestHalfLifeDays, viewer.clearedAt)
          : Promise.resolve(emptyInterest())
      ]);
      const registry = new RankingRegistry(version);
      const model = registry.current();
      const rankedResult =
        mode.multiStage || mode.engagementHints
          ? rankStaged(rows, vector, weights, Date.now(), surface, model, {
              multiStage: mode.multiStage,
              engagementHints: mode.engagementHints
            })
          : rankCandidates(rows, vector, weights, Date.now(), surface, model);
      if (mode.shadow) {
        rankStaged(rows, vector, weights, Date.now(), surface, model, {
          multiStage: true,
          engagementHints: mode.engagementHints
        });
        await this.metrics.bump('shadow:runs', 1);
      }
      const { ranked, excluded } = rankedResult;
      const items = ranked.map((row) => ({
        id: row.id,
        kind: row.kind === 'reel' ? ('reel' as const) : ('post' as const),
        reason: publicReason(row.parts, row.candidate.sources),
        source: row.candidate.sources[0] || 'fresh'
      }));
      cached = { items, version };
      try {
        await this.cache.setJson(key, cached, weights.pageCacheTtlSeconds);
      } catch {
        /* uncached ranking still returns */
      }
      const sample = distribution(
        ranked.slice(0, 30).map((row) => ({
          authorId: row.authorId,
          kind: row.kind,
          primaryTag: row.primaryTag
        }))
      );
      await this.metrics.bump(`${surface}:authors`, sample.uniqueAuthors);
      await this.metrics.bump(`${surface}:items`, sample.items);
      for (const [reason, count] of Object.entries(excluded)) {
        await this.metrics.bump(`exclude:${reason}`, count);
      }
      for (const [kind, count] of Object.entries(sample.kinds)) {
        await this.metrics.bump(`${surface}:kind:${kind}`, count);
      }
    }
    const page = pageByCursor(cached.items, cursor, limit);
    await this.metrics.timing(surface, Date.now() - started);
    return { items: page.items, nextCursor: page.nextCursor, version };
  }
}

export type StoryKind = ContentKind;
