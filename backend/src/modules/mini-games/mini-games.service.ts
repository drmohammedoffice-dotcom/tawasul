import { BadRequestException, Injectable } from '@nestjs/common';
import { MiniGameType, Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlayMiniGameDto } from './dto/play-mini-game.dto';

type RewardBucket = { coins: number; weight: number };
type GameConfig = {
  costCoins: number;
  maxDailyPlays: number;
  rewards: RewardBucket[];
};

type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
};

const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q_crypto',
    prompt: 'Which algorithm mode is used for encrypted message payloads in this app?',
    options: ['AES-256-CBC', 'AES-256-GCM', 'ChaCha20', 'RSA-4096'],
    answerIndex: 1
  },
  {
    id: 'q_realtime',
    prompt: 'Which layer handles real-time events between users?',
    options: ['SMTP', 'Socket.IO', 'Cron jobs', 'GraphQL only'],
    answerIndex: 1
  },
  {
    id: 'q_storage',
    prompt: 'Which store is primarily used for fast caching and pub/sub?',
    options: ['MongoDB', 'MySQL', 'Redis', 'SQLite'],
    answerIndex: 2
  }
];
const FALLBACK_QUIZ_QUESTION: QuizQuestion = {
  id: 'q_fallback',
  prompt: 'Fallback quiz question',
  options: ['A', 'B', 'C', 'D'],
  answerIndex: 0
};

const MINI_GAME_CONFIG: Record<MiniGameType, GameConfig> = {
  [MiniGameType.spin_wheel]: {
    costCoins: 20,
    maxDailyPlays: 15,
    rewards: [
      { coins: 0, weight: 45 },
      { coins: 5, weight: 30 },
      { coins: 10, weight: 18 },
      { coins: 15, weight: 6 },
      { coins: 30, weight: 1 }
    ]
  },
  [MiniGameType.quiz]: {
    costCoins: 12,
    maxDailyPlays: 20,
    rewards: [
      { coins: 0, weight: 55 },
      { coins: 4, weight: 25 },
      { coins: 8, weight: 13 },
      { coins: 12, weight: 6 },
      { coins: 22, weight: 1 }
    ]
  },
  [MiniGameType.scratch_card]: {
    costCoins: 8,
    maxDailyPlays: 25,
    rewards: [
      { coins: 0, weight: 56 },
      { coins: 2, weight: 24 },
      { coins: 5, weight: 14 },
      { coins: 8, weight: 5 },
      { coins: 15, weight: 1 }
    ]
  }
};

@Injectable()
export class MiniGamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService
  ) {}

  async getCatalog(userId: string) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId }
    });
    const now = new Date();
    const start = startOfUtcDay(now);
    const end = addDays(start, 1);

    const counters = await this.prisma.miniGamePlay.groupBy({
      by: ['gameType'],
      where: {
        userId,
        playedAt: {
          gte: start,
          lt: end
        }
      },
      _count: { _all: true }
    });
    const counterByType = new Map(counters.map((item) => [item.gameType, item._count._all]));

    const games = Object.entries(MINI_GAME_CONFIG).map(([rawType, cfg]) => {
      const gameType = rawType as MiniGameType;
      const effectiveCap = this.resolveDailyCap(cfg.maxDailyPlays);
      const used = counterByType.get(gameType) ?? 0;
      return {
        gameType,
        costCoins: cfg.costCoins,
        maxDailyPlays: effectiveCap,
        playedToday: used,
        remainingToday: Math.max(0, effectiveCap - used),
        expectedReturnRatio: computeExpectedReturnRatio(cfg.rewards, cfg.costCoins)
      };
    });

    return {
      wallet: { coinsBalance: wallet.balance, gemsBalance: wallet.gemsBalance },
      serverTime: now.toISOString(),
      games
    };
  }

  async getQuizQuestion() {
    const question = QUIZ_QUESTIONS[randomInt(0, QUIZ_QUESTIONS.length)] ?? FALLBACK_QUIZ_QUESTION;
    return {
      id: question.id,
      prompt: question.prompt,
      options: question.options
    };
  }

  async play(userId: string, dto: PlayMiniGameDto) {
    const config = MINI_GAME_CONFIG[dto.gameType];
    if (!config) {
      throw new BadRequestException('unsupported mini game');
    }

    const now = new Date();
    const dayStart = startOfUtcDay(now);
    const dayEnd = addDays(dayStart, 1);
    const dailyCap = this.resolveDailyCap(config.maxDailyPlays);

    const quizContext = this.resolveQuizContext(dto);
    const rewardTable =
      dto.gameType === MiniGameType.quiz && quizContext?.isCorrect
        ? boostRewards(config.rewards, 1.15)
        : config.rewards;

    return this.prisma.$transaction(async (tx) => {
      if (dto.requestId) {
        const existing = await tx.miniGamePlay.findUnique({
          where: { userId_requestId: { userId, requestId: dto.requestId } }
        });
        if (existing) {
          const walletCurrent = await tx.wallet.findUnique({ where: { userId } });
          return {
            gameType: existing.gameType,
            costCoins: existing.costCoins,
            rewardCoins: existing.rewardCoins,
            netCoins: existing.rewardCoins - existing.costCoins,
            replayed: true,
            wallet: {
              coinsBalance: walletCurrent?.balance ?? 0,
              gemsBalance: walletCurrent?.gemsBalance ?? 0
            }
          };
        }
      }

      const wallet = await tx.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId }
      });

      const playsToday = await tx.miniGamePlay.count({
        where: {
          userId,
          gameType: dto.gameType,
          playedAt: { gte: dayStart, lt: dayEnd }
        }
      });
      if (playsToday >= dailyCap) {
        throw new BadRequestException('daily play limit reached for this game');
      }

      const charged = await tx.wallet.updateMany({
        where: {
          id: wallet.id,
          balance: { gte: config.costCoins }
        },
        data: {
          balance: { decrement: config.costCoins }
        }
      });
      if (charged.count !== 1) {
        throw new BadRequestException('insufficient coins to play');
      }

      const rewardCoins = sampleReward(rewardTable);
      if (rewardCoins > 0) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: rewardCoins } }
        });
      }

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'spend',
          currency: 'coins',
          amount: config.costCoins,
          status: 'completed',
          fromUserId: userId,
          reference: `minigame:${dto.gameType}:play`,
          requestId: dto.requestId ?? null
        }
      });

      if (rewardCoins > 0) {
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'earn',
            currency: 'coins',
            amount: rewardCoins,
            status: 'completed',
            toUserId: userId,
            reference: `minigame:${dto.gameType}:reward`,
            requestId: dto.requestId ? `${dto.requestId}:reward` : null
          }
        });
      }

      await tx.miniGamePlay.create({
        data: {
          userId,
          gameType: dto.gameType,
          costCoins: config.costCoins,
          rewardCoins,
          requestId: dto.requestId ?? null,
          metadata: {
            quizQuestionId: quizContext?.questionId ?? null,
            quizCorrect: quizContext?.isCorrect ?? null
          } as Prisma.InputJsonValue
        }
      });

      const walletAfter = await tx.wallet.findUnique({
        where: { id: wallet.id },
        select: { balance: true, gemsBalance: true }
      });

      const nextPlayedToday = playsToday + 1;
      return {
        gameType: dto.gameType,
        costCoins: config.costCoins,
        rewardCoins,
        netCoins: rewardCoins - config.costCoins,
        replayed: false,
        playedToday: nextPlayedToday,
        remainingToday: Math.max(0, dailyCap - nextPlayedToday),
        quiz: quizContext
          ? {
              questionId: quizContext.questionId,
              isCorrect: quizContext.isCorrect
            }
          : undefined,
        wallet: {
          coinsBalance: walletAfter?.balance ?? 0,
          gemsBalance: walletAfter?.gemsBalance ?? 0
        }
      };
    });
  }

  private resolveDailyCap(gameCap: number): number {
    return Math.max(1, Math.min(gameCap, this.config.miniGamesMaxPlaysPerDay));
  }

  private resolveQuizContext(
    dto: PlayMiniGameDto
  ): { questionId: string; isCorrect: boolean } | undefined {
    if (dto.gameType !== MiniGameType.quiz) {
      return undefined;
    }
    if (!dto.questionId || dto.answerIndex === undefined) {
      throw new BadRequestException('quiz requires questionId and answerIndex');
    }
    const question = QUIZ_QUESTIONS.find((item) => item.id === dto.questionId);
    if (!question) {
      throw new BadRequestException('invalid quiz question');
    }
    return {
      questionId: question.id,
      isCorrect: dto.answerIndex === question.answerIndex
    };
  }
}

function sampleReward(rewards: RewardBucket[]): number {
  const totalWeight = rewards.reduce((sum, item) => sum + item.weight, 0);
  let cursor = randomInt(0, totalWeight);
  for (const bucket of rewards) {
    cursor -= bucket.weight;
    if (cursor < 0) {
      return bucket.coins;
    }
  }
  return 0;
}

function boostRewards(rewards: RewardBucket[], multiplier: number): RewardBucket[] {
  return rewards.map((item) => ({
    coins: Math.max(0, Math.floor(item.coins * multiplier)),
    weight: item.weight
  }));
}

function computeExpectedReturnRatio(rewards: RewardBucket[], costCoins: number): number {
  const totalWeight = rewards.reduce((sum, item) => sum + item.weight, 0);
  const expected = rewards.reduce((sum, item) => sum + item.coins * item.weight, 0) / totalWeight;
  return Number((expected / costCoins).toFixed(3));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
