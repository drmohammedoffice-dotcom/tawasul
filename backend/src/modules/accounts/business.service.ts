import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BUSINESS_CATEGORIES, categoryRequiresLicense } from './business-categories';

@Injectable()
export class BusinessService {
  constructor(private readonly prisma: PrismaService) {}

  listCategories() {
    return BUSINESS_CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      requiresLicense: c.requiresLicense
    }));
  }

  async getMine(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountType: true,
        isVerified: true,
        verifiedAt: true,
        businessProfile: true
      }
    });
    if (!user) throw new NotFoundException('user not found');
    return user;
  }

  async switchToBusiness(
    userId: string,
    input: {
      categoryKey: string;
      businessName?: string;
      subcategoryKey?: string;
      description?: string;
    }
  ) {
    if (!BUSINESS_CATEGORIES.some((c) => c.key === input.categoryKey)) {
      throw new BadRequestException('invalid category');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true }
    });
    if (!user) throw new NotFoundException('user not found');
    const businessName =
      input.businessName?.trim() ||
      user.displayName?.trim() ||
      user.username;
    const profile = await this.prisma.businessProfile.upsert({
      where: { userId },
      create: {
        userId,
        businessName,
        categoryKey: input.categoryKey,
        subcategoryKey: input.subcategoryKey ?? null,
        description: input.description?.trim() || null
      },
      update: {
        businessName,
        categoryKey: input.categoryKey,
        subcategoryKey: input.subcategoryKey ?? null,
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {})
      }
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { accountType: 'business' }
    });
    return {
      accountType: 'business' as const,
      requiresLicense: categoryRequiresLicense(input.categoryKey),
      profile
    };
  }

  async switchToPersonal(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { accountType: 'personal' }
    });
    return { accountType: 'personal' as const };
  }

  async insights(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountType: true,
        _count: {
          select: {
            posts: true,
            reels: true,
            followers: true,
            following: true,
            stories: true
          }
        }
      }
    });
    if (!user) throw new NotFoundException('user not found');
    if (user.accountType !== 'business') {
      throw new BadRequestException('business account required');
    }
    const [postViews, reelViews, products, orders, orderItems] = await Promise.all([
      this.prisma.post.aggregate({
        where: { authorId: userId, deletedAt: null },
        _sum: { viewCount: true }
      }),
      this.prisma.reel.aggregate({
        where: { authorId: userId, deletedAt: null },
        _sum: { viewCount: true }
      }),
      this.prisma.catalogProduct.count({ where: { sellerId: userId, active: true } }),
      this.prisma.storeOrder.count({ where: { sellerId: userId } }),
      this.prisma.storeOrderItem.aggregate({
        where: { order: { sellerId: userId } },
        _sum: { quantity: true }
      })
    ]);
    const recentOrders = await this.prisma.storeOrder.findMany({
      where: { sellerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, totalIqd: true, status: true, createdAt: true, customerName: true }
    });
    return {
      posts: user._count.posts,
      reels: user._count.reels,
      stories: user._count.stories,
      followers: user._count.followers,
      following: user._count.following,
      postViews: postViews._sum.viewCount ?? 0,
      reelViews: reelViews._sum.viewCount ?? 0,
      catalogProducts: products,
      storeOrders: orders,
      itemsSold: orderItems._sum.quantity ?? 0,
      recentOrders
    };
  }

  async updateProfile(
    userId: string,
    input: {
      businessName?: string;
      categoryKey?: string;
      subcategoryKey?: string | null;
      description?: string | null;
      websiteUrl?: string | null;
      externalLinks?: unknown;
      contactPhone?: string | null;
      addressText?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      mapsPlaceId?: string | null;
      defaultDeliveryFeeIqd?: number;
    }
  ) {
    const existing = await this.prisma.businessProfile.findUnique({ where: { userId } });
    if (!existing) throw new BadRequestException('switch to business account first');
    if (input.categoryKey && !BUSINESS_CATEGORIES.some((c) => c.key === input.categoryKey)) {
      throw new BadRequestException('invalid category');
    }
    if (input.latitude != null || input.longitude != null) {
      const lat = input.latitude ?? existing.latitude;
      const lng = input.longitude ?? existing.longitude;
      if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new BadRequestException('invalid coordinates');
      }
    }
    let defaultDelivery: number | undefined;
    if (input.defaultDeliveryFeeIqd !== undefined) {
      const fee = Math.round(Number(input.defaultDeliveryFeeIqd));
      if (!Number.isFinite(fee) || fee < 0 || fee > 100_000_000) {
        throw new BadRequestException('invalid delivery fee');
      }
      defaultDelivery = fee;
    }
    return this.prisma.businessProfile.update({
      where: { userId },
      data: {
        ...(input.businessName !== undefined ? { businessName: input.businessName.trim() } : {}),
        ...(input.categoryKey !== undefined ? { categoryKey: input.categoryKey } : {}),
        ...(input.subcategoryKey !== undefined ? { subcategoryKey: input.subcategoryKey } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}),
        ...(input.externalLinks !== undefined ? { externalLinks: input.externalLinks as object } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.addressText !== undefined ? { addressText: input.addressText } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(input.mapsPlaceId !== undefined ? { mapsPlaceId: input.mapsPlaceId } : {}),
        ...(defaultDelivery !== undefined ? { defaultDeliveryFeeIqd: defaultDelivery } : {})
      }
    });
  }

  /** Public maps URL — no API key required (opens Google Maps in browser/app). */
  buildMapsUrl(profile: { latitude: number | null; longitude: number | null; addressText: string | null }) {
    if (profile.latitude != null && profile.longitude != null) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${profile.latitude},${profile.longitude}`
      )}`;
    }
    if (profile.addressText?.trim()) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.addressText.trim())}`;
    }
    return null;
  }

  async publicLocation(usernameOrId: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: usernameOrId }, { username: usernameOrId }] },
      select: {
        id: true,
        username: true,
        accountType: true,
        businessProfile: true
      }
    });
    if (!user || user.accountType !== 'business' || !user.businessProfile) {
      throw new NotFoundException('business location not available');
    }
    const bp = user.businessProfile;
    const mapsUrl = this.buildMapsUrl(bp);
    if (!mapsUrl) throw new NotFoundException('business location not set');
    return {
      businessName: bp.businessName,
      addressText: bp.addressText,
      latitude: bp.latitude,
      longitude: bp.longitude,
      mapsUrl
    };
  }
}
