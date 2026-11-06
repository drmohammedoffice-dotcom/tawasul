import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { AuditLogService } from '../audit/audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { MessagingService } from './messaging.service';
import { SendPrivateMessageDto } from './dto/send-private-message.dto';
import { PrivateConversationQueryDto } from './dto/private-conversation-query.dto';
import { UpdateMessageStatusDto } from './dto/update-message-status.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { MessageReactionDto } from './dto/message-reaction.dto';

@Controller('messages')
export class MessagingController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly auditLogService: AuditLogService
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async sendMessage(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: SendPrivateMessageDto) {
    const message = await this.messagingService.createPrivateMessage(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'message.send.rest',
      resourceType: 'message',
      resourceId: message.id,
      outcome: 'success',
      metadata: { receiverId: dto.receiverId }
    });
    return ok('Message sent', message);
  }

  @UseGuards(JwtAuthGuard)
  @Get('conversations')
  async listConversations(
    @Req() req: { user: JwtPayload },
    @Query('limit') limit?: string,
    @Query('space') space?: string
  ) {
    const appSpace = space === 'focus' ? 'focus' : 'browse';
    const items = await this.messagingService.listConversations(
      req.user.sub,
      limit ? Number(limit) : 40,
      appSpace
    );
    return ok('Conversations loaded', items);
  }

  @UseGuards(JwtAuthGuard)
  @Get('private/:peerUserId')
  async getPrivateMessages(
    @Req() req: { user: JwtPayload },
    @Param('peerUserId') peerUserId: string,
    @Query() query: PrivateConversationQueryDto
  ) {
    const appSpace = query?.space === 'focus' ? 'focus' : 'browse';
    const messages = await this.messagingService.listPrivateConversation(req.user.sub, peerUserId, {
      ...(query?.before ? { before: query.before } : {}),
      ...(query?.limit ? { limit: query.limit } : {}),
      appSpace
    });
    return ok('Conversation loaded', messages);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('status')
  async updateStatus(@Req() req: { user: JwtPayload }, @Body() dto: UpdateMessageStatusDto) {
    const message = await this.messagingService.updateStatus(dto.messageId, req.user.sub, dto.status);
    return ok('Message status updated', message);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('edit')
  async editMessage(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: EditMessageDto) {
    const message = await this.messagingService.editMessage(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'message.edit',
      resourceType: 'message',
      resourceId: dto.messageId,
      outcome: 'success'
    });
    return ok('Message edited', message);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('delete')
  async deleteMessage(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: DeleteMessageDto) {
    const message = await this.messagingService.deleteMessage(req.user.sub, dto.messageId);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'message.delete',
      resourceType: 'message',
      resourceId: dto.messageId,
      outcome: 'success'
    });
    return ok('Message deleted', message);
  }

  @UseGuards(JwtAuthGuard)
  @Post('reaction')
  async reactToMessage(@Req() req: { user: JwtPayload }, @Body() dto: MessageReactionDto) {
    const reaction = await this.messagingService.addOrToggleReaction(
      req.user.sub,
      dto.messageId,
      dto.emoji
    );
    return ok('Reaction updated', reaction);
  }
}
