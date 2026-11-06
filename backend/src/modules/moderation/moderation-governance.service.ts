import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MediaStorageService } from '../media/media.storage';
import { PrismaService } from '../prisma/prisma.service';
import type { SafetyHit } from './engine/safety-scanner';

@Injectable()
export class ModerationGovernanceService {
  private readonly logger = new Logger(ModerationGovernanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly mediaStorage?: MediaStorageService
  ) {}

  async ensureRuntime(): Promise<void> {
    await this.prisma.moderationRuntimeConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {}
    });
    await this.prisma.moderationRetentionPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {}
    });
  }

  async runtime() {
    await this.ensureRuntime();
    return this.prisma.moderationRuntimeConfig.findUniqueOrThrow({ where: { id: 'default' } });
  }

  async setShadow(actorId: string, enabled: boolean, shadowPolicyVersionId?: string | null) {
    await this.ensureRuntime();
    const row = await this.prisma.moderationRuntimeConfig.update({
      where: { id: 'default' },
      data: {
        shadowEnabled: enabled,
        shadowPolicyVersionId: enabled ? shadowPolicyVersionId || null : null,
        updatedById: actorId
      }
    });
    await this.prisma.moderationAuditLog.create({
      data: {
        actorId,
        action: enabled ? 'shadow.enable' : 'shadow.disable',
        entityType: 'ModerationRuntimeConfig',
        entityId: 'default',
        after: {
          shadowEnabled: enabled,
          shadowPolicyVersionId: row.shadowPolicyVersionId
        } as Prisma.InputJsonValue
      }
    });
    return row;
  }

  async recordShadow(input: {
    contentType: string;
    contentId: string;
    contentHash: string;
    policyVersion: string;
    topCategory: string | null;
    topConfidence: number;
    wouldAction: string;
    riskScore: number;
    liveAction: string;
  }) {
    return this.prisma.moderationShadowResult.create({
      data: {
        contentType: input.contentType,
        contentId: input.contentId,
        contentHash: input.contentHash,
        policyVersion: input.policyVersion,
        topCategory: input.topCategory,
        topConfidence: input.topConfidence,
        wouldAction: input.wouldAction,
        riskScore: input.riskScore,
        agreedWithLive: input.wouldAction === input.liveAction
      }
    });
  }

  async qualityStats(days = 30) {
    const since = new Date(Date.now() - days * 86400_000);
    const [decisions, appeals, shadows, cases, scanJobs] = await Promise.all([
      this.prisma.moderationDecision.findMany({
        where: { createdAt: { gte: since } },
        select: { action: true, actorType: true, category: true, createdAt: true, caseId: true }
      }),
      this.prisma.moderationAppeal.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, createdAt: true, resolvedAt: true }
      }),
      this.prisma.moderationShadowResult.findMany({
        where: { createdAt: { gte: since } },
        select: { agreedWithLive: true, wouldAction: true, topCategory: true, policyVersion: true }
      }),
      this.prisma.moderationCase.count({ where: { createdAt: { gte: since } } }),
      this.prisma.moderationJob.findMany({
        where: { status: 'done', updatedAt: { gte: since } },
        select: { createdAt: true, updatedAt: true }
      })
    ]);

    const autoHide = decisions.filter((d) => d.actorType === 'auto' && ['hide', 'remove'].includes(d.action));
    const humanRestore = decisions.filter(
      (d) => d.actorType === 'human' && d.action === 'restore'
    );
    // Proxy FP: auto hide later restored by human
    const falsePositiveProxy = humanRestore.length;
    const appealsApproved = appeals.filter((a) => a.status === 'APPROVED').length;
    const appealsRejected = appeals.filter((a) => a.status === 'REJECTED').length;
    const reviewTimes = appeals
      .filter((a) => a.resolvedAt)
      .map((a) => (a.resolvedAt!.getTime() - a.createdAt.getTime()) / 1000);
    const avgReviewSec = reviewTimes.length
      ? Math.round(reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length)
      : null;
    const scanMs = scanJobs.map((j) => j.updatedAt.getTime() - j.createdAt.getTime());
    const avgScanMs = scanMs.length
      ? Math.round(scanMs.reduce((a, b) => a + b, 0) / scanMs.length)
      : null;

    const shadowAgree = shadows.filter((s) => s.agreedWithLive).length;
    return {
      windowDays: days,
      cases,
      decisions: decisions.length,
      autoActions: autoHide.length,
      falsePositiveProxy,
      appealsApproved,
      appealsRejected,
      avgReviewSec,
      avgScanMs,
      shadow: {
        samples: shadows.length,
        agreeRate: shadows.length ? shadowAgree / shadows.length : null,
        byVersion: groupCount(shadows.map((s) => s.policyVersion))
      },
      byCategory: groupCount(decisions.map((d) => d.category || 'none')),
      note: 'Precision/Recall labeled eval uses phase38/38.1 validation scripts; dashboard uses operational proxies.'
    };
  }

  async openIncident(
    actorId: string,
    input: {
      title: string;
      severity: string;
      caseIds?: string[];
      reportIds?: string[];
      notes?: string;
      assigneeId?: string;
    }
  ) {
    const row = await this.prisma.moderationIncident.create({
      data: {
        title: input.title.slice(0, 200),
        severity: input.severity.slice(0, 16),
        status: 'open',
        assigneeId: input.assigneeId || actorId,
        caseIds: (input.caseIds || []) as unknown as Prisma.InputJsonValue,
        reportIds: (input.reportIds || []) as unknown as Prisma.InputJsonValue,
        notes: input.notes || null,
        createdById: actorId
      }
    });
    await this.prisma.moderationAuditLog.create({
      data: {
        actorId,
        action: 'incident.open',
        entityType: 'ModerationIncident',
        entityId: row.id,
        after: { severity: row.severity } as Prisma.InputJsonValue
      }
    });
    return row;
  }

  async closeIncident(actorId: string, id: string, closeReason: string) {
    const row = await this.prisma.moderationIncident.update({
      where: { id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        closeReason: closeReason.slice(0, 300)
      }
    });
    await this.prisma.moderationAuditLog.create({
      data: {
        actorId,
        action: 'incident.close',
        entityType: 'ModerationIncident',
        entityId: id,
        after: { closeReason } as Prisma.InputJsonValue
      }
    });
    return row;
  }

  async listIncidents(limit = 40) {
    return this.prisma.moderationIncident.findMany({
      orderBy: [{ status: 'asc' }, { openedAt: 'desc' }],
      take: Math.min(Math.max(limit, 1), 100)
    });
  }

  async evaluateReportAbuse(reporterId: string): Promise<{ abusive: boolean; score: number }> {
    const runtime = await this.runtime();
    const since = new Date(Date.now() - 7 * 86400_000);
    const reports = await this.prisma.report.findMany({
      where: { reporterId, createdAt: { gte: since } },
      select: { status: true, targetId: true }
    });
    const dismissed = reports.filter((r) => r.status === 'dismissed' || r.status === 'abusive').length;
    const uniqueTargets = new Set(reports.map((r) => r.targetId)).size;
    const score = dismissed * 2 + Math.max(0, reports.length - uniqueTargets) * 3;
    const abusive = score >= (runtime.reportAbuseThreshold || 8);
    return { abusive, score };
  }

  async retentionSweep(): Promise<{ deletedShadows: number; note: string }> {
    await this.ensureRuntime();
    const policy = await this.prisma.moderationRetentionPolicy.findUnique({
      where: { id: 'default' }
    });
    const shadowDays = policy?.shadowDays ?? 90;
    const cut = new Date(Date.now() - shadowDays * 86400_000);
    const deleted = await this.prisma.moderationShadowResult.deleteMany({
      where: { createdAt: { lt: cut } }
    });
    this.logger.log(`retention: deleted ${deleted.count} shadow rows older than ${shadowDays}d`);
    return {
      deletedShadows: deleted.count,
      note: 'Case/decision/evidence hard-delete is admin-triggered; auto-sweep limited to shadow samples to avoid destroying audit trails.'
    };
  }

  async getRetention() {
    await this.ensureRuntime();
    return this.prisma.moderationRetentionPolicy.findUniqueOrThrow({ where: { id: 'default' } });
  }

  async updateRetention(
    actorId: string,
    input: Partial<{ caseDays: number; decisionDays: number; evidenceDays: number; shadowDays: number }>
  ) {
    await this.ensureRuntime();
    const row = await this.prisma.moderationRetentionPolicy.update({
      where: { id: 'default' },
      data: {
        ...(input.caseDays !== undefined ? { caseDays: input.caseDays } : {}),
        ...(input.decisionDays !== undefined ? { decisionDays: input.decisionDays } : {}),
        ...(input.evidenceDays !== undefined ? { evidenceDays: input.evidenceDays } : {}),
        ...(input.shadowDays !== undefined ? { shadowDays: input.shadowDays } : {}),
        updatedById: actorId
      }
    });
    await this.prisma.moderationAuditLog.create({
      data: {
        actorId,
        action: 'retention.update',
        entityType: 'ModerationRetentionPolicy',
        entityId: 'default',
        after: input as Prisma.InputJsonValue
      }
    });
    return row;
  }

  async logEvidenceAccess(actorId: string, caseId: string, action: 'view' | 'download') {
    return this.prisma.moderationEvidenceAccessLog.create({
      data: { actorId, caseId, action }
    });
  }

  async accountTransparency(userId: string) {
    const [cases, violations, state, appeals] = await Promise.all([
      this.prisma.moderationCase.findMany({
        where: {
          authorId: userId,
          status: {
            in: [
              'FLAGGED',
              'RESTRICTED',
              'HIDDEN',
              'REMOVED',
              'APPEAL_PENDING',
              'RESTORED',
              'REVIEW_FAILED',
              'PENDING_REVIEW'
            ]
          }
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        include: {
          decisions: { orderBy: { createdAt: 'desc' }, take: 1 },
          appeals: { orderBy: { createdAt: 'desc' }, take: 1 }
        }
      }),
      this.prisma.userViolation.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      this.prisma.userModerationState.findUnique({ where: { userId } }),
      this.prisma.moderationAppeal.findMany({
        where: { appellantId: userId },
        orderBy: { createdAt: 'desc' },
        take: 30
      })
    ]);

    const rawItems = await Promise.all(
      cases.map(async (c) => {
          const alive = await this.contentStillExists(c.contentType, c.contentId);
          if (!alive) return null;
          const openAppeal = c.appeals.find((a) => a.status === 'OPEN' || a.status === 'UNDER_REVIEW');
          const latestAppeal = c.appeals[0]
            ? {
                id: c.appeals[0].id,
                status: c.appeals[0].status,
                resolutionNote: c.appeals[0].resolutionNote,
                resolvedAt: c.appeals[0].resolvedAt
              }
            : null;
          const canAppeal =
            ['HIDDEN', 'RESTRICTED', 'REMOVED', 'FLAGGED', 'REVIEW_FAILED'].includes(c.status) &&
            !openAppeal;
          const preview = await this.ownerContentPreview(c.contentType, c.contentId);
          const reviewResult = this.reviewResultLabel(c.status, latestAppeal?.status || null);
          return {
            caseId: c.id,
            contentType: c.contentType,
            contentId: c.contentId,
            status: c.status,
            statusLabel: this.statusLabelAr(c.status),
            category: c.topCategory,
            userReason: c.decisions[0]?.userReason || null,
            decidedAt: c.decisions[0]?.createdAt || c.updatedAt,
            appeal: latestAppeal,
            appealLabel: this.appealLabelAr(latestAppeal?.status || null, c.status),
            reviewResult,
            canAppeal,
            canDelete: ['post', 'reel', 'story'].includes(c.contentType),
            thumbUrl: preview.thumbUrl,
            posterUrl: preview.posterUrl,
            mimeType: preview.mimeType,
            caption: preview.caption
          };
        })
    );
    const items = rawItems.filter((row): row is NonNullable<typeof row> => row != null);

    return {
      state,
      items,
      violations: violations.map((v) => ({
        id: v.id,
        category: v.category,
        penalty: v.penalty,
        severity: v.severity,
        createdAt: v.createdAt,
        expiresAt: v.expiresAt
      })),
      appeals
    };
  }

  private statusLabelAr(status: string): string {
    switch (status) {
      case 'HIDDEN':
      case 'REMOVED':
        return 'محظور';
      case 'RESTRICTED':
      case 'FLAGGED':
        return 'مقيّد';
      case 'APPEAL_PENDING':
        return 'طعن قيد المراجعة';
      case 'PENDING_REVIEW':
        return 'قيد المراجعة';
      case 'REVIEW_FAILED':
        return 'فشل الفحص';
      case 'RESTORED':
        return 'أُعيد بعد المراجعة';
      case 'APPROVED':
        return 'مسموح';
      default:
        return status;
    }
  }

  private appealLabelAr(appealStatus: string | null, caseStatus: string): string | null {
    if (caseStatus === 'APPEAL_PENDING' || appealStatus === 'OPEN' || appealStatus === 'UNDER_REVIEW') {
      return 'تم إرسال الطعن — قيد المراجعة';
    }
    if (appealStatus === 'APPROVED') return 'نتيجة الطعن: مقبول — أُعيد المحتوى';
    if (appealStatus === 'REJECTED') return 'نتيجة الطعن: مرفوض — تأكيد المخالفة';
    if (appealStatus === 'CLOSED') return 'الطعن مغلق';
    return null;
  }

  private reviewResultLabel(status: string, appealStatus: string | null): string | null {
    if (status === 'RESTORED' || status === 'APPROVED' || appealStatus === 'APPROVED') {
      return 'نتيجة الفحص: لا مخالفة — المحتوى ظاهر في ملفك الشخصي';
    }
    if (appealStatus === 'REJECTED' || status === 'HIDDEN' || status === 'REMOVED') {
      return status === 'HIDDEN' || status === 'REMOVED'
        ? 'نتيجة الفحص: مخالف — مخفي عن الملف الشخصي'
        : null;
    }
    if (status === 'APPEAL_PENDING' || appealStatus === 'OPEN' || appealStatus === 'UNDER_REVIEW') {
      return 'بانتظار نتيجة إعادة الفحص';
    }
    return null;
  }

  private async contentStillExists(contentType: string, contentId: string): Promise<boolean> {
    if (contentType === 'post') {
      const row = await this.prisma.post.findUnique({
        where: { id: contentId },
        select: { deletedAt: true }
      });
      return Boolean(row && !row.deletedAt);
    }
    if (contentType === 'reel') {
      const row = await this.prisma.reel.findUnique({
        where: { id: contentId },
        select: { deletedAt: true }
      });
      return Boolean(row && !row.deletedAt);
    }
    if (contentType === 'story') {
      const row = await this.prisma.story.findUnique({
        where: { id: contentId },
        select: { deletedAt: true }
      });
      return Boolean(row && !row.deletedAt);
    }
    return true;
  }

  /** Owner-only thumbnail for restricted-content transparency cards. */
  private async ownerContentPreview(
    contentType: string,
    contentId: string
  ): Promise<{
    thumbUrl: string | null;
    posterUrl: string | null;
    mimeType: string | null;
    caption: string | null;
  }> {
    const empty = { thumbUrl: null, posterUrl: null, mimeType: null, caption: null };
    if (!this.mediaStorage) return empty;
    try {
      if (contentType === 'post') {
        const post = await this.prisma.post.findUnique({
          where: { id: contentId },
          select: {
            caption: true,
            media: {
              orderBy: { sortOrder: 'asc' },
              take: 1,
              select: {
                media: {
                  select: { id: true, storageKey: true, thumbnailKey: true, mimeType: true }
                }
              }
            }
          }
        });
        const media = post?.media[0]?.media;
        if (!media) return { ...empty, caption: post?.caption || null };
        return {
          ...(await this.previewUrlsForMedia(media)),
          caption: post?.caption || null
        };
      }
      if (contentType === 'reel') {
        const reel = await this.prisma.reel.findUnique({
          where: { id: contentId },
          select: {
            caption: true,
            thumbnailMediaId: true,
            media: {
              select: { id: true, storageKey: true, thumbnailKey: true, mimeType: true }
            }
          }
        });
        if (!reel?.media) return { ...empty, caption: reel?.caption || null };
        let urls = await this.previewUrlsForMedia(reel.media);
        if (!urls.posterUrl && reel.thumbnailMediaId) {
          const thumb = await this.prisma.mediaAsset.findFirst({
            where: { id: reel.thumbnailMediaId, deletedAt: null },
            select: { id: true, storageKey: true, mimeType: true }
          });
          if (thumb) {
            const posterUrl = await this.mediaStorage
              .createReadUrl(thumb.id, thumb.storageKey)
              .catch(() => null);
            urls = { ...urls, posterUrl, thumbUrl: posterUrl || urls.thumbUrl };
          }
        }
        return { ...urls, caption: reel.caption || null };
      }
      if (contentType === 'story') {
        const story = await this.prisma.story.findUnique({
          where: { id: contentId },
          select: {
            media: {
              select: { id: true, storageKey: true, thumbnailKey: true, mimeType: true }
            }
          }
        });
        if (!story?.media) return empty;
        return { ...(await this.previewUrlsForMedia(story.media)), caption: null };
      }
    } catch (err) {
      this.logger.warn(
        `owner preview failed ${contentType}/${contentId}: ${err instanceof Error ? err.message : 'error'}`
      );
    }
    return empty;
  }

  private async previewUrlsForMedia(media: {
    id: string;
    storageKey: string;
    thumbnailKey?: string | null;
    mimeType: string;
  }) {
    let posterUrl: string | null = null;
    if (media.thumbnailKey) {
      posterUrl = await this.mediaStorage!
        .createReadUrl(media.id, media.thumbnailKey)
        .catch(() => null);
    }
    const thumbUrl = await this.mediaStorage!
      .createReadUrl(media.id, media.storageKey)
      .catch(() => null);
    return {
      thumbUrl: posterUrl || thumbUrl,
      posterUrl,
      mimeType: media.mimeType
    };
  }

  /** Audit log is append-only — API refuses delete. */
  refuseAuditDelete(): never {
    throw new BadRequestException('audit_log_immutable');
  }
}

function groupCount(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] || 0) + 1;
  return out;
}

export type { SafetyHit };
