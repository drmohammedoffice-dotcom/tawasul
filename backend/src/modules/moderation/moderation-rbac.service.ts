import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ModerationRole = 'none' | 'moderator' | 'admin';

export type ModerationPermission =
  | 'case.read'
  | 'case.decide'
  | 'appeal.review'
  | 'report.triage'
  | 'policy.edit'
  | 'account.suspend'
  | 'account.disable';

const ROLE_PERMS: Record<Exclude<ModerationRole, 'none'>, ModerationPermission[]> = {
  moderator: ['case.read', 'case.decide', 'appeal.review', 'report.triage'],
  admin: [
    'case.read',
    'case.decide',
    'appeal.review',
    'report.triage',
    'policy.edit',
    'account.suspend',
    'account.disable'
  ]
};

@Injectable()
export class ModerationRbacService {
  constructor(private readonly prisma: PrismaService) {}

  async roleOf(userId: string): Promise<ModerationRole> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });
    if (!user) return 'none';
    if (user.role === 'admin') return 'admin';
    if (user.role === 'moderator') return 'moderator';
    return 'none';
  }

  async assert(userId: string, permission: ModerationPermission): Promise<ModerationRole> {
    const role = await this.roleOf(userId);
    if (role === 'none' || !ROLE_PERMS[role].includes(permission)) {
      throw new ForbiddenException('moderation_permission_denied');
    }
    return role;
  }
}
