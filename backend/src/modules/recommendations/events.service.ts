import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  logicalDuplicateWindowMs,
  MAX_REPLAYS_PER_DAY,
  validateEvent,
  type IncomingEvent,
  type ValidatedEvent
} from './engine/events';
import type { RankWeights } from './engine/types';
import { InterestProfileService } from './interest-profile.service';

export type EventResult = { eventId: string; status: 'accepted' | 'rejected'; reason?: string };

@Injectable()
export class RecommendationEventsService {
  private readonly logger = new Logger(RecommendationEventsService.name);
  private readonly memoryHits = new Map<string, { n: number; reset: number }>();
  private redisRateFallbackLogged = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly interests: InterestProfileService
  ) {}

  async ingest(
    userId: string,
    incoming: IncomingEvent[],
    weights: RankWeights
  ): Promise<{ results: EventResult[] }> {
    const limited = incoming.slice(0, weights.maxEventsPerBatch);
    const results: EventResult[] = [];
    for (const raw of limited) {
      results.push(await this.one(userId, raw, weights, false));
    }
    if (incoming.length > limited.length) {
      for (const extra of incoming.slice(limited.length)) {
        results.push({
          eventId: String(extra.eventId || ''),
          status: 'rejected',
          reason: 'batch_truncated'
        });
      }
    }
    return { results };
  }

  /** Server-side actions (like, follow, story open). Retries inside 10s collapse. */
  async recordTrusted(
    userId: string,
    input: { eventType: string; contentType: string; contentId: string; surface?: string }
  ): Promise<void> {
    try {
      const minute = Math.floor(Date.now() / 60_000);
      const eventId = `srv_${input.eventType}_${fnv(userId + '|' + input.contentId)}_${minute}`;
      await this.one(
        userId,
        {
          eventId,
          eventType: input.eventType,
          contentType: input.contentType,
          contentId: input.contentId,
          ...(input.surface ? { surface: input.surface } : {})
        },
        {
          qualifiedViewMs: 2000,
          maxWatchMs: 180_000,
          videoCompleteRatio: 0.9,
          rateLimitPerMinute: 120,
          maxEventsPerBatch: 25
        } as RankWeights,
        true
      );
    } catch (err) {
      this.logger.warn(`trusted event skipped: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  async recordSearch(userId: string, query: string): Promise<void> {
    try {
      const minute = Math.floor(Date.now() / 60_000);
      await this.one(
        userId,
        {
          eventId: `srv_search_${fnv(userId + '|' + query)}_${minute}`,
          eventType: 'search_query',
          query,
          surface: 'search'
        },
        { qualifiedViewMs: 2000, maxWatchMs: 180_000, videoCompleteRatio: 0.9, rateLimitPerMinute: 120 },
        true
      );
    } catch (err) {
      this.logger.warn(`search event skipped: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  async prune(retentionDays: number, batch: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const old = await this.prisma.recommendationEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: Math.min(Math.max(batch, 1), 500)
    });
    if (!old.length) return 0;
    await this.prisma.recommendationEvent.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
    return old.length;
  }

  private async one(
    userId: string,
    raw: IncomingEvent,
    weights: Pick<RankWeights, 'qualifiedViewMs' | 'maxWatchMs' | 'videoCompleteRatio' | 'rateLimitPerMinute'>,
    trusted: boolean
  ): Promise<EventResult> {
    const eventId = String(raw.eventId || '');
    const checked = validateEvent(raw, Date.now(), weights);
    if (!checked.ok) {
      await this.stat(raw.eventType || 'unknown', 'rejected', checked.reason);
      return { eventId, status: 'rejected', reason: checked.reason };
    }
    const event = checked.event;
    const allowed = await this.allowRate(userId, weights.rateLimitPerMinute);
    if (!allowed) {
      await this.stat(event.eventType, 'rejected', 'rate_limited');
      return { eventId: event.eventId, status: 'rejected', reason: 'rate_limited' };
    }

    const existing = await this.prisma.recommendationEvent.findUnique({
      where: { eventId: event.eventId },
      select: { id: true }
    });
    if (existing) {
      await this.stat(event.eventType, 'rejected', 'duplicate_event');
      return { eventId: event.eventId, status: 'rejected', reason: 'duplicate_event' };
    }

    if (trusted) {
      const recent = await this.prisma.recommendationEvent.findFirst({
        where: {
          userId,
          eventType: event.eventType,
          contentId: event.contentId,
          createdAt: { gte: new Date(Date.now() - 10_000) }
        },
        select: { id: true }
      });
      if (recent) {
        await this.stat(event.eventType, 'rejected', 'duplicate_window');
        return { eventId: event.eventId, status: 'rejected', reason: 'duplicate_window' };
      }
    } else {
      const windowMs = logicalDuplicateWindowMs(event.eventType);
      if (windowMs && event.contentId) {
        const dup = await this.prisma.recommendationEvent.findFirst({
          where: {
            userId,
            eventType: event.eventType,
            contentId: event.contentId,
            createdAt: { gte: new Date(Date.now() - windowMs) }
          },
          select: { id: true }
        });
        if (dup) {
          await this.stat(event.eventType, 'rejected', 'duplicate_window');
          return { eventId: event.eventId, status: 'rejected', reason: 'duplicate_window' };
        }
      }
      if (event.eventType === 'replay' && event.contentId) {
        const replays = await this.prisma.recommendationEvent.count({
          where: {
            userId,
            eventType: 'replay',
            contentId: event.contentId,
            createdAt: { gte: new Date(Date.now() - 86_400_000) }
          }
        });
        if (replays >= MAX_REPLAYS_PER_DAY) {
          await this.stat(event.eventType, 'rejected', 'replay_cap');
          return { eventId: event.eventId, status: 'rejected', reason: 'replay_cap' };
        }
      }
    }

    if (
      !trusted &&
      (needsPlayback(event.eventType) || (event.eventType === 'qualified_view' && event.contentType === 'reel'))
    ) {
      const started = await this.prisma.recommendationEvent.findFirst({
        where: {
          userId,
          eventType: 'video_start',
          contentId: event.contentId,
          createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }
        },
        select: { id: true }
      });
      if (!started) {
        await this.stat(event.eventType, 'rejected', 'no_playback');
        return { eventId: event.eventId, status: 'rejected', reason: 'no_playback' };
      }
    }

    if (!trusted && needsImpression(event.eventType)) {
      const priorType = event.eventType === 'story_complete' ? 'story_view' : 'impression';
      const prior = await this.prisma.recommendationEvent.findFirst({
        where: {
          userId,
          eventType: priorType,
          contentId: event.contentId,
          createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }
        },
        select: { id: true }
      });
      if (!prior) {
        await this.stat(event.eventType, 'rejected', 'no_impression_context');
        return { eventId: event.eventId, status: 'rejected', reason: 'no_impression_context' };
      }
    }

    if (event.eventType !== 'search_query') {
      const visible = await this.canSee(userId, event);
      if (!visible) {
        await this.stat(event.eventType, 'rejected', 'not_visible');
        return { eventId: event.eventId, status: 'rejected', reason: 'not_visible' };
      }
    }

    await this.prisma.recommendationEvent.create({
      data: {
        eventId: event.eventId,
        userId,
        eventType: event.eventType,
        contentType: event.contentType,
        contentId: event.contentId,
        surface: event.surface,
        value: event.value,
        topicKey: event.topicKey
      }
    });
    await this.stat(event.eventType, 'accepted');

    if (event.eventType === 'not_interested' || event.eventType === 'hide_post') {
      const targetType = event.eventType === 'hide_post' ? 'post' : event.contentType || 'post';
      if (event.contentId) {
        await this.prisma.recommendationMute.upsert({
          where: {
            userId_targetType_targetId: { userId, targetType, targetId: event.contentId }
          },
          create: {
            userId,
            targetType,
            targetId: event.contentId,
            reason: event.eventType === 'hide_post' ? 'hide' : 'not_interested'
          },
          update: { reason: event.eventType === 'hide_post' ? 'hide' : 'not_interested' }
        });
      }
    }
    if (event.eventType === 'dismiss_recommendation' && event.contentType === 'user' && event.contentId) {
      await this.prisma.recommendationMute.upsert({
        where: {
          userId_targetType_targetId: { userId, targetType: 'author', targetId: event.contentId }
        },
        create: { userId, targetType: 'author', targetId: event.contentId, reason: 'mute' },
        update: { reason: 'mute' }
      });
    }

    const topicTarget = await this.topicTarget(event);
    const casual = event.eventType === 'qualified_view' && (event.value ?? 0) < 4000;
    await this.interests.apply(userId, event.eventType, topicTarget, casual ? 0.4 : 1);
    return { eventId: event.eventId, status: 'accepted' };
  }

  private async topicTarget(event: ValidatedEvent): Promise<{ hashtags: string[]; authorId: string | null }> {
    if (!event.contentId || !event.contentType) return { hashtags: [], authorId: null };
    if (event.contentType === 'user') return { hashtags: [], authorId: event.contentId };
    if (event.contentType === 'hashtag') return { hashtags: [event.contentId.toLowerCase()], authorId: null };
    if (event.contentType === 'post') {
      const post = await this.prisma.post.findUnique({
        where: { id: event.contentId },
        select: { authorId: true, hashtags: { select: { hashtag: { select: { tag: true } } } } }
      });
      return {
        hashtags: await this.withUnderstoodTopics(
          'post',
          event.contentId,
          (post?.hashtags || []).map((row) => row.hashtag.tag.toLowerCase())
        ),
        authorId: post?.authorId ?? null
      };
    }
    if (event.contentType === 'reel') {
      const reel = await this.prisma.reel.findUnique({
        where: { id: event.contentId },
        select: { authorId: true, hashtags: { select: { hashtag: { select: { tag: true } } } } }
      });
      return {
        hashtags: await this.withUnderstoodTopics(
          'reel',
          event.contentId,
          (reel?.hashtags || []).map((row) => row.hashtag.tag.toLowerCase())
        ),
        authorId: reel?.authorId ?? null
      };
    }
    if (event.contentType === 'story') {
      const story = await this.prisma.story.findUnique({
        where: { id: event.contentId },
        select: { authorId: true }
      });
      return { hashtags: [], authorId: story?.authorId ?? null };
    }
    return { hashtags: [], authorId: null };
  }

  private async withUnderstoodTopics(contentType: string, contentId: string, hashtags: string[]): Promise<string[]> {
    try {
      const row = await this.prisma.contentUnderstanding.findUnique({
        where: { contentType_contentId: { contentType, contentId } },
        select: { status: true, quality: true, topics: true }
      });
      if (!row || row.status !== 'ready' || row.quality === 'low' || !Array.isArray(row.topics)) return hashtags;
      const keys = row.topics
        .map((topic) => (topic && typeof topic === 'object' && 'key' in topic ? String(topic.key) : ''))
        .filter((key) => key.length > 0);
      return [...new Set([...hashtags, ...keys])];
    } catch {
      return hashtags;
    }
  }

  private async canSee(userId: string, event: ValidatedEvent): Promise<boolean> {
    if (!event.contentId || !event.contentType) return false;
    const blocked = {
      blocksReceived: { none: { blockerId: userId } },
      blocksInitiated: { none: { blockedId: userId } }
    };
    if (event.contentType === 'post') {
      const post = await this.prisma.post.findFirst({
        where: {
          id: event.contentId,
          deletedAt: null,
          archivedAt: null,
          AND: [
            {
              OR: [
                { author: { isPrivate: false } },
                { authorId: userId },
                { author: { followers: { some: { followerId: userId, status: 'accepted' } } } }
              ]
            },
            { author: blocked }
          ]
        },
        select: { id: true }
      });
      return Boolean(post);
    }
    if (event.contentType === 'reel') {
      const reel = await this.prisma.reel.findFirst({
        where: {
          id: event.contentId,
          deletedAt: null,
          archivedAt: null,
          AND: [
            {
              OR: [
                { author: { isPrivate: false } },
                { authorId: userId },
                { author: { followers: { some: { followerId: userId, status: 'accepted' } } } }
              ]
            },
            { author: blocked }
          ]
        },
        select: { id: true }
      });
      return Boolean(reel);
    }
    if (event.contentType === 'story') {
      const story = await this.prisma.story.findFirst({
        where: { id: event.contentId, deletedAt: null, expiresAt: { gt: new Date() } }
      });
      if (!story) return false;
      if (story.authorId === userId) return true;
      const author = await this.prisma.user.findFirst({
        where: { id: story.authorId, ...blocked },
        select: { id: true }
      });
      if (!author) return false;
      const follows = await this.prisma.follow.findFirst({
        where: { followerId: userId, followingId: story.authorId, status: 'accepted' },
        select: { id: true }
      });
      if (!follows) return false;
      if (story.audience === 'everyone') return true;
      const close = await this.prisma.closeFriend.findFirst({
        where: { ownerId: story.authorId, friendId: userId },
        select: { id: true }
      });
      return Boolean(close);
    }
    if (event.contentType === 'user' || event.contentType === 'hashtag') {
      if (event.contentType === 'hashtag') {
        const tag = await this.prisma.hashtag.findFirst({
          where: { tag: event.contentId.toLowerCase() },
          select: { id: true }
        });
        return Boolean(tag);
      }
      const user = await this.prisma.user.findFirst({
        where: { id: event.contentId, ...blocked },
        select: { id: true }
      });
      return Boolean(user);
    }
    return false;
  }

  private async allowRate(userId: string, maxPerMinute: number): Promise<boolean> {
    const key = `rec:rate:${userId}`;
    try {
      const client = this.redis.getClient();
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, 60);
      return count <= maxPerMinute;
    } catch (err) {
      if (!this.redisRateFallbackLogged) {
        this.redisRateFallbackLogged = true;
        this.logger.warn(
          `rate limit is using an in-process counter because Redis failed (${err instanceof Error ? err.message : 'error'}). That counter is not shared across API processes.`
        );
      }
      const now = Date.now();
      const row = this.memoryHits.get(userId);
      if (!row || row.reset < now) {
        this.memoryHits.set(userId, { n: 1, reset: now + 60_000 });
        return true;
      }
      row.n += 1;
      return row.n <= maxPerMinute;
    }
  }

  private async stat(eventType: string, outcome: 'accepted' | 'rejected', reason = '') {
    try {
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);
      const safeReason = reason.slice(0, 48);
      await this.prisma.recommendationDailyStat.upsert({
        where: {
          day_eventType_outcome_reason: {
            day,
            eventType: eventType.slice(0, 40),
            outcome,
            reason: safeReason
          }
        },
        create: { day, eventType: eventType.slice(0, 40), outcome, reason: safeReason, count: 1 },
        update: { count: { increment: 1 } }
      });
    } catch (err) {
      this.logger.warn(`stat skipped: ${err instanceof Error ? err.message : 'error'}`);
    }
  }
}

function needsImpression(eventType: string): boolean {
  return (
    eventType === 'qualified_view' ||
    eventType === 'video_start' ||
    eventType === 'video_progress' ||
    eventType === 'video_complete' ||
    eventType === 'video_skip' ||
    eventType === 'replay' ||
    eventType === 'story_complete'
  );
}

function needsPlayback(eventType: string): boolean {
  return (
    eventType === 'video_progress' ||
    eventType === 'video_complete' ||
    eventType === 'video_skip' ||
    eventType === 'replay'
  );
}

function fnv(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
