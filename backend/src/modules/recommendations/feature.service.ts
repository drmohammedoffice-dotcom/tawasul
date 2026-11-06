import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const FEATURE_KEYS = [
  'textAnalysis',
  'hybridRanking',
  'engagementHints',
  'multiStage',
  'shadowRanking',
  /** Compute/log semantic hits; do not change user-facing search merge. */
  'semanticSearchShadow',
  /** Merge BGE-M3 hits into public post search (rollout via value 0–100). */
  'semanticSearch'
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

const DEFAULTS: Record<FeatureKey, { enabled: boolean; value: number }> = {
  textAnalysis: { enabled: true, value: 0 },
  hybridRanking: { enabled: false, value: 0 },
  engagementHints: { enabled: false, value: 0 },
  multiStage: { enabled: false, value: 0 },
  shadowRanking: { enabled: false, value: 0 },
  semanticSearchShadow: { enabled: true, value: 0 },
  semanticSearch: { enabled: false, value: 0 }
};

export type FeatureMode = {
  textAnalysis: boolean;
  hybrid: boolean;
  engagementHints: boolean;
  multiStage: boolean;
  shadow: boolean;
  semanticShadow: boolean;
  semanticLive: boolean;
};

@Injectable()
export class RecommendationFeatureService {
  private readonly logger = new Logger(RecommendationFeatureService.name);
  private cache: { at: number; rows: Map<string, { enabled: boolean; value: number }> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<Array<{ key: string; enabled: boolean; value: number }>> {
    const rows = await this.rows();
    return FEATURE_KEYS.map((key) => ({
      key,
      enabled: rows.get(key)?.enabled ?? DEFAULTS[key].enabled,
      value: rows.get(key)?.value ?? DEFAULTS[key].value
    }));
  }

  async modeFor(userId: string): Promise<FeatureMode> {
    const rows = await this.rows();
    const hybrid = rows.get('hybridRanking');
    const rollout = hybrid?.value ?? 0;
    const inBucket = rollout > 0 && bucket(userId) < Math.min(100, rollout);
    const semantic = rows.get('semanticSearch');
    const semanticRollout = semantic?.value ?? 0;
    const semanticBucket =
      semanticRollout > 0 && bucket(userId) < Math.min(100, semanticRollout);
    return {
      textAnalysis: rows.get('textAnalysis')?.enabled ?? DEFAULTS.textAnalysis.enabled,
      hybrid: Boolean(hybrid?.enabled && inBucket),
      engagementHints: rows.get('engagementHints')?.enabled ?? false,
      multiStage: rows.get('multiStage')?.enabled ?? false,
      shadow: rows.get('shadowRanking')?.enabled ?? false,
      semanticShadow: rows.get('semanticSearchShadow')?.enabled ?? DEFAULTS.semanticSearchShadow.enabled,
      // Same pattern as hybridRanking: enabled + rollout bucket (value 0–100).
      semanticLive: Boolean(semantic?.enabled && semanticBucket)
    };
  }

  async set(key: string, enabled: boolean, value = 0): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (key === 'conversationSignals') return { ok: false, reason: 'conversation_signals_disabled' };
    if (!FEATURE_KEYS.includes(key as FeatureKey)) return { ok: false, reason: 'unknown_feature' };
    const safe = Math.max(0, Math.min(100, Math.round(value)));
    await this.prisma.recommendationFeature.upsert({
      where: { key },
      create: { key, enabled, value: safe },
      update: { enabled, value: safe }
    });
    this.cache = null;
    return { ok: true };
  }

  private async rows(): Promise<Map<string, { enabled: boolean; value: number }>> {
    if (this.cache && Date.now() - this.cache.at < 15_000) return this.cache.rows;
    try {
      const found = await this.prisma.recommendationFeature.findMany();
      const rows = new Map(found.map((row) => [row.key, { enabled: row.enabled, value: row.value }]));
      this.cache = { at: Date.now(), rows };
      return rows;
    } catch (err) {
      this.logger.warn(`feature flags unavailable: ${err instanceof Error ? err.message : 'error'}`);
      return new Map();
    }
  }
}

function bucket(userId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}
