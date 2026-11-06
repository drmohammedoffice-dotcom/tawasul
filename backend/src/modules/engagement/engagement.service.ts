import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

const BASE_REWARD = 10;
const STREAK_STEP = 2;
const STREAK_BONUS_CAP_DAYS = 7;
const REFERRAL_REWARD_COINS = 80;
const REWARD_REFERENCE_PREFIXES = ['reward_daily_', 'reward_task_', 'reward_referral_'] as const;
const TASK_DEFINITIONS = [
  { key: 'invite_friend_1', title: 'Invite a friend', target: 1, rewardCoins: 60 },
  { key: 'send_messages_20', title: 'Send 20 messages', target: 20, rewardCoins: 40 },
  { key: 'join_groups_3', title: 'Join 3 groups', target: 3, rewardCoins: 45 }
] as const;
type TaskDefinition = (typeof TASK_DEFINITIONS)[number];

@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService
  ) {}

  async listTaskProgress(userId: string) {
    const rows = await this.prisma.userTaskProgress.findMany({
      where: { userId }
    });
    const byKey = new Map(rows.map((item) => [item.taskKey, item]));

    return TASK_DEFINITIONS.map((task) => {
      const state = byKey.get(task.key);
      return {
        key: task.key,
        title: task.title,
        target: task.target,
        rewardCoins: task.rewardCoins,
        progress: state?.progress ?? 0,
        completedAt: state?.completedAt ?? null,
        rewardClaimedAt: state?.rewardClaimedAt ?? null,
        claimable:
          (state?.progress ?? 0) >= task.target &&
          !state?.rewardClaimedAt
      };
    });
  }

  async completeInviteTask(inviterUserId: string, invitedUserId: string) {
    if (inviterUserId === invitedUserId) {
      throw new BadRequestException('you cannot invite yourself');
    }
    const invited = await this.prisma.user.findUnique({
      where: { id: invitedUserId },
      select: { id: true }
    });
    if (!invited) {
      throw new BadRequestException('invited user not found');
    }
    return this.prisma.$transaction(async (tx) => {
      try {
        await tx.taskInviteAttribution.create({
          data: {
            inviterUserId,
            invitedUserId
          }
        });
      } catch (error: unknown) {
        if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new BadRequestException('this invite was already counted');
        }
        throw error;
      }

      await this.incrementTaskProgressTx(tx, inviterUserId, 'invite_friend_1', 1);
      const rewardCoins = await this.computeControlledRewardCoinsTx(tx, inviterUserId, REFERRAL_REWARD_COINS);
      if (rewardCoins <= 0) {
        throw new BadRequestException('daily rewards cap reached, referral reward available tomorrow');
      }
      await this.grantCoinsRewardTx(tx, {
        userId: inviterUserId,
        amount: rewardCoins,
        reference: `reward_referral_${invitedUserId}`,
        metadata: { reason: 'referral_reward', invitedUserId }
      });
      return { accepted: true, rewardCoins };
    });
  }

  async recordMessageSent(userId: string) {
    return this.incrementTaskProgress(userId, 'send_messages_20', 1);
  }

  async recordGroupJoined(userId: string) {
    return this.incrementTaskProgress(userId, 'join_groups_3', 1);
  }

  async claimTaskReward(userId: string, taskKey: TaskDefinition['key']) {
    const task = TASK_DEFINITIONS.find((item) => item.key === taskKey);
    if (!task) {
      throw new BadRequestException('unknown task');
    }

    return this.prisma.$transaction(async (tx) => {
      const progress = await tx.userTaskProgress.findUnique({
        where: { userId_taskKey: { userId, taskKey } }
      });
      if (!progress || progress.progress < task.target || !progress.completedAt) {
        throw new BadRequestException('task is not completed yet');
      }
      if (progress.rewardClaimedAt) {
        throw new BadRequestException('task reward already claimed');
      }

      const rewardCoins = await this.computeControlledRewardCoinsTx(tx, userId, task.rewardCoins);
      if (rewardCoins <= 0) {
        throw new BadRequestException('daily rewards cap reached, claim again tomorrow');
      }

      await tx.taskRewardClaim.create({
        data: {
          userId,
          taskKey,
          rewardCoins
        }
      });
      await this.grantCoinsRewardTx(tx, {
        userId,
        amount: rewardCoins,
        reference: `reward_task_${taskKey}`,
        metadata: { reason: 'task_reward', taskKey }
      });
      await tx.userTaskProgress.update({
        where: { userId_taskKey: { userId, taskKey } },
        data: {
          rewardClaimedAt: new Date()
        }
      });

      return {
        taskKey,
        rewardCoins
      };
    });
  }

  async getDailyRewardStatus(userId: string) {
    const progress = await this.prisma.dailyRewardProgress.findUnique({
      where: { userId }
    });
    const today = startOfUtcDay(new Date());
    const tomorrow = addDays(today, 1);
    const alreadyClaimedToday =
      progress?.lastClaimDate && isSameUtcDay(progress.lastClaimDate, today);

    return {
      claimAvailable: !alreadyClaimedToday,
      currentStreak: progress?.currentStreak ?? 0,
      bestStreak: progress?.bestStreak ?? 0,
      nextClaimAt: tomorrow.toISOString()
    };
  }

  async claimDailyReward(userId: string) {
    const today = startOfUtcDay(new Date());
    const yesterday = addDays(today, -1);

    return this.prisma.$transaction(async (tx) => {
      const progress = await tx.dailyRewardProgress.upsert({
        where: { userId },
        update: {},
        create: {
          userId
        }
      });

      if (progress.lastClaimDate && isSameUtcDay(progress.lastClaimDate, today)) {
        throw new BadRequestException('daily reward already claimed today');
      }

      const streak =
        progress.lastClaimDate && isSameUtcDay(progress.lastClaimDate, yesterday)
          ? progress.currentStreak + 1
          : 1;

      const baseRewardCoins = calculateReward(streak);
      const rewardCoins = await this.computeControlledRewardCoinsTx(tx, userId, baseRewardCoins);
      if (rewardCoins <= 0) {
        throw new BadRequestException('daily rewards cap reached for today');
      }

      await tx.dailyRewardClaim.create({
        data: {
          userId,
          claimDate: today,
          streakAfter: streak,
          rewardCoins
        }
      });

      const updatedProgress = await tx.dailyRewardProgress.update({
        where: { userId },
        data: {
          currentStreak: streak,
          bestStreak: Math.max(progress.bestStreak, streak),
          lastClaimDate: today
        }
      });

      await this.grantCoinsRewardTx(tx, {
        userId,
        amount: rewardCoins,
        reference: `reward_daily_${today.toISOString().slice(0, 10)}`,
        metadata: { reason: 'daily_reward', streak }
      });

      return {
        rewardCoins,
        streak: updatedProgress.currentStreak,
        bestStreak: updatedProgress.bestStreak,
        claimedAt: today.toISOString()
      };
    });
  }

  private async incrementTaskProgress(userId: string, taskKey: TaskDefinition['key'], delta: number) {
    const task = TASK_DEFINITIONS.find((item) => item.key === taskKey);
    if (!task) {
      throw new BadRequestException('unknown task');
    }
    if (delta <= 0) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.incrementTaskProgressTx(tx, userId, taskKey, delta);
    });
  }

  private async incrementTaskProgressTx(
    tx: Prisma.TransactionClient,
    userId: string,
    taskKey: TaskDefinition['key'],
    delta: number
  ) {
    const task = TASK_DEFINITIONS.find((item) => item.key === taskKey);
    if (!task) {
      throw new BadRequestException('unknown task');
    }
    const existing = await tx.userTaskProgress.findUnique({
      where: { userId_taskKey: { userId, taskKey } }
    });
    const nextProgress = Math.min(task.target, (existing?.progress ?? 0) + delta);
    const now = new Date();
    const completedAt = nextProgress >= task.target ? existing?.completedAt ?? now : null;
    await tx.userTaskProgress.upsert({
      where: { userId_taskKey: { userId, taskKey } },
      update: {
        progress: nextProgress,
        target: task.target,
        ...(completedAt ? { completedAt } : {})
      },
      create: {
        userId,
        taskKey,
        progress: nextProgress,
        target: task.target,
        ...(completedAt ? { completedAt } : {})
      }
    });
  }

  private async grantCoinsRewardTx(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      amount: number;
      reference: string;
      metadata: Record<string, unknown>;
    }
  ) {
    const wallet = await tx.wallet.upsert({
      where: { userId: input.userId },
      update: { balance: { increment: input.amount } },
      create: {
        userId: input.userId,
        balance: input.amount
      }
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'earn',
        currency: 'coins',
        amount: input.amount,
        status: 'completed',
        toUserId: input.userId,
        reference: input.reference,
        metadata: input.metadata as Prisma.InputJsonValue
      }
    });
  }

  private async computeControlledRewardCoinsTx(
    tx: Prisma.TransactionClient,
    userId: string,
    baseRewardCoins: number
  ): Promise<number> {
    const today = startOfUtcDay(new Date());
    const agg = await tx.walletTransaction.aggregate({
      where: {
        toUserId: userId,
        type: 'earn',
        currency: 'coins',
        status: 'completed',
        timestamp: { gte: today },
        OR: REWARD_REFERENCE_PREFIXES.map((prefix) => ({ reference: { startsWith: prefix } }))
      },
      _sum: { amount: true },
      _count: { _all: true }
    });
    const totalToday = agg._sum.amount ?? 0;
    const eventsToday = agg._count._all ?? 0;
    const remaining = this.config.rewardsMaxCoinsPerDay - totalToday;
    if (remaining <= 0) {
      return 0;
    }

    const multiplier = eventsToday >= 5 ? 0.4 : eventsToday >= 3 ? 0.65 : 1;
    const diminished = Math.max(1, Math.floor(baseRewardCoins * multiplier));
    return Math.min(diminished, remaining);
  }
}

function calculateReward(streak: number): number {
  const bonusSteps = Math.min(Math.max(streak - 1, 0), STREAK_BONUS_CAP_DAYS - 1);
  return BASE_REWARD + bonusSteps * STREAK_STEP;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
