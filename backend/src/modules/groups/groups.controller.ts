import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../audit/audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateGroupDto } from './dto/create-group.dto';
import { GroupMemberDto } from './dto/group-member.dto';
import { GroupMessageDto } from './dto/group-message.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GroupsService } from './groups.service';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Get()
  async listMine(@Req() req: { user: JwtPayload }) {
    return ok('Groups', await this.groupsService.listMyGroups(req.user.sub));
  }

  @Post()
  async createGroup(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: CreateGroupDto) {
    const group = await this.groupsService.createGroup(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'group.create',
      resourceType: 'group',
      resourceId: group.id,
      outcome: 'success'
    });
    return ok('Group created', group);
  }

  @Get(':groupId')
  async getOne(@Req() req: { user: JwtPayload }, @Param('groupId') groupId: string) {
    return ok('Group', await this.groupsService.getGroupForMember(req.user.sub, groupId));
  }

  @Patch(':groupId')
  async update(
    @Req() req: { user: JwtPayload },
    @Param('groupId') groupId: string,
    @Body() dto: UpdateGroupDto
  ) {
    return ok('Group updated', await this.groupsService.updateGroup(req.user.sub, groupId, dto));
  }

  @Get(':groupId/invite')
  async invite(@Req() req: { user: JwtPayload }, @Param('groupId') groupId: string) {
    return ok('Group invite', await this.groupsService.ensureInviteSlug(req.user.sub, groupId));
  }

  @Post(':groupId/leave')
  async leave(@Req() req: { user: JwtPayload }, @Param('groupId') groupId: string) {
    return ok('Left group', await this.groupsService.leaveSelf(req.user.sub, groupId));
  }

  @Delete(':groupId')
  async remove(@Req() req: { user: JwtPayload }, @Param('groupId') groupId: string) {
    return ok('Group deleted', await this.groupsService.deleteGroup(req.user.sub, groupId));
  }

  @Get(':groupId/members')
  async listMembers(@Req() req: { user: JwtPayload }, @Param('groupId') groupId: string) {
    return ok('Members', await this.groupsService.listMembers(req.user.sub, groupId));
  }

  @Post(':groupId/members')
  async addMember(
    @Req() req: { user: JwtPayload },
    @Param('groupId') groupId: string,
    @Body() dto: GroupMemberDto
  ) {
    const member = await this.groupsService.addMember(
      req.user.sub,
      groupId,
      dto.userId,
      dto.role ?? 'member'
    );
    return ok('Member added to group', member);
  }

  @Delete(':groupId/members/:userId')
  async removeMember(
    @Req() req: { user: JwtPayload },
    @Param('groupId') groupId: string,
    @Param('userId') userId: string
  ) {
    const removed = await this.groupsService.removeMember(req.user.sub, groupId, userId);
    return ok('Member removed from group', removed);
  }

  @Post(':groupId/messages')
  async sendGroupMessage(
    @Req() req: { user: JwtPayload },
    @Param('groupId') groupId: string,
    @Body() dto: GroupMessageDto
  ) {
    const message = await this.groupsService.sendGroupMessage(
      req.user.sub,
      groupId,
      dto.encryptedContent
    );
    return ok('Group message sent', message);
  }

  @Get(':groupId/messages')
  async listGroupMessages(
    @Req() req: { user: JwtPayload },
    @Param('groupId') groupId: string,
    @Query() query?: PaginationQueryDto
  ) {
    const messages = await this.groupsService.listGroupMessages(req.user.sub, groupId, {
      ...(query?.before ? { before: query.before } : {}),
      ...(query?.limit ? { limit: query.limit } : {})
    });
    return ok('Group messages fetched', messages);
  }

  @Post(':groupId/read')
  async markRead(@Req() req: { user: JwtPayload }, @Param('groupId') groupId: string) {
    return ok('Group marked read', await this.groupsService.markRead(req.user.sub, groupId));
  }
}
