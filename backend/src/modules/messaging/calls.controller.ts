import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { CallKind } from '@prisma/client';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CallService } from './call.service';

class StartDmCallDto {
  @IsString()
  @Length(1, 191)
  peerUserId!: string;

  @IsIn(['audio', 'video'])
  kind!: 'audio' | 'video';
}

class StartSpaceCallDto {
  @IsIn(['group', 'channel'])
  scope!: 'group' | 'channel';

  @IsString()
  @Length(1, 191)
  spaceId!: string;

  @IsIn(['audio', 'video'])
  kind!: 'audio' | 'video';
}

class CallActionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly calls: CallService) {}

  @Get('ice-servers')
  async ice() {
    return ok('ICE servers', await this.calls.getIceServers());
  }

  @Get('history')
  async history(@Req() req: { user: JwtPayload }, @Query('filter') filter?: string) {
    const f = filter === 'missed' ? 'missed' : 'all';
    return ok('Call history', await this.calls.listHistory(req.user.sub, f));
  }

  @Post('dm')
  async startDm(@Req() req: { user: JwtPayload }, @Body() dto: StartDmCallDto) {
    const result = await this.calls.startDmCall(req.user.sub, dto.peerUserId, dto.kind as CallKind);
    return ok('Call ringing', result);
  }

  @Post('space')
  async startSpace(@Req() req: { user: JwtPayload }, @Body() dto: StartSpaceCallDto) {
    const result = await this.calls.startSpaceCall(req.user.sub, dto.scope, dto.spaceId, dto.kind as CallKind);
    return ok('Space call ringing', result);
  }

  @Post(':id/accept')
  async accept(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Call accepted', await this.calls.accept(req.user.sub, id));
  }

  @Post(':id/reject')
  async reject(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Call rejected', await this.calls.reject(req.user.sub, id));
  }

  @Post(':id/end')
  async end(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: CallActionDto) {
    return ok('Call ended', await this.calls.end(req.user.sub, id, dto.reason || 'ended'));
  }

  @Post(':id/join')
  async join(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Joined call', await this.calls.join(req.user.sub, id));
  }
}
