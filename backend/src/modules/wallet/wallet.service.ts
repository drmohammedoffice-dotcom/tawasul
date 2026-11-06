import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  Wallet,
  WalletCurrency,
  WalletTransactionStatus,
  WalletTransactionType
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SpendCoinsDto } from './dto/spend-coins.dto';
import { TransferCoinsDto } from './dto/transfer-coins.dto';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getWallet(userId: string): Promise<Wallet> {
    return this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId }
    });
  }

  async listTransactions(
    userId: string,
    opts?: {
      limit?: number;
      currency?: WalletCurrency;
      type?: WalletTransactionType;
      status?: WalletTransactionStatus;
    }
  ) {
    const wallet = await this.getWallet(userId);
    return this.prisma.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        ...(opts?.currency ? { currency: opts.currency } : {}),
        ...(opts?.type ? { type: opts.type } : {}),
        ...(opts?.status ? { status: opts.status } : {})
      },
      orderBy: { timestamp: 'desc' },
      take: Math.min(Math.max(opts?.limit ?? 50, 1), 100)
    });
  }

  async spend(userId: string, dto: SpendCoinsDto) {
    const currency = dto.currency ?? WalletCurrency.coins;
    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.getOrCreateWalletTx(tx, userId);
      if (dto.requestId) {
        const existing = await tx.walletTransaction.findUnique({
          where: { walletId_requestId: { walletId: wallet.id, requestId: dto.requestId } }
        });
        if (existing?.status === 'completed') {
          const walletCurrent = await tx.wallet.findUnique({ where: { id: wallet.id } });
          if (!walletCurrent) throw new NotFoundException('wallet not found');
          return walletCurrent;
        }
        if (existing?.status === 'failed') {
          throw new BadRequestException('this spend request was already processed as failed');
        }
      }
      const updated = await tx.wallet.updateMany({
        where: {
          id: wallet.id,
          ...(currency === WalletCurrency.coins
            ? { balance: { gte: dto.amount } }
            : { gemsBalance: { gte: dto.amount } })
        },
        data: {
          ...(currency === WalletCurrency.coins
            ? { balance: { decrement: dto.amount } }
            : { gemsBalance: { decrement: dto.amount } })
        }
      });

      if (updated.count !== 1) {
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'spend',
            currency,
            amount: dto.amount,
            status: 'failed',
            fromUserId: userId,
            reference: dto.reference ?? null,
            requestId: dto.requestId ?? null
          }
        });
        throw new BadRequestException('insufficient wallet balance');
      }

      const walletAfter = await tx.wallet.findUnique({ where: { id: wallet.id } });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'spend',
          currency,
          amount: dto.amount,
          status: 'completed',
          fromUserId: userId,
          reference: dto.reference ?? null,
          requestId: dto.requestId ?? null
        }
      });
      if (!walletAfter) {
        throw new NotFoundException('wallet not found');
      }
      return walletAfter;
    });
  }

  async earn(userId: string, amount: number, reference?: string) {
    return this.earnCurrency(userId, amount, WalletCurrency.coins, reference);
  }

  async earnCurrency(
    userId: string,
    amount: number,
    currency: WalletCurrency,
    reference?: string,
    requestId?: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.getOrCreateWalletTx(tx, userId);
      if (requestId) {
        const existing = await tx.walletTransaction.findUnique({
          where: { walletId_requestId: { walletId: wallet.id, requestId } }
        });
        if (existing?.status === 'completed') {
          const walletCurrent = await tx.wallet.findUnique({ where: { id: wallet.id } });
          if (!walletCurrent) throw new NotFoundException('wallet not found');
          return walletCurrent;
        }
        if (existing?.status === 'failed') {
          throw new BadRequestException('this earn request was already processed as failed');
        }
      }
      const walletAfter = await tx.wallet.update({
        where: { id: wallet.id },
        data:
          currency === WalletCurrency.coins
            ? { balance: { increment: amount } }
            : { gemsBalance: { increment: amount } }
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'earn',
          currency,
          amount,
          status: 'completed',
          toUserId: userId,
          reference: reference ?? null,
          requestId: requestId ?? null
        }
      });
      return walletAfter;
    });
  }

  async transfer(senderUserId: string, dto: TransferCoinsDto) {
    return this.transferAtomic({
      senderUserId,
      recipientUserId: dto.recipientUserId,
      amount: dto.amount,
      currency: dto.currency ?? WalletCurrency.coins,
      ...(dto.requestId ? { requestId: dto.requestId } : {}),
      ...(dto.reference ? { reference: dto.reference } : {})
    });
  }

  async transferAtomic(input: {
    senderUserId: string;
    recipientUserId: string;
    amount: number;
    currency?: WalletCurrency;
    requestId?: string;
    reference?: string;
    metadata?: Prisma.InputJsonValue;
    onCompleted?: (tx: Prisma.TransactionClient) => Promise<void>;
  }) {
    const currency = input.currency ?? WalletCurrency.coins;
    if (input.senderUserId === input.recipientUserId) {
      throw new BadRequestException('cannot transfer to yourself');
    }

    return this.prisma.$transaction(async (tx) => {
      const receiver = await tx.user.findUnique({
        where: { id: input.recipientUserId },
        select: { id: true }
      });
      if (!receiver) {
        throw new NotFoundException('recipient user not found');
      }

      const senderWallet = await this.getOrCreateWalletTx(tx, input.senderUserId);
      const receiverWallet = await this.getOrCreateWalletTx(tx, input.recipientUserId);
      if (input.requestId) {
        const existing = await tx.walletTransaction.findUnique({
          where: {
            walletId_requestId: {
              walletId: senderWallet.id,
              requestId: input.requestId
            }
          }
        });
        if (existing?.status === 'completed') {
          const [senderCurrent, receiverCurrent] = await Promise.all([
            tx.wallet.findUnique({
              where: { id: senderWallet.id },
              select: { balance: true, gemsBalance: true }
            }),
            tx.wallet.findUnique({
              where: { id: receiverWallet.id },
              select: { balance: true, gemsBalance: true }
            })
          ]);
          return {
            sender: {
              userId: input.senderUserId,
              coinsBalance: senderCurrent?.balance ?? 0,
              gemsBalance: senderCurrent?.gemsBalance ?? 0
            },
            receiver: {
              userId: input.recipientUserId,
              coinsBalance: receiverCurrent?.balance ?? 0,
              gemsBalance: receiverCurrent?.gemsBalance ?? 0
            }
          };
        }
        if (existing?.status === 'failed') {
          throw new BadRequestException('this transfer request was already processed as failed');
        }
      }

      const senderUpdated = await tx.wallet.updateMany({
        where: {
          id: senderWallet.id,
          ...(currency === WalletCurrency.coins
            ? { balance: { gte: input.amount } }
            : { gemsBalance: { gte: input.amount } })
        },
        data:
          currency === WalletCurrency.coins
            ? { balance: { decrement: input.amount } }
            : { gemsBalance: { decrement: input.amount } }
      });

      if (senderUpdated.count !== 1) {
        await tx.walletTransaction.create({
          data: {
            walletId: senderWallet.id,
            type: 'transfer',
            currency,
            amount: input.amount,
            status: 'failed',
            fromUserId: input.senderUserId,
            toUserId: input.recipientUserId,
            reference: input.reference ?? null,
            requestId: input.requestId ?? null,
            ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
          }
        });
        throw new BadRequestException('insufficient wallet balance for transfer');
      }

      await tx.wallet.update({
        where: { id: receiverWallet.id },
        data:
          currency === WalletCurrency.coins
            ? { balance: { increment: input.amount } }
            : { gemsBalance: { increment: input.amount } }
      });

      await tx.walletTransaction.createMany({
        data: [
          {
            walletId: senderWallet.id,
            type: 'transfer',
            currency,
            amount: input.amount,
            status: 'completed',
            fromUserId: input.senderUserId,
            toUserId: input.recipientUserId,
            reference: input.reference ?? null,
            requestId: input.requestId ?? null,
            ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
          },
          {
            walletId: receiverWallet.id,
            type: 'transfer',
            currency,
            amount: input.amount,
            status: 'completed',
            fromUserId: input.senderUserId,
            toUserId: input.recipientUserId,
            reference: input.reference ?? null,
            requestId: input.requestId ?? null,
            ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
          }
        ]
      });

      if (input.onCompleted) {
        await input.onCompleted(tx);
      }

      const [senderBalance, receiverBalance] = await Promise.all([
        tx.wallet.findUnique({
          where: { id: senderWallet.id },
          select: { balance: true, gemsBalance: true }
        }),
        tx.wallet.findUnique({
          where: { id: receiverWallet.id },
          select: { balance: true, gemsBalance: true }
        })
      ]);

      return {
        sender: {
          userId: input.senderUserId,
          coinsBalance: senderBalance?.balance ?? 0,
          gemsBalance: senderBalance?.gemsBalance ?? 0
        },
        receiver: {
          userId: input.recipientUserId,
          coinsBalance: receiverBalance?.balance ?? 0,
          gemsBalance: receiverBalance?.gemsBalance ?? 0
        }
      };
    });
  }

  private async getOrCreateWalletTx(tx: Prisma.TransactionClient, userId: string) {
    return tx.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId }
    });
  }
}
