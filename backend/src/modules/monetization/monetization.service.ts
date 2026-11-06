import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingPlan, BillingStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const COIN_PLAN_PRICING: Record<BillingPlan, number> = {
  premium_monthly: 1200,
  premium_yearly: 12000
};

@Injectable()
export class MonetizationService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentSubscription(userId: string) {
    return this.prisma.userSubscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  getCoinPricing() {
    return {
      provider: 'coins',
      tiers: [
        {
          plan: BillingPlan.premium_monthly,
          coins: COIN_PLAN_PRICING.premium_monthly,
          durationDays: 30
        },
        {
          plan: BillingPlan.premium_yearly,
          coins: COIN_PLAN_PRICING.premium_yearly,
          durationDays: 365
        }
      ]
    };
  }

  async startMockCheckout(userId: string, plan: BillingPlan) {
    const checkoutSessionId = `mock_checkout_${randomUUID()}`;
    return {
      provider: 'mock',
      checkoutSessionId,
      paymentUrl: `https://mock-payments.local/checkout/${checkoutSessionId}`,
      plan,
      nextStep: 'call POST /api/monetization/subscription/mock/activate after successful mock payment'
    };
  }

  async activateMockSubscription(
    userId: string,
    plan: BillingPlan,
    providerSubscriptionId?: string
  ) {
    const now = new Date();
    const periodEnd = plan === BillingPlan.premium_yearly ? addDays(now, 365) : addDays(now, 30);

    const subscription = await this.prisma.$transaction(async (tx) => {
      await tx.userSubscription.updateMany({
        where: { userId, status: BillingStatus.active },
        data: { status: BillingStatus.canceled, cancelAtPeriodEnd: true, currentPeriodEnd: now }
      });
      const created = await tx.userSubscription.create({
        data: {
          userId,
          plan,
          status: BillingStatus.active,
          provider: 'mock',
          providerSubscriptionId: providerSubscriptionId ?? `mock_sub_${randomUUID()}`,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false
        }
      });
      await tx.user.update({
        where: { id: userId },
        data: { role: UserRole.premium }
      });
      return created;
    });

    return subscription;
  }

  async cancelCurrentSubscription(userId: string) {
    const active = await this.prisma.userSubscription.findFirst({
      where: { userId, status: BillingStatus.active },
      orderBy: { createdAt: 'desc' }
    });
    if (!active) {
      throw new NotFoundException('no active subscription found');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.userSubscription.update({
        where: { id: active.id },
        data: {
          status: BillingStatus.canceled,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date()
        }
      });
      await tx.user.update({
        where: { id: userId },
        data: { role: UserRole.free }
      });
      return updated;
    });
  }

  async purchaseWithCoins(userId: string, plan: BillingPlan) {
    const coinsRequired = COIN_PLAN_PRICING[plan];
    const durationDays = plan === BillingPlan.premium_yearly ? 365 : 30;
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId }
      });

      const debit = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: coinsRequired } },
        data: { balance: { decrement: coinsRequired } }
      });

      if (debit.count !== 1) {
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'spend',
            amount: coinsRequired,
            status: 'failed',
            fromUserId: userId,
            reference: `subscription_coins_${plan}`
          }
        });
        throw new BadRequestException('insufficient coins for this subscription tier');
      }

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'spend',
          amount: coinsRequired,
          status: 'completed',
          fromUserId: userId,
          reference: `subscription_coins_${plan}`,
          metadata: {
            reason: 'subscription_purchase',
            plan
          }
        }
      });

      const active = await tx.userSubscription.findFirst({
        where: {
          userId,
          status: BillingStatus.active,
          OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }]
        },
        orderBy: { createdAt: 'desc' }
      });

      const baseStart =
        active?.currentPeriodEnd && active.currentPeriodEnd > now ? active.currentPeriodEnd : now;
      const nextPeriodEnd = addDays(baseStart, durationDays);

      const subscription = active
        ? await tx.userSubscription.update({
            where: { id: active.id },
            data: {
              plan,
              provider: 'coins',
              status: BillingStatus.active,
              cancelAtPeriodEnd: false,
              ...(active.currentPeriodStart ? {} : { currentPeriodStart: now }),
              currentPeriodEnd: nextPeriodEnd
            }
          })
        : await tx.userSubscription.create({
            data: {
              userId,
              plan,
              status: BillingStatus.active,
              provider: 'coins',
              providerSubscriptionId: `coins_sub_${randomUUID()}`,
              currentPeriodStart: now,
              currentPeriodEnd: nextPeriodEnd,
              cancelAtPeriodEnd: false
            }
          });

      await tx.user.update({
        where: { id: userId },
        data: { role: UserRole.premium }
      });

      const latestWallet = await tx.wallet.findUnique({
        where: { id: wallet.id },
        select: { balance: true }
      });

      return {
        subscription,
        chargedCoins: coinsRequired,
        balanceAfter: latestWallet?.balance ?? 0
      };
    });
  }
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
