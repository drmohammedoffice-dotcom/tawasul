import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { UnifiedInboxService } from './unified-inbox.service';

@Controller('messaging')
@UseGuards(JwtAuthGuard)
export class MessagingInboxController {
  constructor(private readonly inbox: UnifiedInboxService) {}

  @Get('inbox')
  async list(
    @Req() req: { user: JwtPayload },
    @Query('limit') limit?: string,
    @Query('space') space?: string
  ) {
    const appSpace = space === 'browse' ? 'browse' : 'focus';
    const items = await this.inbox.listInbox(req.user.sub, limit ? Number(limit) : 60, appSpace);
    return ok('Inbox loaded', items);
  }
}
