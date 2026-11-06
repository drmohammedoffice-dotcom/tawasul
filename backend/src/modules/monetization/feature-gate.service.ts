import { ForbiddenException, Injectable } from '@nestjs/common';
import { BillingStatus, UserRole } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

type Entitlement = {
  role: UserRole;
  maxUploadBytes: number;
  maxOwnedGroups: number;
  maxOwnedChannels: number;
};

@Injectable()
export class FeatureGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService
  ) {}

  async assertCanUploadFile(userId: string, sizeBytes: number): Promise<void> {
    // Upload size caps disabled for product — still reject empty/negative sizes.
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new ForbiddenException('invalid upload size');
    }
    void userId;
  }

  async assertCanCreateGroup(userId: string): Promise<void> {
    const entitlements = await this.getEntitlements(userId);
    const owned = await this.prisma.group.count({ where: { ownerId: userId } });
    if (owned >= entitlements.maxOwnedGroups) {
      throw new ForbiddenException('group creation limit reached for your current plan');
    }
  }

  async assertCanCreateChannel(userId: string): Promise<void> {
    const entitlements = await this.getEntitlements(userId);
    const owned = await this.prisma.channel.count({ where: { createdById: userId } });
    if (owned >= entitlements.maxOwnedChannels) {
      throw new ForbiddenException('channel creation limit reached for your current plan');
    }
  }

  /** Kept for other product gates; group/channel create is open to all account types. */
  async assertBusinessAccount(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountType: true }
    });
    if (!user || user.accountType !== 'business') {
      throw new ForbiddenException('only business accounts can use this feature');
    }
  }

  async getEntitlements(userId: string): Promise<Entitlement> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });
    const activeSubscription = await this.prisma.userSubscription.findFirst({
      where: {
        userId,
        status: BillingStatus.active,
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }]
      },
      orderBy: { createdAt: 'desc' }
    });
    const effectiveRole =
      activeSubscription || user?.role === UserRole.premium ? UserRole.premium : UserRole.free;
    if (effectiveRole === UserRole.premium) {
      return {
        role: UserRole.premium,
        maxUploadBytes: this.config.premiumMaxUploadBytes,
        maxOwnedGroups: this.config.premiumMaxOwnedGroups,
        maxOwnedChannels: this.config.premiumMaxOwnedChannels
      };
    }
    return {
      role: UserRole.free,
      maxUploadBytes: this.config.freeMaxUploadBytes,
      maxOwnedGroups: this.config.freeMaxOwnedGroups,
      maxOwnedChannels: this.config.freeMaxOwnedChannels
    };
  }
}
