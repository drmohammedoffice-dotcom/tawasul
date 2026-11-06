import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_CATEGORIES,
  POLICY_KEY,
  POLICY_VERSION,
  type PolicyCategory
} from './policy/default-policy';

@Injectable()
export class ModerationPolicyService {
  private readonly logger = new Logger(ModerationPolicyService.name);
  private cache: { at: number; version: string; categories: PolicyCategory[]; versionId: string } | null =
    null;

  constructor(private readonly prisma: PrismaService) {}

  async ensureSeeded(): Promise<void> {
    const existing = await this.prisma.moderationPolicy.findUnique({ where: { key: POLICY_KEY } });
    if (existing) return;
    const policy = await this.prisma.moderationPolicy.create({
      data: {
        key: POLICY_KEY,
        title: 'سياسة مجتمع تواصل',
        description:
          'مستوحاة من مبادئ عامة لإرشادات المجتمعات، مع قواعد خاصة بتواصل: حظر صارم للمحتوى الجنسي واستغلال القاصرين.'
      }
    });
    const version = await this.prisma.moderationPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: POLICY_VERSION,
        categories: DEFAULT_CATEGORIES as unknown as Prisma.InputJsonValue,
        changelog: 'الإصدار الأولي'
      }
    });
    await this.prisma.moderationPolicy.update({
      where: { id: policy.id },
      data: { activeVersionId: version.id }
    });
    this.logger.log(`Seeded moderation policy ${POLICY_KEY}@${POLICY_VERSION}`);
  }

  async active(): Promise<{ versionId: string; version: string; categories: PolicyCategory[] }> {
    await this.ensureSeeded();
    if (this.cache && Date.now() - this.cache.at < 30_000) {
      return {
        versionId: this.cache.versionId,
        version: this.cache.version,
        categories: this.cache.categories
      };
    }
    const policy = await this.prisma.moderationPolicy.findUnique({ where: { key: POLICY_KEY } });
    if (!policy?.activeVersionId) {
      return { versionId: 'seed', version: POLICY_VERSION, categories: DEFAULT_CATEGORIES };
    }
    const ver = await this.prisma.moderationPolicyVersion.findUnique({
      where: { id: policy.activeVersionId }
    });
    if (!ver) {
      return { versionId: 'seed', version: POLICY_VERSION, categories: DEFAULT_CATEGORIES };
    }
    const categories = Array.isArray(ver.categories)
      ? (ver.categories as unknown as PolicyCategory[])
      : DEFAULT_CATEGORIES;
    this.cache = {
      at: Date.now(),
      versionId: ver.id,
      version: ver.version,
      categories
    };
    return { versionId: ver.id, version: ver.version, categories };
  }

  async listVersions() {
    await this.ensureSeeded();
    const policy = await this.prisma.moderationPolicy.findUnique({
      where: { key: POLICY_KEY },
      include: { versions: { orderBy: { createdAt: 'desc' } } }
    });
    return policy;
  }

  async publishVersion(
    actorId: string,
    input: { version: string; categories: PolicyCategory[]; changelog?: string }
  ) {
    await this.ensureSeeded();
    const policy = await this.prisma.moderationPolicy.findUniqueOrThrow({ where: { key: POLICY_KEY } });
    const ver = await this.prisma.moderationPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: input.version.slice(0, 32),
        categories: input.categories as unknown as Prisma.InputJsonValue,
        changelog: input.changelog?.slice(0, 500) || null,
        createdById: actorId
      }
    });
    await this.prisma.moderationPolicy.update({
      where: { id: policy.id },
      data: { activeVersionId: ver.id }
    });
    await this.prisma.moderationAuditLog.create({
      data: {
        actorId,
        action: 'policy.publish',
        entityType: 'ModerationPolicyVersion',
        entityId: ver.id,
        after: { version: ver.version }
      }
    });
    this.cache = null;
    return ver;
  }

  categoryMap(categories: PolicyCategory[]): Map<string, PolicyCategory> {
    return new Map(categories.map((c) => [c.key, c]));
  }
}
