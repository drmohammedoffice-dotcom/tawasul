import { Body, Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { UnifiedInboxService } from './unified-inbox.service';

class MuteDto {
  @IsIn(['dm', 'group', 'channel'])
  targetType!: 'dm' | 'group' | 'channel';

  @IsString()
  @Length(1, 191)
  targetId!: string;
}

@Controller('messaging/mutes')
@UseGuards(JwtAuthGuard)
export class ChatMutesController {
  constructor(private readonly inbox: UnifiedInboxService) {}

  @Post()
  async mute(@Req() req: { user: JwtPayload }, @Body() dto: MuteDto) {
    return ok('Muted', await this.inbox.mute(req.user.sub, dto.targetType, dto.targetId));
  }

  @Delete(':targetType/:targetId')
  async unmute(
    @Req() req: { user: JwtPayload },
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string
  ) {
    return ok('Unmuted', await this.inbox.unmute(req.user.sub, targetType, targetId));
  }
}
