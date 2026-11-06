import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../audit/audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ChannelMessageDto } from './dto/channel-message.dto';
import { ChannelSubscriptionDto } from './dto/channel-subscription.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { ChannelsService } from './channels.service';

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Get()
  async listMine(@Req() req: { user: JwtPayload }) {
    return ok('Channels', await this.channelsService.listMyChannels(req.user.sub));
  }

  @Post('join/invite/:inviteSlug')
  async joinByInvite(@Req() req: { user: JwtPayload }, @Param('inviteSlug') inviteSlug: string) {
    return ok('Joined channel', await this.channelsService.joinByInviteSlug(req.user.sub, inviteSlug));
  }

  @Post()
  async createChannel(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: CreateChannelDto) {
    const channel = await this.channelsService.createChannel(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'channel.create',
      resourceType: 'channel',
      resourceId: channel.id,
      outcome: 'success'
    });
    return ok('Channel created', channel);
  }

  @Get(':channelId')
  async getOne(@Req() req: { user: JwtPayload }, @Param('channelId') channelId: string) {
    return ok('Channel', await this.channelsService.getChannelForSubscriber(req.user.sub, channelId));
  }

  @Patch(':channelId')
  async update(
    @Req() req: { user: JwtPayload },
    @Param('channelId') channelId: string,
    @Body() dto: UpdateChannelDto
  ) {
    return ok('Channel updated', await this.channelsService.updateChannel(req.user.sub, channelId, dto));
  }

  @Get(':channelId/subscriptions')
  async listSubscriptions(@Req() req: { user: JwtPayload }, @Param('channelId') channelId: string) {
    return ok(
      'Subscriptions',
      await this.channelsService.listSubscriptions(req.user.sub, channelId)
    );
  }

  @Post(':channelId/subscriptions')
  async subscribe(
    @Req() req: { user: JwtPayload },
    @Param('channelId') channelId: string,
    @Body() dto: ChannelSubscriptionDto
  ) {
    const sub = await this.channelsService.subscribe(
      req.user.sub,
      channelId,
      dto.userId,
      dto.role ?? 'member'
    );
    return ok('Subscription updated', sub);
  }

  @Delete(':channelId/subscriptions/:userId')
  async unsubscribe(
    @Req() req: { user: JwtPayload },
    @Param('channelId') channelId: string,
    @Param('userId') userId: string
  ) {
    const removed = await this.channelsService.unsubscribe(req.user.sub, channelId, userId);
    return ok('Subscription removed', removed);
  }

  @Post(':channelId/messages')
  async postMessage(
    @Req() req: { user: JwtPayload },
    @Param('channelId') channelId: string,
    @Body() dto: ChannelMessageDto
  ) {
    const message = await this.channelsService.postChannelMessage(
      req.user.sub,
      channelId,
      dto.encryptedContent
    );
    return ok('Channel message posted', message);
  }

  @Get(':channelId/messages')
  async listMessages(
    @Req() req: { user: JwtPayload },
    @Param('channelId') channelId: string,
    @Query() query?: PaginationQueryDto
  ) {
    const messages = await this.channelsService.listChannelMessages(req.user.sub, channelId, {
      ...(query?.before ? { before: query.before } : {}),
      ...(query?.limit ? { limit: query.limit } : {})
    });
    return ok('Channel messages fetched', messages);
  }

  @Post(':channelId/read')
  async markRead(@Req() req: { user: JwtPayload }, @Param('channelId') channelId: string) {
    return ok('Channel marked read', await this.channelsService.markRead(req.user.sub, channelId));
  }

  @Post(':channelId/join')
  async joinSelf(@Req() req: { user: JwtPayload }, @Param('channelId') channelId: string) {
    return ok('Joined channel', await this.channelsService.joinSelf(req.user.sub, channelId));
  }

  @Get(':channelId/invite')
  async inviteLink(@Req() req: { user: JwtPayload }, @Param('channelId') channelId: string) {
    return ok('Channel invite', await this.channelsService.ensureInviteSlug(req.user.sub, channelId));
  }

  @Post(':channelId/leave')
  async leave(@Req() req: { user: JwtPayload }, @Param('channelId') channelId: string) {
    return ok('Left channel', await this.channelsService.leaveSelf(req.user.sub, channelId));
  }

  @Post(':channelId/pin')
  async pin(
    @Req() req: { user: JwtPayload },
    @Param('channelId') channelId: string,
    @Body() body: { messageId?: string | null }
  ) {
    return ok(
      'Pinned',
      await this.channelsService.pinMessage(req.user.sub, channelId, body.messageId ?? null)
    );
  }
}
