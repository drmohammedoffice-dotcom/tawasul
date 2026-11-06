import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { ROLES_KEY } from './roles.decorator';

/**
 * Deny-by-default role gate. Always re-loads role from DB so a demotion
 * takes effect before the access JWT expires.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!required?.length) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{ user?: { sub?: string } }>();
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('authentication required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });
    if (!user) {
      throw new UnauthorizedException('user not found');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException('insufficient role');
    }
    return true;
  }
}
