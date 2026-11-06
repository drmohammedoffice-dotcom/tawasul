import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BASELINE_VERSION, BASELINE_WEIGHTS, type RankWeights } from './engine/types';
import { baselineDocument, resolveWeights } from './engine/weights';

@Injectable()
export class RecommendationConfigService {
  private readonly logger = new Logger(RecommendationConfigService.name);
  private cache: { weights: RankWeights; version: string; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async ensureBaseline(): Promise<void> {
    const active = await this.prisma.recommendationConfig.findFirst({ where: { active: true } });
    if (active) return;
    await this.prisma.recommendationConfig.upsert({
      where: { version: BASELINE_VERSION },
      create: {
        version: BASELINE_VERSION,
        active: true,
        weights: BASELINE_WEIGHTS as unknown as Prisma.InputJsonValue,
        note: 'Initial deterministic baseline. Not a trained model.'
      },
      update: {}
    });
  }

  async active(): Promise<{ version: string; weights: RankWeights }> {
    if (this.cache && Date.now() - this.cache.at < 15_000) {
      return { version: this.cache.version, weights: this.cache.weights };
    }
    try {
      await this.ensureBaseline();
      const row = await this.prisma.recommendationConfig.findFirst({
        where: { active: true },
        orderBy: { createdAt: 'desc' }
      });
      const resolved = resolveWeights(row?.weights ?? null);
      const version = row?.version || BASELINE_VERSION;
      this.cache = { weights: resolved.weights, version, at: Date.now() };
      return { version, weights: resolved.weights };
    } catch (err) {
      this.logger.warn(`config fallback: ${err instanceof Error ? err.message : 'error'}`);
      return { version: BASELINE_VERSION, weights: BASELINE_WEIGHTS };
    }
  }

  invalidate() {
    this.cache = null;
  }

  document() {
    return baselineDocument();
  }

  async publish(
    actorId: string,
    input: { weights: unknown; note?: string }
  ): Promise<{ version: string; rejectedKeys: string[] }> {
    const { weights, rejectedKeys } = resolveWeights(input.weights);
    if (rejectedKeys.length) {
      return { version: '', rejectedKeys };
    }
    const version = `baseline-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    await this.prisma.$transaction([
      this.prisma.recommendationConfig.updateMany({ where: { active: true }, data: { active: false } }),
      this.prisma.recommendationConfig.create({
        data: {
          version,
          active: true,
          weights: weights as unknown as Prisma.InputJsonValue,
          note: input.note?.slice(0, 500) ?? null,
          createdById: actorId
        }
      }),
      this.prisma.recommendationConfigAudit.create({
        data: { version, actorId, action: 'publish' }
      })
    ]);
    this.invalidate();
    return { version, rejectedKeys: [] };
  }

  async activate(actorId: string, version: string): Promise<boolean> {
    const row = await this.prisma.recommendationConfig.findUnique({ where: { version } });
    if (!row) return false;
    await this.prisma.$transaction([
      this.prisma.recommendationConfig.updateMany({ where: { active: true }, data: { active: false } }),
      this.prisma.recommendationConfig.update({ where: { version }, data: { active: true } }),
      this.prisma.recommendationConfigAudit.create({ data: { version, actorId, action: 'rollback' } })
    ]);
    this.invalidate();
    return true;
  }

  async history() {
    const [configs, audits] = await Promise.all([
      this.prisma.recommendationConfig.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.recommendationConfigAudit.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { version: true, action: true, createdAt: true, actor: { select: { username: true } } }
      })
    ]);
    return {
      configs: configs.map((row) => ({
        version: row.version,
        active: row.active,
        note: row.note,
        createdAt: row.createdAt,
        weights: resolveWeights(row.weights).weights
      })),
      audits
    };
  }
}
