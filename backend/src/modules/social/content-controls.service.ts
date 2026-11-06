import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { ContentAccessGate } from '../moderation/content-access.gate';
import { PrismaService } from '../prisma/prisma.service';
import { MediaStorageService } from '../media/media.storage';
import { RecommendationEventsService } from '../recommendations/events.service';
import { RecommendationPlannerService } from '../recommendations/planner.service';

@Injectable()
export class ContentControlsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
    private readonly recommendationEvents: RecommendationEventsService,
    private readonly planner: RecommendationPlannerService,
    private readonly contentAccess: ContentAccessGate
  ) {}

  async setPostComments(userId: string, postId: string, disabled: boolean) {
    const post = await this.requireOwnedPost(userId, postId);
    return this.prisma.post.update({
      where: { id: post.id },
      data: { commentsDisabled: disabled },
      select: { id: true, commentsDisabled: true }
    });
  }

  async archivePost(userId: string, postId: string, archive: boolean) {
    const post = await this.requireOwnedPost(userId, postId, true);
    return this.prisma.post.update({
      where: { id: post.id },
      data: { archivedAt: archive ? new Date() : null },
      select: { id: true, archivedAt: true }
    });
  }

  async setReelComments(userId: string, reelId: string, disabled: boolean) {
    const reel = await this.requireOwnedReel(userId, reelId);
    return this.prisma.reel.update({
      where: { id: reel.id },
      data: { commentsDisabled: disabled },
      select: { id: true, commentsDisabled: true }
    });
  }

  async archiveReel(userId: string, reelId: string, archive: boolean) {
    const reel = await this.requireOwnedReel(userId, reelId, true);
    return this.prisma.reel.update({
      where: { id: reel.id },
      data: { archivedAt: archive ? new Date() : null },
      select: { id: true, archivedAt: true }
    });
  }

  async listArchive(userId: string) {
    const [posts, reels] = await Promise.all([
      this.prisma.post.findMany({
        where: { authorId: userId, deletedAt: null, archivedAt: { not: null } },
        orderBy: { archivedAt: 'desc' },
        take: 80,
        include: {
          media: {
            take: 1,
            orderBy: { sortOrder: 'asc' },
            include: { media: true }
          }
        }
      }),
      this.prisma.reel.findMany({
        where: { authorId: userId, deletedAt: null, archivedAt: { not: null } },
        orderBy: { archivedAt: 'desc' },
        take: 80,
        include: { media: true }
      })
    ]);
    const postsOut = await Promise.all(
      posts.map(async (p) => {
        const row = p.media?.[0]?.media;
        let secureUrl: string | null = null;
        let posterUrl: string | null = null;
        if (row) {
          try {
            secureUrl = await this.mediaStorage.createReadUrl(row.id, row.storageKey);
          } catch {
            secureUrl = null;
          }
          if (row.thumbnailKey) {
            try {
              posterUrl = await this.mediaStorage.createReadUrl(row.id, row.thumbnailKey);
            } catch {
              posterUrl = null;
            }
          }
        }
        return {
          id: p.id,
          caption: p.caption,
          archivedAt: p.archivedAt,
          createdAt: p.createdAt,
          kind: 'post' as const,
          media: row
            ? { id: row.id, mimeType: row.mimeType, secureUrl, posterUrl }
            : null
        };
      })
    );
    const reelsOut = await Promise.all(
      reels.map(async (r) => {
        let secureUrl: string | null = null;
        let posterUrl: string | null = null;
        if (r.media) {
          try {
            secureUrl = await this.mediaStorage.createReadUrl(r.media.id, r.media.storageKey);
          } catch {
            secureUrl = null;
          }
          if (r.media.thumbnailKey) {
            try {
              posterUrl = await this.mediaStorage.createReadUrl(r.media.id, r.media.thumbnailKey);
            } catch {
              posterUrl = null;
            }
          }
        }
        return {
          id: r.id,
          caption: r.caption,
          archivedAt: r.archivedAt,
          createdAt: r.createdAt,
          kind: 'reel' as const,
          media: r.media
            ? {
                id: r.media.id,
                mimeType: r.media.mimeType,
                secureUrl,
                posterUrl
              }
            : null
        };
      })
    );
    return { posts: postsOut, reels: reelsOut };
  }

  async recordSignal(
    userId: string,
    input: { targetType: 'post' | 'reel'; targetId: string; signal: 'more_like_this' | 'not_interested' }
  ) {
    if (!['post', 'reel'].includes(input.targetType)) {
      throw new BadRequestException('invalid targetType');
    }
    if (!['more_like_this', 'not_interested'].includes(input.signal)) {
      throw new BadRequestException('invalid signal');
    }
    if (input.targetType === 'post') {
      const post = await this.prisma.post.findFirst({ where: { id: input.targetId, deletedAt: null } });
      if (!post) throw new NotFoundException('post not found');
    } else {
      const reel = await this.prisma.reel.findFirst({ where: { id: input.targetId, deletedAt: null } });
      if (!reel) throw new NotFoundException('reel not found');
    }
    await this.prisma.contentSignal.upsert({
      where: {
        userId_targetType_targetId_signal: {
          userId,
          targetType: input.targetType,
          targetId: input.targetId,
          signal: input.signal
        }
      },
      create: {
        userId,
        targetType: input.targetType,
        targetId: input.targetId,
        signal: input.signal
      },
      update: {}
    });
    void this.recommendationEvents.recordTrusted(userId, {
      eventType: input.signal === 'not_interested' ? 'not_interested' : 'more_like_this',
      contentType: input.targetType,
      contentId: input.targetId,
      surface: 'explore'
    });
    void this.planner.invalidate(userId);
    return {
      recorded: true,
      note: 'Preference stored. Not interested items are removed from ranking, and more like this boosts those topics.'
    };
  }

  async shareLink(userId: string, targetType: 'post' | 'reel' | 'story', targetId: string) {
    await this.assertCanView(userId, targetType, targetId);
    const base = ((process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0] || 'http://localhost:5173').trim();
    const path =
      targetType === 'post'
        ? `/p/${targetId}`
        : targetType === 'reel'
          ? `/reels?id=${targetId}`
          : `/stories/${targetId}`;
    return { url: `${base}${path}`, targetType, targetId };
  }

  async shareToDm(
    userId: string,
    input: { receiverIds: string[]; targetType: 'post' | 'reel' | 'story'; targetId: string }
  ) {
    if (!input.receiverIds?.length || input.receiverIds.length > 20) {
      throw new BadRequestException('select 1–20 recipients');
    }
    await this.assertCanView(userId, input.targetType, input.targetId);
    const link = await this.shareLink(userId, input.targetType, input.targetId);
    const content = `[share:${input.targetType}:${input.targetId}] ${link.url}`;
    const sent: string[] = [];
    for (const receiverId of [...new Set(input.receiverIds)]) {
      if (receiverId === userId) continue;
      const blocked = await this.prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: receiverId },
            { blockerId: receiverId, blockedId: userId }
          ]
        }
      });
      if (blocked) continue;
      const peer = await this.prisma.user.findUnique({ where: { id: receiverId }, select: { id: true } });
      if (!peer) continue;
      const msg = await this.prisma.message.create({
        data: {
          senderId: userId,
          receiverId,
          encryptedContent: content,
          status: MessageStatus.sent
        }
      });
      sent.push(msg.id);
    }
    let shareCount: number | undefined;
    if (sent.length && input.targetType === 'post') {
      const updated = await this.prisma.post.update({
        where: { id: input.targetId },
        data: { shareCount: { increment: sent.length } },
        select: { shareCount: true }
      });
      shareCount = updated.shareCount;
    } else if (sent.length && input.targetType === 'reel') {
      const updated = await this.prisma.reel.update({
        where: { id: input.targetId },
        data: { shareCount: { increment: sent.length } },
        select: { shareCount: true }
      });
      shareCount = updated.shareCount;
    }
    return { sentCount: sent.length, url: link.url, shareCount };
  }

  async downloadUrl(userId: string, targetType: 'post' | 'reel', targetId: string) {
    if (targetType === 'post') {
      await this.assertCanView(userId, 'post', targetId);
      const media = await this.prisma.postMedia.findFirst({
        where: { postId: targetId },
        orderBy: { sortOrder: 'asc' },
        include: { media: true }
      });
      if (!media?.media || media.media.deletedAt) throw new NotFoundException('media not found');
      const secureUrl = await this.mediaStorage.createReadUrl(media.media.id, media.media.storageKey);
      return { mediaId: media.media.id, mimeType: media.media.mimeType, secureUrl };
    }
    await this.assertCanView(userId, 'reel', targetId);
    const reel = await this.prisma.reel.findFirst({
      where: { id: targetId, deletedAt: null },
      include: { media: true }
    });
    if (!reel?.media) throw new NotFoundException('media not found');
    const secureUrl = await this.mediaStorage.createReadUrl(reel.media.id, reel.media.storageKey);
    return { mediaId: reel.media.id, mimeType: reel.media.mimeType, secureUrl };
  }

  private async requireOwnedPost(userId: string, postId: string, allowArchived = false) {
    const post = await this.prisma.post.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        ...(allowArchived ? {} : {})
      }
    });
    if (!post) throw new NotFoundException('post not found');
    if (post.authorId !== userId) throw new ForbiddenException('not post owner');
    return post;
  }

  private async requireOwnedReel(userId: string, reelId: string, allowArchived = false) {
    void allowArchived;
    const reel = await this.prisma.reel.findFirst({ where: { id: reelId, deletedAt: null } });
    if (!reel) throw new NotFoundException('reel not found');
    if (reel.authorId !== userId) throw new ForbiddenException('not reel owner');
    return reel;
  }

  private async assertCanView(userId: string, targetType: string, targetId: string) {
    if (targetType !== 'post' && targetType !== 'reel' && targetType !== 'story') {
      throw new BadRequestException('invalid targetType');
    }
    const access = await this.contentAccess.assertCanView(userId, targetType, targetId);
    this.contentAccess.assertShareable(access.status);

    if (targetType === 'post') {
      const post = await this.prisma.post.findFirst({
        where: { id: targetId, deletedAt: null, archivedAt: null },
        include: { author: { select: { id: true, isPrivate: true } } }
      });
      if (!post) throw new NotFoundException('post not found or unavailable');
      await this.assertEngage(userId, post.authorId, post.author.isPrivate);
      return;
    }
    if (targetType === 'reel') {
      const reel = await this.prisma.reel.findFirst({
        where: { id: targetId, deletedAt: null, archivedAt: null },
        include: { author: { select: { id: true, isPrivate: true } } }
      });
      if (!reel) throw new NotFoundException('reel not found or unavailable');
      await this.assertEngage(userId, reel.authorId, reel.author.isPrivate);
      return;
    }
    if (targetType === 'story') {
      const story = await this.prisma.story.findFirst({
        where: { id: targetId, deletedAt: null, expiresAt: { gt: new Date() } },
        include: { author: { select: { id: true, isPrivate: true } } }
      });
      if (!story) throw new NotFoundException('story expired or unavailable');
      if (story.audience === 'close_friends' && story.authorId !== userId) {
        const cf = await this.prisma.closeFriend.findUnique({
          where: {
            ownerId_friendId: { ownerId: story.authorId, friendId: userId }
          }
        });
        if (!cf) throw new ForbiddenException('close friends only');
      }
      await this.assertEngage(userId, story.authorId, story.author.isPrivate);
      return;
    }
    throw new BadRequestException('invalid targetType');
  }

  private async assertEngage(viewerId: string, authorId: string, isPrivate: boolean) {
    if (viewerId === authorId) return;
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: authorId },
          { blockerId: authorId, blockedId: viewerId }
        ]
      }
    });
    if (blocked) throw new ForbiddenException('not allowed');
    if (isPrivate) {
      const follow = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: { followerId: viewerId, followingId: authorId }
        }
      });
      if (!follow || follow.status !== 'accepted') throw new ForbiddenException('private content');
    }
  }
}
