import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DECLARED_TOPIC_WEIGHT, decayWeight, INTEREST_DELTA } from './engine/events';
import type { InterestVector } from './engine/types';
import { emptyInterest } from './engine/rank';

@Injectable()
export class InterestProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async vectorFor(userId: string, halfLifeDays: number, clearedAt: Date | null): Promise<InterestVector> {
    const vector = emptyInterest();
    const [declared, weights] = await Promise.all([
      this.prisma.userInterest.findMany({ where: { userId }, select: { interestKey: true } }),
      this.prisma.userInterestWeight.findMany({
        where: { userId, ...(clearedAt ? { updatedAt: { gt: clearedAt } } : {}) }
      })
    ]);
    const now = Date.now();
    for (const row of weights) {
      const ageDays = Math.max(0, (now - row.updatedAt.getTime()) / 86_400_000);
      const decayed = decayWeight(row.weight, ageDays, halfLifeDays);
      if (Math.abs(decayed) < 0.05) continue;
      const bucket =
        row.kind === 'hashtag' ? vector.hashtags : row.kind === 'author' ? vector.authors : vector.topics;
      bucket[row.key] = decayed;
    }
    for (const row of declared) {
      const key = row.interestKey.toLowerCase();
      vector.topics[key] = Math.max(vector.topics[key] ?? 0, DECLARED_TOPIC_WEIGHT);
    }
    return vector;
  }

  async apply(
    userId: string,
    eventType: string,
    target: { hashtags: string[]; authorId: string | null },
    scale = 1
  ): Promise<void> {
    const delta = (INTEREST_DELTA[eventType] ?? 0) * scale;
    if (delta == null || delta === 0) return;
    const keys: Array<{ kind: 'topic' | 'hashtag' | 'author'; key: string }> = [];
    if (eventType === 'follow' || eventType === 'unfollow' || eventType === 'profile_visit') {
      if (target.authorId) keys.push({ kind: 'author', key: target.authorId });
    } else {
      for (const tag of target.hashtags) keys.push({ kind: 'hashtag', key: tag.slice(0, 64) });
      for (const tag of target.hashtags) keys.push({ kind: 'topic', key: tag.slice(0, 64) });
      if (target.authorId && eventType !== 'search_query') {
        keys.push({ kind: 'author', key: target.authorId });
      }
    }
    for (const item of keys) {
      const existing = await this.prisma.userInterestWeight.findUnique({
        where: { userId_kind_key: { userId, kind: item.kind, key: item.key } }
      });
      const next = Math.max(-8, Math.min(8, (existing?.weight ?? 0) + delta));
      if (Math.abs(next) < 0.05) {
        if (existing) {
          await this.prisma.userInterestWeight.delete({ where: { id: existing.id } });
        }
        continue;
      }
      await this.prisma.userInterestWeight.upsert({
        where: { userId_kind_key: { userId, kind: item.kind, key: item.key } },
        create: { userId, kind: item.kind, key: item.key, weight: next },
        update: { weight: next }
      });
    }
  }

  async reset(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userInterestWeight.deleteMany({ where: { userId } }),
      this.prisma.recommendationMute.deleteMany({ where: { userId } }),
      this.prisma.recommendationEvent.deleteMany({ where: { userId } }),
      this.prisma.recommendationPreference.upsert({
        where: { userId },
        create: { userId, clearedAt: new Date(), feedMode: 'personalized' },
        update: { clearedAt: new Date() }
      })
    ]);
  }

  async setFeedMode(userId: string, feedMode: 'personalized' | 'following_chronological') {
    return this.prisma.recommendationPreference.upsert({
      where: { userId },
      create: { userId, feedMode },
      update: { feedMode },
      select: { feedMode: true, clearedAt: true }
    });
  }

  async preference(userId: string) {
    const row = await this.prisma.recommendationPreference.findUnique({ where: { userId } });
    return {
      feedMode: row?.feedMode === 'following_chronological' ? 'following_chronological' : 'personalized',
      personalizationEnabled: row?.personalizationEnabled !== false,
      clearedAt: row?.clearedAt ?? null
    };
  }

  async savePreference(
    userId: string,
    input: { feedMode: 'personalized' | 'following_chronological'; personalizationEnabled?: boolean }
  ) {
    const personalization =
      input.personalizationEnabled === undefined ? {} : { personalizationEnabled: input.personalizationEnabled };
    return this.prisma.recommendationPreference.upsert({
      where: { userId },
      create: { userId, feedMode: input.feedMode, ...personalization },
      update: { feedMode: input.feedMode, ...personalization },
      select: { feedMode: true, personalizationEnabled: true, clearedAt: true }
    });
  }

  async inferredTopics(userId: string, halfLifeDays: number) {
    const pref = await this.preference(userId);
    const declared = await this.prisma.userInterest.findMany({
      where: { userId },
      select: { interestKey: true }
    });
    const weights = await this.prisma.userInterestWeight.findMany({
      where: {
        userId,
        kind: { in: ['topic', 'hashtag'] },
        ...(pref.clearedAt ? { updatedAt: { gt: pref.clearedAt } } : {})
      }
    });
    const now = Date.now();
    return {
      declared: declared.map((row) => row.interestKey),
      inferred: weights.map((row) => {
        const ageDays = Math.max(0, (now - row.updatedAt.getTime()) / 86_400_000);
        const decayed = decayWeight(row.weight, ageDays, halfLifeDays);
        const strength = Math.round(Math.max(-1, Math.min(1, decayed / 8)) * 100) / 100;
        return {
          key: row.key,
          kind: row.kind,
          strength,
          polarity: strength >= 0 ? 'positive' : 'negative',
          sustained: Math.abs(decayed) >= 1.2
        };
      })
    };
  }

  async forgetInferred(userId: string, key: string): Promise<void> {
    const clean = key.toLowerCase().slice(0, 64);
    await this.prisma.userInterestWeight.deleteMany({
      where: { userId, key: clean, kind: { in: ['topic', 'hashtag'] } }
    });
  }
}
