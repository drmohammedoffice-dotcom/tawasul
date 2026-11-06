import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CloseFriendsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string) {
    const rows = await this.prisma.closeFriend.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      include: {
        friend: {
          select: { id: true, username: true, displayName: true, avatarUrl: true }
        }
      }
    });
    return rows.map((r) => ({ ...r.friend, addedAt: r.createdAt }));
  }

  /** Followers who can be added (accepted following owner). */
  async candidates(ownerId: string) {
    const followers = await this.prisma.follow.findMany({
      where: { followingId: ownerId, status: 'accepted' },
      include: {
        follower: {
          select: { id: true, username: true, displayName: true, avatarUrl: true }
        }
      },
      take: 200
    });
    const existing = await this.prisma.closeFriend.findMany({
      where: { ownerId },
      select: { friendId: true }
    });
    const set = new Set(existing.map((e) => e.friendId));
    return followers
      .map((f) => f.follower)
      .filter((u) => !set.has(u.id));
  }

  async add(ownerId: string, friendId: string) {
    if (ownerId === friendId) throw new BadRequestException('cannot add self');
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId: friendId, followingId: ownerId }
      }
    });
    if (!follow || follow.status !== 'accepted') {
      throw new BadRequestException('user must follow you first');
    }
    await this.prisma.closeFriend.upsert({
      where: { ownerId_friendId: { ownerId, friendId } },
      create: { ownerId, friendId },
      update: {}
    });
    return { added: true };
  }

  async remove(ownerId: string, friendId: string) {
    await this.prisma.closeFriend.deleteMany({ where: { ownerId, friendId } });
    return { removed: true };
  }

  async isCloseFriend(ownerId: string, viewerId: string): Promise<boolean> {
    if (ownerId === viewerId) return true;
    const row = await this.prisma.closeFriend.findUnique({
      where: { ownerId_friendId: { ownerId, friendId: viewerId } }
    });
    return Boolean(row);
  }
}
