import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { MediaStorageService } from '../media/media.storage';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HighlightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService
  ) {}

  async listForProfile(viewerId: string | null, usernameOrId: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: usernameOrId }, { username: usernameOrId }] },
      select: { id: true, isPrivate: true }
    });
    if (!user) throw new NotFoundException('user not found');
    await this.assertCanViewProfile(viewerId, user.id, user.isPrivate);

    const rows = await this.prisma.storyHighlight.findMany({
      where: { userId: user.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { items: true } } }
    });
    return Promise.all(
      rows.map(async (h) => ({
        id: h.id,
        title: h.title,
        sortOrder: h.sortOrder,
        itemCount: h._count.items,
        coverSecureUrl: h.coverMediaId
          ? await this.safeUrl(h.coverMediaId)
          : null
      }))
    );
  }

  async create(userId: string, input: { title: string; coverMediaId?: string; storyIds?: string[] }) {
    const title = input.title?.trim();
    if (!title || title.length < 1) throw new BadRequestException('title required');
    const highlight = await this.prisma.storyHighlight.create({
      data: {
        userId,
        title: title.slice(0, 40),
        coverMediaId: input.coverMediaId || null
      }
    });
    if (input.storyIds?.length) {
      await this.addStories(userId, highlight.id, input.storyIds);
    }
    return highlight;
  }

  async update(
    userId: string,
    highlightId: string,
    input: { title?: string; coverMediaId?: string | null; sortOrder?: number }
  ) {
    await this.requireOwned(userId, highlightId);
    return this.prisma.storyHighlight.update({
      where: { id: highlightId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim().slice(0, 40) } : {}),
        ...(input.coverMediaId !== undefined ? { coverMediaId: input.coverMediaId } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {})
      }
    });
  }

  async remove(userId: string, highlightId: string) {
    await this.requireOwned(userId, highlightId);
    await this.prisma.storyHighlight.delete({ where: { id: highlightId } });
    return { deleted: true };
  }

  async addStories(userId: string, highlightId: string, storyIds: string[]) {
    await this.requireOwned(userId, highlightId);
    const stories = await this.prisma.story.findMany({
      where: { id: { in: storyIds }, authorId: userId, deletedAt: null }
    });
    if (!stories.length) throw new BadRequestException('no valid stories');
    let order = await this.prisma.storyHighlightItem.count({ where: { highlightId } });
    for (const s of stories) {
      await this.prisma.storyHighlightItem.upsert({
        where: { highlightId_mediaId: { highlightId, mediaId: s.mediaId } },
        create: {
          highlightId,
          mediaId: s.mediaId,
          storyId: s.id,
          sortOrder: order++
        },
        update: {}
      });
    }
    return this.getItems(userId, highlightId);
  }

  async removeItem(userId: string, highlightId: string, mediaId: string) {
    await this.requireOwned(userId, highlightId);
    await this.prisma.storyHighlightItem.deleteMany({ where: { highlightId, mediaId } });
    return { removed: true };
  }

  async getItems(viewerId: string | null, highlightId: string) {
    const highlight = await this.prisma.storyHighlight.findUnique({
      where: { id: highlightId },
      include: {
        user: { select: { id: true, isPrivate: true, username: true } },
        items: { orderBy: { sortOrder: 'asc' } }
      }
    });
    if (!highlight) throw new NotFoundException('highlight not found');
    await this.assertCanViewProfile(viewerId, highlight.userId, highlight.user.isPrivate);
    const items = await Promise.all(
      highlight.items.map(async (it) => ({
        mediaId: it.mediaId,
        storyId: it.storyId,
        sortOrder: it.sortOrder,
        secureUrl: await this.safeUrl(it.mediaId)
      }))
    );
    return {
      id: highlight.id,
      title: highlight.title,
      username: highlight.user.username,
      items
    };
  }

  private async requireOwned(userId: string, highlightId: string) {
    const h = await this.prisma.storyHighlight.findUnique({ where: { id: highlightId } });
    if (!h) throw new NotFoundException('highlight not found');
    if (h.userId !== userId) throw new ForbiddenException('not owner');
    return h;
  }

  private async assertCanViewProfile(viewerId: string | null, ownerId: string, isPrivate: boolean) {
    if (viewerId === ownerId) return;
    if (!viewerId) {
      if (isPrivate) throw new ForbiddenException('private profile');
      return;
    }
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: ownerId },
          { blockerId: ownerId, blockedId: viewerId }
        ]
      }
    });
    if (blocked) throw new ForbiddenException('not allowed');
    if (!isPrivate) return;
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId: viewerId, followingId: ownerId }
      }
    });
    if (!follow || follow.status !== 'accepted') throw new ForbiddenException('private profile');
  }

  private async safeUrl(mediaId: string): Promise<string | null> {
    const media = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaId, deletedAt: null }
    });
    if (!media) return null;
    try {
      return await this.mediaStorage.createReadUrl(media.id, media.storageKey);
    } catch {
      return null;
    }
  }
}
