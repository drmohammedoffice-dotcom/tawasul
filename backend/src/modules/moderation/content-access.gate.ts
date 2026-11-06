import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationRbacService } from './moderation-rbac.service';
import {
  isPubliclyVisible,
  OWNER_VISIBLE_STATUSES,
  type ModerationStatus
} from './moderation.visibility';

export type AccessDecision = {
  allowed: boolean;
  status: string;
  reason: string;
  emergency: boolean;
};

/**
 * Central backend gate: every public content fetch must pass here.
 * UI hiding alone is not sufficient.
 */
@Injectable()
export class ContentAccessGate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: ModerationRbacService
  ) {}

  async assertCanView(
    viewerId: string | null,
    contentType: string,
    contentId: string
  ): Promise<AccessDecision> {
    const row = await this.load(contentType, contentId);
    if (!row) throw new NotFoundException('content_not_found');

    const status = row.moderationStatus || 'APPROVED';
    const emergency = Boolean(row.emergency);
    const isOwner = Boolean(viewerId && row.authorId === viewerId);

    if (status === 'PERMANENTLY_DELETED') {
      throw new NotFoundException('content_not_found');
    }

    if (isPubliclyVisible(status)) {
      return { allowed: true, status, reason: 'public', emergency: false };
    }

    if (isOwner && OWNER_VISIBLE_STATUSES.includes(status as (typeof OWNER_VISIBLE_STATUSES)[number])) {
      return { allowed: true, status, reason: 'owner', emergency };
    }

    if (viewerId) {
      const role = await this.rbac.roleOf(viewerId);
      if (role !== 'none') {
        // Staff may open for review; evidence access still audited separately.
        return { allowed: true, status, reason: 'staff', emergency };
      }
    }

    // Do not leak existence of hidden/removed content to strangers.
    throw new NotFoundException('content_not_found');
  }

  async filterPublicIds(
    contentType: 'post' | 'reel' | 'story',
    ids: string[]
  ): Promise<string[]> {
    if (!ids.length) return [];
    if (contentType === 'post') {
      const rows = await this.prisma.post.findMany({
        where: {
          id: { in: ids },
          deletedAt: null,
          moderationStatus: { in: ['APPROVED', 'RESTORED'] }
        },
        select: { id: true }
      });
      return rows.map((r) => r.id);
    }
    if (contentType === 'reel') {
      const rows = await this.prisma.reel.findMany({
        where: {
          id: { in: ids },
          deletedAt: null,
          moderationStatus: { in: ['APPROVED', 'RESTORED'] }
        },
        select: { id: true }
      });
      return rows.map((r) => r.id);
    }
    const rows = await this.prisma.story.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        moderationStatus: { in: ['APPROVED', 'RESTORED'] }
      },
      select: { id: true }
    });
    return rows.map((r) => r.id);
  }

  /** Share / bookmark / notify surfaces must refuse restricted statuses. */
  assertShareable(status: string): void {
    if (!isPubliclyVisible(status)) {
      throw new ForbiddenException('content_not_shareable');
    }
  }

  private async load(contentType: string, contentId: string) {
    if (contentType === 'post') {
      const post = await this.prisma.post.findUnique({
        where: { id: contentId },
        select: { authorId: true, moderationStatus: true, deletedAt: true }
      });
      if (!post || post.deletedAt) return null;
      const emergency = await this.prisma.moderationCase.findFirst({
        where: { contentType: 'post', contentId, emergency: true },
        select: { emergency: true }
      });
      return { ...post, emergency: Boolean(emergency?.emergency) };
    }
    if (contentType === 'reel') {
      const reel = await this.prisma.reel.findUnique({
        where: { id: contentId },
        select: { authorId: true, moderationStatus: true, deletedAt: true }
      });
      if (!reel || reel.deletedAt) return null;
      const emergency = await this.prisma.moderationCase.findFirst({
        where: { contentType: 'reel', contentId, emergency: true },
        select: { emergency: true }
      });
      return { ...reel, emergency: Boolean(emergency?.emergency) };
    }
    if (contentType === 'story') {
      const story = await this.prisma.story.findUnique({
        where: { id: contentId },
        select: { authorId: true, moderationStatus: true, deletedAt: true }
      });
      if (!story || story.deletedAt) return null;
      return { ...story, emergency: false };
    }
    return null;
  }
}

export type { ModerationStatus };
