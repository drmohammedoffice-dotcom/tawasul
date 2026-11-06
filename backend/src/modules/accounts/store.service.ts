import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaStorageService } from '../media/media.storage';

const IRAQ_PHONE = /^(?:\+?964|0)?7[3-9]\d{8}$/;

@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService
  ) {}

  private normalizeIraqPhone(raw: string): string {
    const digits = String(raw || '').replace(/[^\d+]/g, '');
    if (!IRAQ_PHONE.test(digits)) {
      throw new BadRequestException('invalid Iraq phone number');
    }
    const only = digits.replace(/\D/g, '');
    if (only.startsWith('964')) return `+${only}`;
    if (only.startsWith('0')) return `+964${only.slice(1)}`;
    if (only.startsWith('7')) return `+964${only}`;
    return `+${only}`;
  }

  private async assertBusinessSeller(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountType: true }
    });
    if (!user || user.accountType !== 'business') {
      throw new ForbiddenException('business account required');
    }
  }

  async upsertProduct(
    sellerId: string,
    input: {
      postId: string;
      priceIqd: number;
      title?: string;
      active?: boolean;
      inStock?: boolean;
      deliveryFeeIqd?: number | null;
      sortOrder?: number;
    }
  ) {
    await this.assertBusinessSeller(sellerId);
    const price = Math.round(Number(input.priceIqd));
    if (!Number.isFinite(price) || price < 1 || price > 100_000_000) {
      throw new BadRequestException('invalid price');
    }
    let deliveryFee: number | null | undefined = undefined;
    if (input.deliveryFeeIqd !== undefined) {
      if (input.deliveryFeeIqd === null) deliveryFee = null;
      else {
        const fee = Math.round(Number(input.deliveryFeeIqd));
        if (!Number.isFinite(fee) || fee < 0 || fee > 100_000_000) {
          throw new BadRequestException('invalid delivery fee');
        }
        deliveryFee = fee;
      }
    }
    const post = await this.prisma.post.findFirst({
      where: { id: input.postId, authorId: sellerId, deletedAt: null, archivedAt: null }
    });
    if (!post) throw new NotFoundException('post not found');
    return this.prisma.catalogProduct.upsert({
      where: { postId: input.postId },
      create: {
        sellerId,
        postId: input.postId,
        priceIqd: price,
        title: input.title?.trim() || post.caption?.slice(0, 120) || null,
        active: input.active !== false,
        inStock: input.inStock !== false,
        deliveryFeeIqd: deliveryFee ?? null,
        sortOrder: input.sortOrder ?? 0
      },
      update: {
        priceIqd: price,
        ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.inStock !== undefined ? { inStock: input.inStock } : {}),
        ...(deliveryFee !== undefined ? { deliveryFeeIqd: deliveryFee } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {})
      }
    });
  }

  async updateProduct(
    sellerId: string,
    productId: string,
    input: {
      title?: string;
      priceIqd?: number;
      active?: boolean;
      inStock?: boolean;
      deliveryFeeIqd?: number | null;
      sortOrder?: number;
    }
  ) {
    await this.assertBusinessSeller(sellerId);
    const row = await this.prisma.catalogProduct.findFirst({ where: { id: productId, sellerId } });
    if (!row) throw new NotFoundException('product not found');
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title?.trim() || null;
    if (input.priceIqd !== undefined) {
      const price = Math.round(Number(input.priceIqd));
      if (!Number.isFinite(price) || price < 1 || price > 100_000_000) {
        throw new BadRequestException('invalid price');
      }
      data.priceIqd = price;
    }
    if (input.active !== undefined) data.active = input.active;
    if (input.inStock !== undefined) data.inStock = input.inStock;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.deliveryFeeIqd !== undefined) {
      if (input.deliveryFeeIqd === null) data.deliveryFeeIqd = null;
      else {
        const fee = Math.round(Number(input.deliveryFeeIqd));
        if (!Number.isFinite(fee) || fee < 0 || fee > 100_000_000) {
          throw new BadRequestException('invalid delivery fee');
        }
        data.deliveryFeeIqd = fee;
      }
    }
    return this.prisma.catalogProduct.update({ where: { id: productId }, data });
  }

  async listOwnerCatalog(sellerId: string) {
    await this.assertBusinessSeller(sellerId);
    const profile = await this.prisma.businessProfile.findUnique({
      where: { userId: sellerId },
      select: { defaultDeliveryFeeIqd: true, businessName: true }
    });
    const products = await this.prisma.catalogProduct.findMany({
      where: { sellerId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        post: {
          include: {
            media: { include: { media: true }, orderBy: { sortOrder: 'asc' }, take: 1 }
          }
        }
      }
    });
    const withMedia = await Promise.all(
      products.map(async (p) => {
        const m = p.post.media[0]?.media;
        let secureUrl: string | null = null;
        if (m) {
          try {
            secureUrl = await this.mediaStorage.createReadUrl(m.id, m.storageKey);
          } catch {
            secureUrl = null;
          }
        }
        return {
          id: p.id,
          postId: p.postId,
          title: p.title || p.post.caption || 'Product',
          priceIqd: p.priceIqd,
          deliveryFeeIqd: p.deliveryFeeIqd,
          currency: p.currency,
          active: p.active,
          inStock: p.inStock,
          sortOrder: p.sortOrder,
          media: m
            ? {
                id: m.id,
                mimeType: m.mimeType,
                secureUrl,
                processingStatus: m.processingStatus
              }
            : null
        };
      })
    );
    return {
      defaultDeliveryFeeIqd: profile?.defaultDeliveryFeeIqd ?? 0,
      businessName: profile?.businessName ?? null,
      products: withMedia
    };
  }

  async removeProduct(sellerId: string, productId: string) {
    const row = await this.prisma.catalogProduct.findFirst({ where: { id: productId, sellerId } });
    if (!row) throw new NotFoundException('product not found');
    await this.prisma.catalogProduct.delete({ where: { id: productId } });
    return { ok: true };
  }

  async catalogForSeller(usernameOrId: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: usernameOrId }, { username: usernameOrId }] },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        accountType: true,
        businessProfile: {
          select: {
            businessName: true,
            externalLinks: true,
            websiteUrl: true,
            defaultDeliveryFeeIqd: true
          }
        }
      }
    });
    if (!user || user.accountType !== 'business') {
      throw new NotFoundException('catalog not found');
    }
    const defaultDelivery = user.businessProfile?.defaultDeliveryFeeIqd ?? 0;
    const products = await this.prisma.catalogProduct.findMany({
      where: { sellerId: user.id, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        post: {
          include: {
            media: { include: { media: true }, orderBy: { sortOrder: 'asc' }, take: 1 }
          }
        }
      }
    });
    const withMedia = await Promise.all(
      products.map(async (p) => {
        const m = p.post.media[0]?.media;
        let secureUrl: string | null = null;
        if (m) {
          try {
            secureUrl = await this.mediaStorage.createReadUrl(m.id, m.storageKey);
          } catch {
            secureUrl = null;
          }
        }
        const delivery =
          p.deliveryFeeIqd != null ? p.deliveryFeeIqd : defaultDelivery;
        return {
          id: p.id,
          postId: p.postId,
          title: p.title || p.post.caption || 'Product',
          priceIqd: p.priceIqd,
          deliveryFeeIqd: delivery,
          customDeliveryFeeIqd: p.deliveryFeeIqd,
          inStock: p.inStock,
          currency: p.currency,
          caption: p.post.caption,
          media: m
            ? {
                id: m.id,
                mimeType: m.mimeType,
                secureUrl,
                processingStatus: m.processingStatus
              }
            : null
        };
      })
    );
    return {
      seller: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        businessName: user.businessProfile?.businessName || null,
        externalLinks: user.businessProfile?.externalLinks ?? [],
        websiteUrl: user.businessProfile?.websiteUrl ?? null,
        defaultDeliveryFeeIqd: defaultDelivery
      },
      products: withMedia
    };
  }

  async listSellerOrders(sellerId: string) {
    await this.assertBusinessSeller(sellerId);
    return this.prisma.storeOrder.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        items: {
          include: {
            product: { select: { id: true, title: true, priceIqd: true, postId: true } }
          }
        }
      }
    });
  }

  async placeOrder(
    buyerId: string | null,
    sellerUsernameOrId: string,
    input: {
      customerName: string;
      phone: string;
      countryCode?: string;
      governorate: string;
      area: string;
      landmark?: string;
      items: Array<{ productId: string; quantity: number }>;
    }
  ) {
    const seller = await this.prisma.user.findFirst({
      where: { OR: [{ id: sellerUsernameOrId }, { username: sellerUsernameOrId }] },
      select: { id: true, accountType: true }
    });
    if (!seller || seller.accountType !== 'business') {
      throw new NotFoundException('seller not found');
    }
    const name = input.customerName?.trim();
    if (!name || name.length < 2) throw new BadRequestException('customer name required');
    const phoneE164 = this.normalizeIraqPhone(input.phone);
    const countryCode = (input.countryCode || 'IQ').toUpperCase();
    if (countryCode !== 'IQ') throw new BadRequestException('only Iraq checkout is supported');
    const governorate = input.governorate?.trim();
    const area = input.area?.trim();
    if (!governorate || !area) throw new BadRequestException('governorate and area required');
    const lines = (input.items || [])
      .map((i) => ({ productId: i.productId, quantity: Math.max(1, Math.min(99, Math.round(i.quantity || 1))) }))
      .filter((i) => i.productId);
    if (!lines.length) throw new BadRequestException('cart is empty');

    const products = await this.prisma.catalogProduct.findMany({
      where: {
        id: { in: lines.map((l) => l.productId) },
        sellerId: seller.id,
        active: true,
        inStock: true
      }
    });
    if (products.length !== lines.length) {
      throw new BadRequestException('invalid or out-of-stock cart items');
    }

    const biz = await this.prisma.businessProfile.findUnique({
      where: { userId: seller.id },
      select: { defaultDeliveryFeeIqd: true }
    });
    const defaultDelivery = biz?.defaultDeliveryFeeIqd ?? 0;

    const byId = new Map(products.map((p) => [p.id, p]));
    let total = 0;
    const itemData = lines.map((l) => {
      const p = byId.get(l.productId)!;
      const delivery = p.deliveryFeeIqd != null ? p.deliveryFeeIqd : defaultDelivery;
      total += p.priceIqd * l.quantity + delivery * l.quantity;
      return {
        productId: p.id,
        quantity: l.quantity,
        unitPriceIqd: p.priceIqd
      };
    });

    return this.prisma.storeOrder.create({
      data: {
        sellerId: seller.id,
        buyerId: buyerId || null,
        customerName: name,
        phoneE164,
        countryCode: 'IQ',
        governorate,
        area,
        landmark: input.landmark?.trim() || null,
        status: 'placed',
        totalIqd: total,
        items: { create: itemData }
      },
      include: { items: true }
    });
  }
}
