import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService
  ) {}

  async notify(input: {
    recipientId: string;
    actorId?: string;
    type: string;
    entityType?: string;
    entityId?: string;
    payload?: Record<string, unknown>;
  }) {
    if (input.actorId && input.actorId === input.recipientId) return null;
    const row = await this.prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        actorId: input.actorId ?? null,
        type: input.type,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        ...(input.payload ? { payload: input.payload as object } : {})
      }
    });
    void this.push.fromInbox({
      recipientId: input.recipientId,
      type: input.type,
      notificationId: row.id,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
      ...(input.payload ? { payload: input.payload } : {})
    });
    return row;
  }

  list(userId: string, cursor?: string, limit = 30) {
    return this.prisma.notification.findMany({
      where: {
        recipientId: userId,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      include: {
        actor: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      }
    });
  }

  async markRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: userId, readAt: null },
      data: { readAt: new Date() }
    });
    return { notificationId, read: true };
  }
}
