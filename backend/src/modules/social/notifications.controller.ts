import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @Req() req: { user: JwtPayload },
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    const items = await this.notificationsService.list(
      req.user.sub,
      cursor,
      limit ? Number(limit) : 30
    );
    return ok('Notifications', items);
  }

  @Post(':id/read')
  async markRead(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Notification marked read', await this.notificationsService.markRead(req.user.sub, id));
  }
}
