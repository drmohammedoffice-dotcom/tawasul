import { createHash } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { TawasulAiClient } from '../ai/tawasul-ai.client';
import { PrismaService } from '../prisma/prisma.service';
import { RecommendationFeatureService } from './feature.service';

const EMBED_MODEL = 'bge-m3';
const QUERY_CACHE_TTL_MS = 60_000;
const MAX_CANDIDATES = 400;

type QueryCacheEntry = { at: number; vector: number[]; dim: number };

export type SemanticHit = {
  contentType: string;
  contentId: string;
  score: number;
};

/**
 * Shadow-first semantic search over ContentEmbedding (BGE-M3).
 * Traditional caption search remains authoritative until semanticSearch is enabled.
 */
@Injectable()
export class SemanticSearchService {
  private readonly logger = new Logger(SemanticSearchService.name);
  private readonly queryCache = new Map<string, QueryCacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: RecommendationFeatureService,
    @Optional() private readonly tawasulAi?: TawasulAiClient
  ) {}

  async searchPublicPosts(
    viewerId: string,
    query: string,
    limit = 20
  ): Promise<{ hits: SemanticHit[]; shadow: boolean; live: boolean; dim?: number }> {
    const mode = await this.features.modeFor(viewerId);
    const shadow = mode.semanticShadow;
    const live = mode.semanticLive;
    if (!shadow && !live) return { hits: [], shadow: false, live: false };

    const vector = await this.embedQuery(query);
    if (!vector) return { hits: [], shadow, live };

    const rows = await this.prisma.contentEmbedding.findMany({
      where: { status: 'ready', modelId: EMBED_MODEL, contentType: 'post' },
      orderBy: { updatedAt: 'desc' },
      take: MAX_CANDIDATES,
      select: { contentType: true, contentId: true, vector: true, dim: true }
    });

    const scored: SemanticHit[] = [];
    for (const row of rows) {
      const emb = asFloatArray(row.vector);
      if (!emb || emb.length !== vector.vector.length) continue;
      scored.push({
        contentType: row.contentType,
        contentId: row.contentId,
        score: cosine(vector.vector, emb)
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(Math.max(limit, 1), 40));

    if (shadow && !live) {
      this.logger.debug(
        `semantic shadow qHash=${hashQuery(query).slice(0, 8)} hits=${top.length} top=${top[0]?.score?.toFixed(3) ?? 'n/a'}`
      );
    }

    return { hits: top, shadow, live, dim: vector.dim };
  }

  /** Merge semantic post ids into lexical results without dropping lexical ACL. */
  mergePostIds(lexicalIds: string[], semanticIds: string[], limit: number): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    // Interleave: keep lexical order primary, inject high semantic matches not already present.
    for (const id of lexicalIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) return out;
    }
    for (const id of semanticIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) break;
    }
    return out;
  }

  private async embedQuery(query: string): Promise<{ vector: number[]; dim: number } | null> {
    const key = hashQuery(query);
    const cached = this.queryCache.get(key);
    if (cached && Date.now() - cached.at < QUERY_CACHE_TTL_MS) {
      return { vector: cached.vector, dim: cached.dim };
    }
    if (!this.tawasulAi?.enabled()) return null;
    const job = await this.tawasulAi.enqueueAndWait(
      {
        type: 'embed.batch',
        payload: { texts: [query.slice(0, 1000)] },
        idempotencyKey: `search-q:${key}`,
        priority: 3
      },
      { timeoutMs: 60_000, intervalMs: 500 }
    );
    if (!job || job.status !== 'done' || !job.result || typeof job.result !== 'object') return null;
    const data = (job.result as { data?: { dim?: number; vectors?: number[][] } }).data;
    const vector = data?.vectors?.[0];
    const dim = data?.dim || vector?.length || 0;
    if (!vector || vector.length !== dim) return null;
    this.queryCache.set(key, { at: Date.now(), vector, dim });
    // Bound memory
    if (this.queryCache.size > 200) {
      const oldest = [...this.queryCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.queryCache.delete(oldest[0]);
    }
    return { vector, dim };
  }
}

function hashQuery(q: string): string {
  return createHash('sha256').update(q.trim().toLowerCase()).digest('hex');
}

function asFloatArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return null;
    out.push(item);
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
