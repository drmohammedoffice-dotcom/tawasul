import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SafetyHit } from './engine/safety-scanner';

/**
 * Risk scoring for cases/accounts. Never uses religion/politics/ethnicity.
 * Violations expire via UserViolation.expiresAt so scores are not permanent branding.
 */
@Injectable()
export class RiskScoreService {
  constructor(private readonly prisma: PrismaService) {}

  scoreCase(input: {
    hits: SafetyHit[];
    priorConfirmed: number;
    evasionHints: number;
    reportCount: number;
  }): number {
    const top = input.hits[0];
    if (!top) return Math.min(30, input.reportCount * 2);
    let score = top.severity * top.confidence * 0.55;
    if (top.critical) score += 20;
    score += Math.min(15, input.priorConfirmed * 4);
    score += Math.min(10, input.evasionHints * 5);
    // Reports alone never dominate
    score += Math.min(8, input.reportCount);
    return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  }

  async refreshUserRisk(userId: string): Promise<number> {
    const now = new Date();
    const rows = await this.prisma.userViolation.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      },
      select: { severity: true }
    });
    const score = Math.min(
      100,
      rows.reduce((acc, row) => acc + row.severity * 0.35, 0)
    );
    await this.prisma.userModerationState.upsert({
      where: { userId },
      create: { userId, riskScore: score, state: 'none' },
      update: { riskScore: score }
    });
    return score;
  }
}
