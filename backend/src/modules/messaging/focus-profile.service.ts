import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type FocusProfileDto = {
  displayName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  hideBrowseProfile?: boolean;
};

@Injectable()
export class FocusProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: string) {
    const existing = await this.prisma.focusProfile.findUnique({ where: { userId } });
    if (existing) return existing;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, bio: true, avatarUrl: true, username: true }
    });

    return this.prisma.focusProfile.create({
      data: {
        userId,
        displayName: user?.displayName || user?.username || null,
        bio: null,
        avatarUrl: null
      }
    });
  }

  async update(userId: string, dto: FocusProfileDto) {
    await this.getOrCreate(userId);
    return this.prisma.focusProfile.update({
      where: { userId },
      data: {
        ...(dto.displayName !== undefined
          ? { displayName: dto.displayName?.trim() || null }
          : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio?.trim().slice(0, 150) || null } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl || null } : {}),
        ...(dto.hideBrowseProfile !== undefined
          ? { hideBrowseProfile: Boolean(dto.hideBrowseProfile) }
          : {})
      }
    });
  }
}
