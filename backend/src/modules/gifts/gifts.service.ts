import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MessagingPubSubService } from '../messaging/messaging-pubsub.service';
import { MESSAGING_CHANNELS } from '../messaging/messaging.constants';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { GIFT_CATALOG } from './gift-catalog';
import { SendCoinsGiftDto } from './dto/send-coins-gift.dto';
import { SendGiftDto } from './dto/send-gift.dto';

@Injectable()
export class GiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly messagingPubSubService: MessagingPubSubService
  ) {}

  getCatalog() {
    return GIFT_CATALOG;
  }

  async listHistory(userId: string, limit = 50) {
    return this.prisma.giftTransfer.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }]
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100)
    });
  }

  async sendCoinsGift(senderId: string, dto: SendCoinsGiftDto) {
    await this.assertReceiverExists(dto.receiverId);
    const reference = `gift_coins_${Date.now()}`;
    const transfer = await this.walletService.transferAtomic({
      senderUserId: senderId,
      recipientUserId: dto.receiverId,
      amount: dto.amountCoins,
      reference,
      metadata: {
        reason: 'chat_gift_coins'
      } as Prisma.InputJsonValue,
      onCompleted: async (tx) => {
        await tx.giftTransfer.create({
          data: {
            senderId,
            receiverId: dto.receiverId,
            kind: 'coins',
            amountCoins: dto.amountCoins,
            note: dto.note ?? null,
            status: 'completed'
          }
        });
      }
    });

    await this.messagingPubSubService.publish(MESSAGING_CHANNELS.GIFT_SENT, {
      senderId,
      receiverId: dto.receiverId,
      kind: 'coins',
      amountCoins: dto.amountCoins,
      note: dto.note ?? null,
      createdAt: new Date().toISOString()
    });

    return transfer;
  }

  async sendPresetGift(senderId: string, dto: SendGiftDto) {
    await this.assertReceiverExists(dto.receiverId);
    const gift = GIFT_CATALOG.find((item) => item.key === dto.giftKey);
    if (!gift) {
      throw new BadRequestException('gift key not found');
    }
    const quantity = dto.quantity ?? 1;
    const amountCoins = gift.costCoins * quantity;
    const reference = `gift_${gift.key}_${Date.now()}`;

    const transfer = await this.walletService.transferAtomic({
      senderUserId: senderId,
      recipientUserId: dto.receiverId,
      amount: amountCoins,
      reference,
      metadata: {
        reason: 'chat_gift',
        giftKey: gift.key,
        quantity
      } as Prisma.InputJsonValue,
      onCompleted: async (tx) => {
        await tx.giftTransfer.create({
          data: {
            senderId,
            receiverId: dto.receiverId,
            kind: 'gift',
            giftKey: gift.key,
            quantity,
            amountCoins,
            animationKey: gift.animationKey ?? null,
            note: dto.note ?? null,
            status: 'completed'
          }
        });
      }
    });

    await this.messagingPubSubService.publish(MESSAGING_CHANNELS.GIFT_SENT, {
      senderId,
      receiverId: dto.receiverId,
      kind: 'gift',
      giftKey: gift.key,
      quantity,
      amountCoins,
      animationKey: gift.animationKey ?? null,
      note: dto.note ?? null,
      createdAt: new Date().toISOString()
    });

    return transfer;
  }

  private async assertReceiverExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new NotFoundException('receiver user not found');
    }
  }
}
