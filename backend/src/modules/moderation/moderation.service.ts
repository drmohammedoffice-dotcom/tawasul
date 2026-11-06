import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TawasulAiClient } from '../ai/tawasul-ai.client';
import { MediaStorageService } from '../media/media.storage';
import { PrismaService } from '../prisma/prisma.service';
import { mergeHits, scanTextSafety, type SafetyHit } from './engine/safety-scanner';
import { FingerprintService } from './fingerprint.service';
import { ModerationGovernanceService } from './moderation-governance.service';
import { ModerationPolicyService } from './moderation-policy.service';
import type { PolicyCategory } from './policy/default-policy';
import { RiskScoreService } from './risk-score.service';
import { ownerBadge, type ModerationStatus } from './moderation.visibility';

const MAX_ATTEMPTS = 3;
const IMAGE_MIME = /^image\//i;
const AV_MIME = /^(audio|video)\//i;

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);
  private kicking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ModerationPolicyService,
    private readonly fingerprints: FingerprintService,
    private readonly risk: RiskScoreService,
    private readonly governance: ModerationGovernanceService,
    @Optional() private readonly tawasulAi?: TawasulAiClient,
    @Optional() private readonly mediaStorage?: MediaStorageService
  ) {}

  enqueue(contentType: string, contentId: string, priority = 50): void {
    void this.enqueueAsync(contentType, contentId, priority).catch((err) => {
      this.logger.warn(`moderation enqueue skipped: ${err instanceof Error ? err.message : 'error'}`);
    });
  }

  async enqueueAsync(
    contentType: string,
    contentId: string,
    priority = 50,
    opts?: { force?: boolean; status?: ModerationStatus }
  ): Promise<void> {
    const packed = await this.loadBundle(contentType, contentId);
    if (!packed) return;
    const hash = packed.contentHash;
    const existingJob = await this.prisma.moderationJob.findUnique({
      where: {
        contentType_contentId_contentHash: { contentType, contentId, contentHash: hash }
      }
    });
    if (
      !opts?.force &&
      existingJob &&
      (existingJob.status === 'done' || existingJob.status === 'running')
    ) {
      return;
    }

    await this.prisma.moderationJob.upsert({
      where: {
        contentType_contentId_contentHash: { contentType, contentId, contentHash: hash }
      },
      create: {
        contentType,
        contentId,
        contentHash: hash,
        status: 'pending',
        priority,
        runAfter: new Date()
      },
      update: {
        status: 'pending',
        runAfter: new Date(),
        lastError: null,
        priority,
        ...(opts?.force ? { attempts: 0 } : {})
      }
    });

    await this.setContentStatus(
      contentType,
      contentId,
      opts?.status || 'PENDING_REVIEW',
      packed.fingerprint
    );
    this.kick();
  }

  kick(): void {
    if (this.kicking) return;
    this.kicking = true;
    setImmediate(() => {
      void this.processBatch(3)
        .catch((err) => {
          this.logger.warn(`moderation batch failed: ${err instanceof Error ? err.message : 'error'}`);
        })
        .finally(() => {
          this.kicking = false;
        });
    });
  }

  async processBatch(limit = 3): Promise<{ done: number; failed: number }> {
    const jobs = await this.prisma.moderationJob.findMany({
      where: { status: 'pending', runAfter: { lte: new Date() } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: Math.min(Math.max(limit, 1), 8)
    });
    let done = 0;
    let failed = 0;
    for (const job of jobs) {
      const claimed = await this.prisma.moderationJob.updateMany({
        where: { id: job.id, status: 'pending' },
        data: { status: 'running', attempts: { increment: 1 } }
      });
      if (!claimed.count) continue;
      try {
        await this.processOne(job.contentType, job.contentId, job.contentHash, job.id);
        await this.prisma.moderationJob.update({
          where: { id: job.id },
          data: { status: 'done', lastError: null }
        });
        done += 1;
      } catch (err) {
        const message = (err instanceof Error ? err.message : 'error').slice(0, 200);
        const attempts = job.attempts + 1;
        const again = attempts < MAX_ATTEMPTS;
        await this.prisma.moderationJob.update({
          where: { id: job.id },
          data: {
            status: again ? 'pending' : 'failed',
            lastError: message,
            runAfter: new Date(Date.now() + attempts * 45_000)
          }
        });
        if (!again) failed += 1;
        // Fail-closed: leave PENDING_REVIEW / REVIEW_FAILED — never auto-approve on failure.
        this.logger.warn(`moderation job failed: ${message}`);
        if (!again) {
          await this.setContentStatus(job.contentType, job.contentId, 'REVIEW_FAILED').catch(() => undefined);
        }
      }
    }
    return { done, failed };
  }

  async ownerStatus(viewerId: string, contentType: string, contentId: string) {
    const authorId = await this.contentAuthorId(contentType, contentId);
    if (!authorId) throw new NotFoundException('content_not_found');
    if (authorId !== viewerId) throw new ForbiddenException('not_owner');
    const status = await this.contentStatus(contentType, contentId);
    const caseRow = await this.prisma.moderationCase.findFirst({
      where: { contentType, contentId },
      orderBy: { updatedAt: 'desc' },
      include: {
        decisions: { orderBy: { createdAt: 'desc' }, take: 1 },
        appeals: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    });
    const badge = ownerBadge(status);
    return {
      contentType,
      contentId,
      status,
      badge: badge?.badge || null,
      canAppeal: Boolean(badge?.canAppeal),
      userReason: caseRow?.decisions[0]?.userReason || null,
      appeal: caseRow?.appeals[0]
        ? { id: caseRow.appeals[0].id, status: caseRow.appeals[0].status }
        : null
    };
  }

  async fileReport(
    reporterId: string,
    input: { targetType: string; targetId: string; reason: string; details?: string }
  ) {
    const allowed = [
      'post',
      'reel',
      'story',
      'comment',
      'reel_comment',
      'user',
      'avatar',
      'channel',
      'group'
    ];
    if (!allowed.includes(input.targetType)) throw new BadRequestException('bad_target_type');
    // Private messages are never auto-scanned; report of type message is allowed only as explicit user action.
    if (input.targetType === 'message') {
      throw new BadRequestException('use_message_report_endpoint');
    }

    const recent = await this.prisma.report.count({
      where: {
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }
    });
    if (recent >= 5) {
      await this.prisma.report.create({
        data: {
          reporterId,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason.slice(0, 80),
          details: input.details?.slice(0, 500) || null,
          status: 'abusive',
          priority: 10
        }
      });
      return { filed: true, status: 'abusive', note: 'rate_limited' };
    }

    const abuse = await this.governance.evaluateReportAbuse(reporterId);
    if (abuse.abusive) {
      await this.prisma.report.create({
        data: {
          reporterId,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason.slice(0, 80),
          details: input.details?.slice(0, 500) || null,
          status: 'abusive',
          priority: 5
        }
      });
      return { filed: true, status: 'abusive', note: 'reporter_abuse_pattern', score: abuse.score };
    }

    const priority = reportPriority(input.reason);
    const row = await this.prisma.report.create({
      data: {
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason.slice(0, 80),
        details: input.details?.slice(0, 500) || null,
        status: 'open',
        priority
      }
    });

    if (['post', 'reel', 'story', 'comment', 'reel_comment'].includes(input.targetType)) {
      this.enqueue(input.targetType, input.targetId, priority);
    }
    return { filed: true, id: row.id, status: row.status, priority };
  }

  async createAppeal(userId: string, caseId: string, statement: string) {
    const caseRow = await this.prisma.moderationCase.findUnique({ where: { id: caseId } });
    if (!caseRow) throw new NotFoundException('case_not_found');
    if (caseRow.authorId !== userId) throw new ForbiddenException('not_owner');
    if (!['HIDDEN', 'RESTRICTED', 'REMOVED', 'FLAGGED', 'REVIEW_FAILED'].includes(caseRow.status)) {
      throw new BadRequestException('appeal_not_allowed');
    }
    const open = await this.prisma.moderationAppeal.findFirst({
      where: { caseId, status: { in: ['OPEN', 'UNDER_REVIEW'] } }
    });
    if (open) throw new BadRequestException('appeal_already_open');
    const closedFinal = await this.prisma.moderationAppeal.findFirst({
      where: { caseId, status: 'CLOSED' },
      orderBy: { createdAt: 'desc' }
    });
    if (closedFinal) throw new BadRequestException('appeal_closed_final');

    const appeal = await this.prisma.moderationAppeal.create({
      data: {
        caseId,
        appellantId: userId,
        statement: statement.slice(0, 2000),
        status: 'OPEN',
        previousActorId: caseRow.lastDecisionId
      }
    });
    await this.applyStatus(caseRow.contentType, caseRow.contentId, caseId, 'APPEAL_PENDING');
    // Force a fresh scan job even if a prior job for the same hash is already "done".
    await this.enqueueAsync(caseRow.contentType, caseRow.contentId, 80, {
      force: true,
      status: 'APPEAL_PENDING'
    });
    return appeal;
  }

  async resolveAppeal(
    reviewerId: string,
    appealId: string,
    input: { approve: boolean; note?: string }
  ) {
    const appeal = await this.prisma.moderationAppeal.findUnique({
      where: { id: appealId },
      include: { case: true }
    });
    if (!appeal) throw new NotFoundException('appeal_not_found');
    if (!['OPEN', 'UNDER_REVIEW'].includes(appeal.status)) {
      throw new BadRequestException('appeal_not_open');
    }
    // Prefer different reviewer than first decision actor when recorded.
    await this.prisma.moderationAppeal.update({
      where: { id: appealId },
      data: { status: 'UNDER_REVIEW', reviewerId }
    });

    if (input.approve) {
      const decision = await this.recordDecision({
        caseId: appeal.caseId,
        actorType: 'appeal',
        actorId: reviewerId,
        action: 'restore',
        resultingStatus: 'RESTORED',
        reasonCode: 'appeal_approved',
        userReason: 'تم قبول الطعن وإعادة المحتوى.',
        ...(input.note ? { notes: input.note } : {})
      });
      await this.prisma.moderationAppeal.update({
        where: { id: appealId },
        data: {
          status: 'APPROVED',
          decisionId: decision.id,
          resolutionNote: input.note?.slice(0, 500) || null,
          resolvedAt: new Date()
        }
      });
      await this.notifyAuthor(
        appeal.case.authorId,
        'تم قبول طعنك وأُعيد المحتوى.',
        appeal.case.contentType,
        appeal.case.contentId
      );
      return { appealId, status: 'APPROVED' };
    }

    const decision = await this.recordDecision({
      caseId: appeal.caseId,
      actorType: 'appeal',
      actorId: reviewerId,
      action: 'remove',
      resultingStatus: 'REMOVED',
      reasonCode: 'appeal_rejected',
      userReason: 'تم رفض الطعن وتأكيد المخالفة.',
      ...(input.note ? { notes: input.note } : {})
    });
    await this.prisma.moderationAppeal.update({
      where: { id: appealId },
      data: {
        status: 'REJECTED',
        decisionId: decision.id,
        resolutionNote: input.note?.slice(0, 500) || null,
        resolvedAt: new Date()
      }
    });
    await this.maybePenalize(appeal.case.authorId, appeal.caseId, appeal.case.topCategory || 'policy', 80);
    await this.notifyAuthor(
      appeal.case.authorId,
      'تم رفض الطعن وتثبيت قرار الحظر.',
      appeal.case.contentType,
      appeal.case.contentId
    );
    return { appealId, status: 'REJECTED' };
  }

  async staffDecide(
    actorId: string,
    caseId: string,
    input: {
      action: 'approve' | 'flag' | 'restrict' | 'hide' | 'remove' | 'restore' | 'permanent_delete';
      note?: string;
      category?: string;
    }
  ) {
    const caseRow = await this.prisma.moderationCase.findUnique({ where: { id: caseId } });
    if (!caseRow) throw new NotFoundException('case_not_found');
    const statusMap: Record<string, ModerationStatus> = {
      approve: 'APPROVED',
      flag: 'FLAGGED',
      restrict: 'RESTRICTED',
      hide: 'HIDDEN',
      remove: 'REMOVED',
      restore: 'RESTORED',
      permanent_delete: 'PERMANENTLY_DELETED'
    };
    const resultingStatus = statusMap[input.action];
    if (!resultingStatus) throw new BadRequestException('bad_action');
    const category = input.category || caseRow.topCategory || undefined;
    const decision = await this.recordDecision({
      caseId,
      actorType: 'human',
      actorId,
      action: input.action,
      resultingStatus,
      ...(category ? { category } : {}),
      reasonCode: `staff_${input.action}`,
      userReason: userReasonFor(input.action, input.category || caseRow.topCategory),
      ...(input.note ? { notes: input.note } : {})
    });
    if (['remove', 'permanent_delete', 'hide'].includes(input.action)) {
      await this.maybePenalize(
        caseRow.authorId,
        caseId,
        input.category || caseRow.topCategory || 'policy',
        input.action === 'permanent_delete' ? 100 : 70
      );
    }
    return decision;
  }

  async assertCanPublish(userId: string): Promise<void> {
    const state = await this.prisma.userModerationState.findUnique({ where: { userId } });
    if (!state) return;
    if (state.state === 'disabled' || state.state === 'suspended') {
      throw new ForbiddenException('account_moderation_blocked');
    }
    if (!state.canPublish) {
      if (state.publishBlockedUntil && state.publishBlockedUntil > new Date()) {
        throw new ForbiddenException('publish_temporarily_blocked');
      }
    }
  }

  async setAccountState(
    actorId: string,
    userId: string,
    input: { state: 'warned' | 'restricted' | 'suspended' | 'disabled' | 'none'; days?: number }
  ) {
    const until =
      input.state === 'suspended' || input.state === 'restricted'
        ? new Date(Date.now() + (input.days || 7) * 86400_000)
        : null;
    const blocked = ['suspended', 'disabled', 'restricted'].includes(input.state);
    const row = await this.prisma.userModerationState.upsert({
      where: { userId },
      create: {
        userId,
        state: input.state,
        canPublish: !blocked,
        canComment: input.state !== 'disabled' && input.state !== 'suspended',
        publishBlockedUntil: until,
        updatedById: actorId,
        reasonCode: input.state
      },
      update: {
        state: input.state,
        canPublish: !blocked,
        canComment: input.state !== 'disabled' && input.state !== 'suspended',
        publishBlockedUntil: until,
        updatedById: actorId,
        reasonCode: input.state
      }
    });
    await this.prisma.moderationAuditLog.create({
      data: {
        actorId,
        action: `account.${input.state}`,
        entityType: 'User',
        entityId: userId,
        after: { state: input.state } as Prisma.InputJsonValue
      }
    });
    await this.prisma.userViolation.create({
      data: {
        userId,
        category: 'admin_action',
        severity: input.state === 'disabled' ? 100 : 70,
        penalty:
          input.state === 'disabled'
            ? 'disable'
            : input.state === 'suspended'
              ? 'suspend'
              : 'warning',
        createdById: actorId
      }
    });
    return row;
  }

  async adminQueues(limit = 40) {
    const take = Math.min(Math.max(limit, 1), 100);
    const [pending, flagged, hidden, appeals, reports, critical] = await Promise.all([
      this.prisma.moderationCase.findMany({
        where: { status: 'PENDING_REVIEW' },
        orderBy: { updatedAt: 'desc' },
        take
      }),
      this.prisma.moderationCase.findMany({
        where: { status: { in: ['FLAGGED', 'RESTRICTED'] } },
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        take
      }),
      this.prisma.moderationCase.findMany({
        where: { status: { in: ['HIDDEN', 'REMOVED', 'APPEAL_PENDING'] } },
        orderBy: { updatedAt: 'desc' },
        take
      }),
      this.prisma.moderationAppeal.findMany({
        where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
        orderBy: { createdAt: 'asc' },
        take,
        include: { case: true }
      }),
      this.prisma.report.findMany({
        where: { status: 'open' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take
      }),
      this.prisma.moderationCase.findMany({
        where: {
          OR: [{ critical: true }, { emergency: true }],
          status: { notIn: ['APPROVED', 'RESTORED'] }
        },
        orderBy: [{ emergency: 'desc' }, { riskScore: 'desc' }, { updatedAt: 'desc' }],
        take
      })
    ]);
    return { pending, flagged, hidden, appeals, reports, critical, emergency: critical };
  }

  async getCase(caseId: string, actorId?: string) {
    const row = await this.prisma.moderationCase.findUnique({
      where: { id: caseId },
      include: {
        findings: { orderBy: { createdAt: 'desc' } },
        decisions: { orderBy: { createdAt: 'desc' } },
        appeals: { orderBy: { createdAt: 'desc' } },
        jobs: { orderBy: { createdAt: 'desc' }, take: 5 }
      }
    });
    if (row && actorId) {
      await this.governance.logEvidenceAccess(actorId, caseId, 'view');
    }
    return row;
  }

  async assignCase(actorId: string, caseId: string, reviewerId: string) {
    const row = await this.prisma.moderationCase.update({
      where: { id: caseId },
      data: { assignedReviewerId: reviewerId, needsHuman: true }
    });
    await this.prisma.moderationAuditLog.create({
      data: {
        actorId,
        action: 'case.assign',
        entityType: 'ModerationCase',
        entityId: caseId,
        after: { reviewerId } as Prisma.InputJsonValue
      }
    });
    return row;
  }

  // ─── internals ───────────────────────────────────────────────

  private async processOne(
    contentType: string,
    contentId: string,
    contentHash: string,
    jobId: string
  ) {
    const packed = await this.loadBundle(contentType, contentId);
    if (!packed) throw new Error('content_missing');

    const runtime = await this.governance.runtime().catch(() => null);
    const ahashThreshold = runtime?.ahashThreshold ?? 8;

    // Media fingerprint matches (sha256 exact + aHash near-dupe)
    for (const media of packed.media) {
      if (!media.path) continue;
      const matches = await this.fingerprints.findMatches(media.path, { ahashThreshold });
      const blocked = matches.find((m) => m.blocked && (m.kind === 'sha256' || (m.confidence ?? 0) >= 0.75));
      if (blocked) {
        // Weak aHash-only (high distance) → human review, not auto-hide
        const weak =
          blocked.kind === 'ahash' && (blocked.distance ?? 0) > Math.max(3, ahashThreshold - 3);
        const caseRow = await this.upsertCase({
          contentType,
          contentId,
          authorId: packed.authorId,
          contentHash,
          fingerprint: packed.fingerprint,
          status: weak ? 'FLAGGED' : 'HIDDEN',
          priority: weak ? 70 : 98,
          topCategory: 'sexual',
          topConfidence: blocked.confidence,
          needsHuman: true,
          critical: !weak,
          emergency: !weak && blocked.kind === 'sha256',
          riskScore: weak ? 55 : 92,
          summary: `media_${blocked.kind}_match`
        });
        await this.prisma.moderationFinding.create({
          data: {
            caseId: caseRow.id,
            source: 'fingerprint',
            category: 'sexual',
            confidence: blocked.confidence,
            severity: weak ? 60 : 95,
            evidence: {
              kind: blocked.kind,
              distance: blocked.distance ?? null,
              priorCaseId: blocked.priorCaseId
            } as Prisma.InputJsonValue
          }
        });
        await this.recordDecision({
          caseId: caseRow.id,
          actorType: 'auto',
          action: weak ? 'flag' : 'hide',
          resultingStatus: weak ? 'FLAGGED' : 'HIDDEN',
          category: 'sexual',
          confidence: blocked.confidence,
          reasonCode: weak ? 'fingerprint_near_uncertain' : 'fingerprint_media_match',
          userReason: weak
            ? 'تشابه محتمل مع محتوى محظور — قيد المراجعة.'
            : 'يبدو أن هذا الملف أُزيل سابقاً لخرق السياسة.'
        });
        await this.prisma.moderationJob.update({
          where: { id: jobId },
          data: { caseId: caseRow.id }
        });
        if (!weak) {
          await this.raiseEmergency(caseRow.id, packed.authorId, 'fingerprint_reupload');
        }
        return;
      }
      // Store non-blocked hashes for later registration if we hide
      for (const m of matches) {
        if (!m.blocked && m.value) {
          await this.prisma.moderationFingerprint.upsert({
            where: { kind_value: { kind: m.kind, value: m.value } },
            create: {
              kind: m.kind,
              value: m.value,
              blocked: false,
              contentType,
              contentId,
              confidence: m.confidence
            },
            update: { contentType, contentId }
          });
        }
      }
    }

    // Legacy contentFingerprint string match
    if (packed.fingerprint) {
      const prior = await this.prisma.moderationCase.findFirst({
        where: {
          fingerprint: packed.fingerprint,
          status: { in: ['REMOVED', 'PERMANENTLY_DELETED', 'HIDDEN'] },
          NOT: { contentId }
        },
        orderBy: { updatedAt: 'desc' }
      });
      if (prior) {
        const caseRow = await this.upsertCase({
          contentType,
          contentId,
          authorId: packed.authorId,
          contentHash,
          fingerprint: packed.fingerprint,
          status: 'HIDDEN',
          priority: 95,
          topCategory: prior.topCategory || 'sexual',
          topConfidence: 0.9,
          needsHuman: true,
          critical: Boolean(prior.critical),
          emergency: Boolean(prior.critical),
          riskScore: 90,
          summary: 'fingerprint_match_prior_removed'
        });
        await this.prisma.moderationFinding.create({
          data: {
            caseId: caseRow.id,
            source: 'fingerprint',
            category: prior.topCategory || 'sexual',
            confidence: 0.9,
            severity: 90,
            evidence: { priorCaseId: prior.id } as Prisma.InputJsonValue
          }
        });
        await this.recordDecision({
          caseId: caseRow.id,
          actorType: 'auto',
          action: 'hide',
          resultingStatus: 'HIDDEN',
          ...(prior.topCategory ? { category: prior.topCategory } : {}),
          confidence: 0.9,
          reasonCode: 'fingerprint_match',
          userReason: 'يبدو أن هذا المحتوى أُزيل سابقاً لخرق السياسة.'
        });
        await this.prisma.moderationJob.update({
          where: { id: jobId },
          data: { caseId: caseRow.id }
        });
        if (prior.critical) await this.raiseEmergency(caseRow.id, packed.authorId, 'critical_reupload');
        return;
      }
    }

    const textScan = scanTextSafety({
      text: packed.text,
      hashtags: packed.hashtags,
      source: 'text'
    });
    const parts = [textScan];
    const correlationId = `mod:${contentType}:${contentId}:${contentHash.slice(0, 10)}`;
    let imageScanComplete = true;
    let imageScanMissing = false;
    const imageHits: ReturnType<typeof scanTextSafety>['hits'] = [];

    const imageMedia = packed.media.filter(
      (m) => IMAGE_MIME.test(m.mimeType) || m.mediaType === 'image'
    );
    if (imageMedia.length) {
      for (const media of imageMedia) {
        if (!media.path) {
          imageScanComplete = false;
          imageScanMissing = true;
          this.logger.warn(`${correlationId} media ${media.id} has no local path — cannot NSFW-scan`);
          continue;
        }
        let nsfw = {
          ok: false,
          inference: false,
          label: null as string | null,
          nsfwScore: null as number | null,
          modelId: null as string | null,
          modelVersion: null as string | null
        };
        if (this.tawasulAi?.enabled()) {
          try {
            const job = await this.tawasulAi.enqueueAndWait(
              {
                type: 'image.analyze',
                payload: { path: media.path },
                idempotencyKey: `mod-img:${contentType}:${contentId}:${contentHash}:${media.id}`,
                priority: 6
              },
              { timeoutMs: 180_000, intervalMs: 1000 }
            );
            nsfw = extractNsfw(job?.result);
            const ocrText = extractOcrText(job?.result);
            if (ocrText) {
              parts.push(scanTextSafety({ text: ocrText, source: 'ocr' }));
            }
          } catch (err) {
            this.logger.warn(
              `${correlationId} AI image.analyze failed: ${err instanceof Error ? err.message : 'error'}`
            );
          }
        }
        if (!nsfw.ok || !nsfw.inference) {
          const local = this.fingerprints.classifyNsfw(media.path);
          if (local) {
            nsfw = {
              ok: true,
              inference: true,
              label: local.label,
              nsfwScore: local.nsfwScore,
              modelId: local.modelId,
              modelVersion: local.modelVersion
            };
          }
        }
        this.logger.log(
          `${correlationId} nsfw media=${media.id} ok=${nsfw.ok} label=${nsfw.label} score=${nsfw.nsfwScore} model=${nsfw.modelId}`
        );
        if (!nsfw.ok || !nsfw.inference) {
          imageScanComplete = false;
          imageScanMissing = true;
          continue;
        }
        if (nsfw.label === 'nsfw' || (nsfw.nsfwScore ?? 0) >= 0.72) {
          imageHits.push({
            category: 'sexual',
            confidence: Math.min(0.99, nsfw.nsfwScore ?? 0.9),
            severity: 95,
            source: 'image',
            indicators: [`nsfw:${nsfw.label}`, `model:${nsfw.modelVersion || nsfw.modelId}`],
            needsHuman: false,
            critical: true
          });
        } else if (nsfw.label === 'uncertain' || (nsfw.nsfwScore ?? 0) >= 0.45) {
          imageHits.push({
            category: 'sexual',
            confidence: Math.min(0.8, nsfw.nsfwScore ?? 0.5),
            severity: 70,
            source: 'image',
            indicators: [`nsfw:uncertain`, `model:${nsfw.modelVersion || nsfw.modelId}`],
            needsHuman: true,
            critical: false
          });
        }
      }
    }

    // Video: frame NSFW across timeline (not thumbnail-only) + optional transcript
    let videoScanComplete = true;
    const videoMedia = packed.media.filter(
      (m) => /video\//i.test(m.mimeType) || m.mediaType === 'video'
    );
    for (const media of videoMedia) {
      if (!media.path) {
        videoScanComplete = false;
        imageScanMissing = true;
        continue;
      }
      const local = this.fingerprints.classifyVideoNsfw(media.path);
      this.logger.log(
        `${correlationId} video-nsfw media=${media.id} ok=${Boolean(local)} label=${local?.label} score=${local?.nsfwScore}`
      );
      if (!local) {
        videoScanComplete = false;
        imageScanMissing = true;
      } else if (local.label === 'nsfw' || local.nsfwScore >= 0.72) {
        imageHits.push({
          category: 'sexual',
          confidence: Math.min(0.99, local.nsfwScore),
          severity: 95,
          source: 'image',
          indicators: [`video_nsfw:${local.label}`, `model:${local.modelVersion || local.modelId}`],
          needsHuman: false,
          critical: true
        });
      } else if (local.label === 'uncertain' || local.nsfwScore >= 0.45) {
        imageHits.push({
          category: 'sexual',
          confidence: Math.min(0.8, local.nsfwScore),
          severity: 70,
          source: 'image',
          indicators: [`video_nsfw:uncertain`, `model:${local.modelVersion || local.modelId}`],
          needsHuman: true,
          critical: false
        });
      }
      if (this.tawasulAi?.enabled()) {
        try {
          const job = await this.tawasulAi.enqueueAndWait(
            {
              type: 'video.analyze',
              payload: { path: media.path },
              idempotencyKey: `mod-av:${contentType}:${contentId}:${contentHash}:${media.id}`,
              priority: 7
            },
            { timeoutMs: 180_000, intervalMs: 1500 }
          );
          const transcript = extractTranscript(job?.result);
          if (transcript) {
            parts.push(scanTextSafety({ text: transcript, source: 'audio' }));
          }
        } catch {
          /* transcript optional */
        }
      }
    }

    // Audio-only: transcript enrichment
    if (this.tawasulAi?.enabled()) {
      for (const media of packed.media) {
        if (!media.path) continue;
        if (IMAGE_MIME.test(media.mimeType) || media.mediaType === 'image') continue;
        if (/video\//i.test(media.mimeType) || media.mediaType === 'video') continue;
        if (AV_MIME.test(media.mimeType) || media.mediaType === 'audio') {
          const job = await this.tawasulAi.enqueueAndWait(
            {
              type: 'audio.transcribe',
              payload: { path: media.path },
              idempotencyKey: `mod-av:${contentType}:${contentId}:${contentHash}:${media.id}`,
              priority: 7
            },
            { timeoutMs: 180_000, intervalMs: 1500 }
          );
          const transcript = extractTranscript(job?.result);
          if (transcript) {
            parts.push(scanTextSafety({ text: transcript, source: 'audio' }));
          }
        }
      }
    }

    if (imageHits.length) {
      parts.push({
        hits: imageHits,
        top: imageHits[0] || null,
        contextualSafe: false,
        normalizedText: '',
        contentHash
      });
    }

    const mediaScanIncomplete =
      (imageMedia.length > 0 && !imageScanComplete) || (videoMedia.length > 0 && !videoScanComplete);

    const merged = mergeHits(parts);
    const active = await this.policy.active();
    const catMap = this.policy.categoryMap(active.categories);
    const actionable = pickActionable(merged.hits, catMap);

    const priorConfirmed = await this.prisma.userViolation.count({
      where: {
        userId: packed.authorId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    });
    const reportCount = await this.prisma.report.count({
      where: { targetType: contentType, targetId: contentId, status: 'open' }
    });
    const evasionHints = merged.hits.filter((h) =>
      h.indicators.some((i) => i === 'arabizi_fold' || i.includes('fold'))
    ).length;
    const riskScore = this.risk.scoreCase({
      hits: merged.hits,
      priorConfirmed,
      evasionHints,
      reportCount
    });

    const emergency =
      Boolean(actionable?.critical) &&
      (actionable?.category === 'csam' ||
        (actionable?.category === 'violence' && (actionable?.confidence || 0) >= 0.85) ||
        (actionable?.category === 'sexual' && (actionable?.confidence || 0) >= 0.9));

    const caseRow = await this.upsertCase({
      contentType,
      contentId,
      authorId: packed.authorId,
      contentHash,
      fingerprint: packed.fingerprint,
      status: 'PENDING_REVIEW',
      priority: emergency ? 100 : actionable?.critical ? 95 : actionable ? Math.round(actionable.severity) : 40,
      topCategory: actionable?.category || null,
      topConfidence: actionable?.confidence || 0,
      needsHuman:
        !actionable ||
        actionable.needsHuman ||
        Boolean(actionable && catMap.get(actionable.category)?.humanReview) ||
        emergency,
      critical: Boolean(actionable?.critical),
      emergency,
      riskScore,
      summary: actionable
        ? `${actionable.category}@${actionable.confidence.toFixed(2)}`
        : 'clean',
      policyVersionId: active.versionId,
      policyVersion: active.version
    });

    await this.prisma.moderationFinding.deleteMany({ where: { caseId: caseRow.id } });
    if (merged.hits.length) {
      await this.prisma.moderationFinding.createMany({
        data: merged.hits.map((hit) => ({
          caseId: caseRow.id,
          source: hit.source,
          category: hit.category,
          confidence: hit.confidence,
          severity: hit.severity,
          evidence: { indicators: hit.indicators } as Prisma.InputJsonValue,
          modelId: 'tawasul-safety-rules-1'
        }))
      });
    }

    await this.prisma.moderationJob.update({
      where: { id: jobId },
      data: { caseId: caseRow.id }
    });

    let liveAction = 'approve';
    // Fail-closed: never treat unscanned images/videos as safe / never invent confidence.
    if (!actionable && mediaScanIncomplete) {
      liveAction = 'hold';
      await this.recordDecision({
        caseId: caseRow.id,
        actorType: 'auto',
        action: 'flag',
        resultingStatus: imageScanMissing ? 'REVIEW_FAILED' : 'PENDING_REVIEW',
        reasonCode: 'media_scan_incomplete',
        userReason: 'منشورك قيد الفحص. سيظهر للعامة بعد اكتمال المراجعة فقط.',
        policyVersion: active.version,
        confidence: 0
      });
      await this.upsertCase({
        contentType,
        contentId,
        authorId: packed.authorId,
        contentHash,
        fingerprint: packed.fingerprint,
        status: imageScanMissing ? 'REVIEW_FAILED' : 'PENDING_REVIEW',
        priority: 85,
        topCategory: null,
        topConfidence: 0,
        needsHuman: true,
        critical: false,
        riskScore,
        summary: 'media_scan_incomplete',
        policyVersionId: active.versionId,
        policyVersion: active.version
      });
      this.logger.warn(`${correlationId} hold — media NSFW scan incomplete`);
    } else if (!actionable) {
      const openAppeal = await this.prisma.moderationAppeal.findFirst({
        where: { caseId: caseRow.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } }
      });
      const restore = Boolean(openAppeal) || caseRow.status === 'APPEAL_PENDING';
      const decision = await this.recordDecision({
        caseId: caseRow.id,
        actorType: 'auto',
        action: restore ? 'restore' : 'approve',
        resultingStatus: restore ? 'RESTORED' : 'APPROVED',
        reasonCode: restore ? 'appeal_rescan_clean' : 'auto_clean',
        userReason: restore ? 'تمت إعادة الفحص ولم تُرصد مخالفة — أُعيد المحتوى.' : null,
        policyVersion: active.version,
        confidence: 0
      });
      if (openAppeal) {
        await this.closeOpenAppeals(caseRow.id, decision.id, true, 'إعادة الفحص: لا مخالفة');
        await this.notifyAuthor(
          packed.authorId,
          'تم قبول طعنك بعد إعادة الفحص وأُعيد المحتوى إلى ملفك.',
          contentType,
          contentId
        );
      }
    } else {
      const policyCat = catMap.get(actionable.category);
      const action = emergency ? 'hide' : resolveAutoAction(actionable, policyCat);
      liveAction = action;
      const status = emergency ? 'HIDDEN' : actionToStatus(action);
      await this.recordDecision({
        caseId: caseRow.id,
        actorType: 'auto',
        action,
        resultingStatus: status,
        category: actionable.category,
        confidence: actionable.confidence,
        reasonCode: emergency ? `emergency_${actionable.category}` : `auto_${actionable.category}`,
        userReason: policyCat?.userReason || 'يخالف سياسة مجتمع تواصل.',
        policyVersion: active.version
      });

      if (['hide', 'remove'].includes(action) || emergency) {
        await this.blockMediaFingerprints(packed.media, contentType, contentId, caseRow.id);
        const openAppeal = await this.prisma.moderationAppeal.findFirst({
          where: { caseId: caseRow.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } }
        });
        if (openAppeal) {
          const last = await this.prisma.moderationDecision.findFirst({
            where: { caseId: caseRow.id },
            orderBy: { createdAt: 'desc' }
          });
          if (last) {
            await this.closeOpenAppeals(
              caseRow.id,
              last.id,
              false,
              'إعادة الفحص: تأكيد المخالفة'
            );
          }
          await this.notifyAuthor(
            packed.authorId,
            'تم رفض الطعن بعد إعادة الفحص وتأكيد المخالفة.',
            contentType,
            contentId
          );
        } else {
          await this.notifyAuthor(
            packed.authorId,
            'تم تقييد محتوى لك لمخالفة سياسة المجتمع. يمكنك تقديم طعن إن كان القرار خاطئاً.',
            contentType,
            contentId
          );
        }
      }
      if (emergency) {
        await this.raiseEmergency(caseRow.id, packed.authorId, actionable.category);
      }
      await this.risk.refreshUserRisk(packed.authorId);
    }

    // Shadow: analyze/compare only — never mutates status again.
    if (runtime?.shadowEnabled && runtime.shadowPolicyVersionId) {
      const shadowVer = await this.prisma.moderationPolicyVersion.findUnique({
        where: { id: runtime.shadowPolicyVersionId }
      });
      if (shadowVer) {
        const shadowCats = Array.isArray(shadowVer.categories)
          ? (shadowVer.categories as unknown as PolicyCategory[])
          : [];
        const shadowMap = this.policy.categoryMap(shadowCats);
        const shadowHit = pickActionable(merged.hits, shadowMap);
        const shadowAction = shadowHit
          ? resolveAutoAction(shadowHit, shadowMap.get(shadowHit.category))
          : 'approve';
        await this.governance.recordShadow({
          contentType,
          contentId,
          contentHash,
          policyVersion: shadowVer.version,
          topCategory: shadowHit?.category || null,
          topConfidence: shadowHit?.confidence || 0,
          wouldAction: shadowAction,
          riskScore,
          liveAction
        });
      }
    }
  }

  private async blockMediaFingerprints(
    media: Array<{ path: string | null }>,
    contentType: string,
    contentId: string,
    caseId: string
  ) {
    for (const m of media) {
      if (!m.path) continue;
      const sha = this.fingerprints.sha256File(m.path);
      if (sha) {
        await this.fingerprints.registerBlocked({
          kind: 'sha256',
          value: sha,
          contentType,
          contentId,
          caseId,
          confidence: 1
        });
      }
      const ah = this.fingerprints.ahashFile(m.path);
      if (ah) {
        await this.fingerprints.registerBlocked({
          kind: 'ahash',
          value: ah,
          contentType,
          contentId,
          caseId,
          confidence: 0.9
        });
      }
    }
  }

  private async raiseEmergency(caseId: string, authorId: string, category: string) {
    await this.prisma.moderationCase.update({
      where: { id: caseId },
      data: { emergency: true, critical: true, priority: 100, needsHuman: true }
    });
    await this.governance.openIncident('system', {
      title: `طوارئ: ${category} · ${caseId.slice(0, 8)}`,
      severity: 'critical',
      caseIds: [caseId],
      notes: `عزل فوري للمحتوى. author=${authorId.slice(0, 8)}. يتطلب تصعيداً بشرياً.`
    });
    await this.prisma.moderationAuditLog.create({
      data: {
        actorId: null,
        action: 'emergency.isolate',
        entityType: 'ModerationCase',
        entityId: caseId,
        after: { category } as Prisma.InputJsonValue
      }
    });
  }

  private async upsertCase(input: {
    contentType: string;
    contentId: string;
    authorId: string;
    contentHash: string;
    fingerprint?: string | null;
    status: string;
    priority: number;
    topCategory: string | null;
    topConfidence: number;
    needsHuman: boolean;
    critical: boolean;
    emergency?: boolean;
    riskScore?: number;
    summary: string;
    policyVersionId?: string;
    policyVersion?: string;
  }) {
    const existing = await this.prisma.moderationCase.findUnique({
      where: {
        contentType_contentId_contentHash: {
          contentType: input.contentType,
          contentId: input.contentId,
          contentHash: input.contentHash
        }
      }
    });
    const extra = {
      emergency: Boolean(input.emergency),
      riskScore: input.riskScore ?? 0
    };
    if (existing) {
      return this.prisma.moderationCase.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          priority: input.priority,
          topCategory: input.topCategory,
          topConfidence: input.topConfidence,
          needsHuman: input.needsHuman,
          critical: input.critical,
          ...extra,
          summary: input.summary.slice(0, 500),
          fingerprint: input.fingerprint || existing.fingerprint,
          ...(input.policyVersionId ? { policyVersionId: input.policyVersionId } : {}),
          ...(input.policyVersion ? { policyVersion: input.policyVersion } : {})
        }
      });
    }
    return this.prisma.moderationCase.create({
      data: {
        contentType: input.contentType,
        contentId: input.contentId,
        authorId: input.authorId,
        contentHash: input.contentHash,
        fingerprint: input.fingerprint || null,
        status: input.status,
        priority: input.priority,
        topCategory: input.topCategory,
        topConfidence: input.topConfidence,
        needsHuman: input.needsHuman,
        critical: input.critical,
        ...extra,
        summary: input.summary.slice(0, 500),
        ...(input.policyVersionId ? { policyVersionId: input.policyVersionId } : {}),
        ...(input.policyVersion ? { policyVersion: input.policyVersion } : {})
      }
    });
  }

  private async closeOpenAppeals(
    caseId: string,
    decisionId: string,
    approve: boolean,
    note: string
  ) {
    await this.prisma.moderationAppeal.updateMany({
      where: { caseId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decisionId,
        resolutionNote: note.slice(0, 500),
        resolvedAt: new Date()
      }
    });
  }

  private async recordDecision(input: {
    caseId: string;
    actorType: string;
    actorId?: string;
    action: string;
    resultingStatus: string;
    category?: string;
    confidence?: number;
    reasonCode: string;
    userReason: string | null;
    policyVersion?: string;
    notes?: string;
  }) {
    const decision = await this.prisma.moderationDecision.create({
      data: {
        caseId: input.caseId,
        actorType: input.actorType,
        actorId: input.actorId || null,
        action: input.action,
        resultingStatus: input.resultingStatus,
        category: input.category || null,
        confidence: input.confidence || 0,
        reasonCode: input.reasonCode.slice(0, 64),
        userReason: input.userReason,
        policyVersion: input.policyVersion || null,
        notes: input.notes?.slice(0, 500) || null
      }
    });
    const caseRow = await this.prisma.moderationCase.update({
      where: { id: input.caseId },
      data: {
        status: input.resultingStatus,
        lastDecisionId: decision.id,
        needsHuman: ['FLAGGED', 'APPEAL_PENDING', 'REVIEW_FAILED', 'PENDING_REVIEW', 'HIDDEN'].includes(
          input.resultingStatus
        )
      }
    });
    await this.setContentStatus(
      caseRow.contentType,
      caseRow.contentId,
      input.resultingStatus as ModerationStatus,
      caseRow.fingerprint
    );
    await this.prisma.moderationAuditLog.create({
      data: {
        actorId: input.actorId || null,
        action: `decision.${input.action}`,
        entityType: 'ModerationCase',
        entityId: input.caseId,
        after: {
          status: input.resultingStatus,
          reasonCode: input.reasonCode
        } as Prisma.InputJsonValue
      }
    });
    return decision;
  }

  private async applyStatus(
    contentType: string,
    contentId: string,
    caseId: string,
    status: ModerationStatus
  ) {
    await this.prisma.moderationCase.update({
      where: { id: caseId },
      data: { status }
    });
    await this.setContentStatus(contentType, contentId, status);
  }

  private async setContentStatus(
    contentType: string,
    contentId: string,
    status: ModerationStatus,
    fingerprint?: string | null
  ) {
    const data: { moderationStatus: string; contentFingerprint?: string } = {
      moderationStatus: status
    };
    if (fingerprint) data.contentFingerprint = fingerprint;
    if (contentType === 'post') {
      await this.prisma.post.update({ where: { id: contentId }, data }).catch(() => undefined);
    } else if (contentType === 'reel') {
      await this.prisma.reel.update({ where: { id: contentId }, data }).catch(() => undefined);
    } else if (contentType === 'story') {
      await this.prisma.story.update({ where: { id: contentId }, data }).catch(() => undefined);
    } else if (contentType === 'comment') {
      await this.prisma.comment
        .update({ where: { id: contentId }, data: { moderationStatus: status } })
        .catch(() => undefined);
    } else if (contentType === 'reel_comment') {
      await this.prisma.reelComment
        .update({ where: { id: contentId }, data: { moderationStatus: status } })
        .catch(() => undefined);
    }
  }

  private async contentStatus(contentType: string, contentId: string): Promise<string> {
    if (contentType === 'post') {
      return (
        (await this.prisma.post.findUnique({ where: { id: contentId }, select: { moderationStatus: true } }))
          ?.moderationStatus || 'APPROVED'
      );
    }
    if (contentType === 'reel') {
      return (
        (await this.prisma.reel.findUnique({ where: { id: contentId }, select: { moderationStatus: true } }))
          ?.moderationStatus || 'APPROVED'
      );
    }
    return 'APPROVED';
  }

  private async contentAuthorId(contentType: string, contentId: string): Promise<string | null> {
    if (contentType === 'post') {
      return (
        (await this.prisma.post.findUnique({ where: { id: contentId }, select: { authorId: true } }))
          ?.authorId || null
      );
    }
    if (contentType === 'reel') {
      return (
        (await this.prisma.reel.findUnique({ where: { id: contentId }, select: { authorId: true } }))
          ?.authorId || null
      );
    }
    return null;
  }

  private async loadBundle(contentType: string, contentId: string) {
    if (contentType === 'post') {
      const post = await this.prisma.post.findUnique({
        where: { id: contentId },
        select: {
          authorId: true,
          caption: true,
          deletedAt: true,
          hashtags: { select: { hashtag: { select: { tag: true } } } },
          media: {
            select: {
              media: {
                select: {
                  id: true,
                  storageKey: true,
                  mimeType: true,
                  mediaType: true,
                  contentHash: true,
                  purpose: true
                }
              }
            }
          }
        }
      });
      if (!post || post.deletedAt) return null;
      return this.pack(
        post.authorId,
        post.caption || '',
        post.hashtags.map((h) => h.hashtag.tag),
        post.media.map((m) => m.media)
      );
    }
    if (contentType === 'reel') {
      const reel = await this.prisma.reel.findUnique({
        where: { id: contentId },
        select: {
          authorId: true,
          caption: true,
          deletedAt: true,
          hashtags: { select: { hashtag: { select: { tag: true } } } },
          media: {
            select: {
              id: true,
              storageKey: true,
              mimeType: true,
              mediaType: true,
              contentHash: true,
              purpose: true
            }
          }
        }
      });
      if (!reel || reel.deletedAt) return null;
      return this.pack(
        reel.authorId,
        reel.caption || '',
        reel.hashtags.map((h) => h.hashtag.tag),
        reel.media ? [reel.media] : []
      );
    }
    if (contentType === 'story') {
      const story = await this.prisma.story.findUnique({
        where: { id: contentId },
        select: {
          authorId: true,
          deletedAt: true,
          media: {
            select: {
              id: true,
              storageKey: true,
              mimeType: true,
              mediaType: true,
              contentHash: true,
              purpose: true
            }
          }
        }
      });
      if (!story || story.deletedAt) return null;
      return this.pack(story.authorId, '', [], story.media ? [story.media] : []);
    }
    if (contentType === 'comment') {
      const comment = await this.prisma.comment.findUnique({
        where: { id: contentId },
        select: { authorId: true, body: true, deletedAt: true }
      });
      if (!comment || comment.deletedAt) return null;
      return this.pack(comment.authorId, comment.body, [], []);
    }
    if (contentType === 'reel_comment') {
      const comment = await this.prisma.reelComment.findUnique({
        where: { id: contentId },
        select: { authorId: true, body: true, deletedAt: true }
      });
      if (!comment || comment.deletedAt) return null;
      return this.pack(comment.authorId, comment.body, [], []);
    }
    return null;
  }

  private async pack(
    authorId: string,
    text: string,
    hashtags: string[],
    mediaRows: Array<{
      id: string;
      storageKey: string;
      mimeType: string;
      mediaType: string;
      contentHash: string | null;
      purpose: string;
    }>
  ) {
    const eligible = mediaRows.filter((m) => m.purpose !== 'message' && m.purpose !== 'chat');
    const media = await Promise.all(
      eligible.map(async (m) => {
        let filePath = this.mediaStorage?.safeLocalAbsolutePath(m.storageKey) || null;
        if (!filePath && this.mediaStorage) {
          filePath = await this.mediaStorage.ensureLocalFile(m.storageKey);
        }
        return {
          id: m.id,
          mimeType: m.mimeType,
          mediaType: m.mediaType,
          path: filePath,
          contentHash: m.contentHash
        };
      })
    );
    const fpSource = [
      text,
      ...hashtags,
      ...media.map((m) => m.contentHash || m.id)
    ].join('|');
    const fingerprint = createHash('sha256').update(fpSource).digest('hex');
    const contentHash = createHash('sha256')
      .update(JSON.stringify({ text, hashtags, media: media.map((m) => m.id) }))
      .digest('hex');
    return { authorId, text, hashtags, media, fingerprint, contentHash };
  }

  private async maybePenalize(userId: string, caseId: string, category: string, severity: number) {
    const penalty =
      severity >= 95 ? 'suspend' : severity >= 80 ? 'content_action' : 'warning';
    await this.prisma.userViolation.create({
      data: {
        userId,
        caseId,
        category: category.slice(0, 40),
        severity,
        penalty,
        expiresAt: new Date(Date.now() + 365 * 86400_000)
      }
    });
    if (penalty === 'suspend') {
      await this.prisma.userModerationState.upsert({
        where: { userId },
        create: {
          userId,
          state: 'suspended',
          canPublish: false,
          canComment: false,
          publishBlockedUntil: new Date(Date.now() + 7 * 86400_000),
          reasonCode: category.slice(0, 64)
        },
        update: {
          state: 'suspended',
          canPublish: false,
          canComment: false,
          publishBlockedUntil: new Date(Date.now() + 7 * 86400_000),
          reasonCode: category.slice(0, 64)
        }
      });
    } else if (penalty === 'content_action') {
      await this.prisma.userModerationState.upsert({
        where: { userId },
        create: {
          userId,
          state: 'warned',
          canPublish: true,
          reasonCode: category.slice(0, 64)
        },
        update: { state: 'warned', reasonCode: category.slice(0, 64) }
      });
    }
  }

  private async notifyAuthor(
    userId: string,
    body: string,
    contentType: string,
    contentId: string
  ) {
    try {
      await this.prisma.notification.create({
        data: {
          recipientId: userId,
          type: 'moderation',
          entityType: contentType,
          entityId: contentId,
          payload: { body } as Prisma.InputJsonValue
        }
      });
    } catch {
      /* non-fatal */
    }
  }
}

function reportPriority(reason: string): number {
  const r = reason.toLowerCase();
  if (/minor|قاصر|csam|child/.test(r)) return 100;
  if (/sexual|جنس|اباح|porn/.test(r)) return 90;
  if (/violence|قتل|تهديد|threat/.test(r)) return 88;
  if (/hate|كراه/.test(r)) return 80;
  if (/self.?harm|انتحار/.test(r)) return 85;
  return 50;
}

function pickActionable(
  hits: SafetyHit[],
  catMap: Map<string, PolicyCategory>
): SafetyHit | null {
  for (const hit of hits) {
    const cat = catMap.get(hit.category);
    if (!cat || !cat.enabled) continue;
    if (hit.confidence < cat.confidenceThreshold) {
      if (hit.critical && hit.confidence >= Math.min(0.55, cat.confidenceThreshold)) return hit;
      continue;
    }
    return hit;
  }
  return null;
}

function resolveAutoAction(
  hit: SafetyHit,
  cat?: PolicyCategory
): 'approve' | 'flag' | 'restrict' | 'hide' | 'remove' | 'human' {
  if (!cat) return hit.critical ? 'hide' : 'flag';
  if (cat.autoAction === 'human') return 'flag';
  if (hit.needsHuman && !hit.critical) return 'flag';
  return cat.autoAction;
}

function actionToStatus(action: string): ModerationStatus {
  switch (action) {
    case 'approve':
      return 'APPROVED';
    case 'flag':
    case 'human':
      return 'FLAGGED';
    case 'restrict':
      return 'RESTRICTED';
    case 'hide':
      return 'HIDDEN';
    case 'remove':
      return 'REMOVED';
    default:
      return 'FLAGGED';
  }
}

function userReasonFor(action: string, category?: string | null): string {
  if (action === 'approve' || action === 'restore') return 'لا مخالفة.';
  return `إجراء إداري (${category || 'policy'}).`;
}

function extractOcrText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const data = (result as { ocr?: { data?: Record<string, unknown> } }).ocr?.data;
  if (!data) return null;
  const logical = data.textLogical || data.textSearch || data.text;
  return typeof logical === 'string' ? logical : null;
}

function extractNsfw(result: unknown): {
  ok: boolean;
  inference: boolean;
  label: string | null;
  nsfwScore: number | null;
  modelId: string | null;
  modelVersion: string | null;
} {
  if (!result || typeof result !== 'object') {
    return { ok: false, inference: false, label: null, nsfwScore: null, modelId: null, modelVersion: null };
  }
  const nsfw = (result as { nsfw?: Record<string, unknown> }).nsfw;
  if (!nsfw || typeof nsfw !== 'object') {
    return { ok: false, inference: false, label: null, nsfwScore: null, modelId: null, modelVersion: null };
  }
  const data = (nsfw.data && typeof nsfw.data === 'object' ? nsfw.data : nsfw) as Record<string, unknown>;
  const ok = nsfw.ok === true || data.ok === true;
  const inference = data.inference === true || (ok && typeof data.nsfwScore === 'number');
  const label = typeof data.label === 'string' ? data.label : null;
  const nsfwScore = typeof data.nsfwScore === 'number' ? data.nsfwScore : null;
  const modelId =
    typeof data.modelId === 'string'
      ? data.modelId
      : typeof nsfw.modelId === 'string'
        ? nsfw.modelId
        : null;
  const modelVersion = typeof data.modelVersion === 'string' ? data.modelVersion : null;
  return { ok, inference, label, nsfwScore, modelId, modelVersion };
}

function extractTranscript(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const root = result as {
    data?: { text?: string };
    whisper?: { data?: { text?: string } };
  };
  if (typeof root.data?.text === 'string') return root.data.text;
  if (typeof root.whisper?.data?.text === 'string') return root.whisper.data.text;
  return null;
}
