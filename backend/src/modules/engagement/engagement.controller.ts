import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { AuditLogService } from '../audit/audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ClaimTaskRewardDto } from './dto/claim-task-reward.dto';
import { CompleteInviteTaskDto } from './dto/complete-invite-task.dto';
import { EngagementService } from './engagement.service';

@Controller('engagement')
@UseGuards(JwtAuthGuard)
export class EngagementController {
  constructor(
    private readonly engagementService: EngagementService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Get('daily-reward/status')
  async dailyRewardStatus(@Req() req: { user: JwtPayload }) {
    const status = await this.engagementService.getDailyRewardStatus(req.user.sub);
    return ok('Daily reward status fetched', status);
  }

  @Post('daily-reward/claim')
  async claimDailyReward(@Req() req: { user: JwtPayload; ip?: string }) {
    const result = await this.engagementService.claimDailyReward(req.user.sub);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'engagement.daily-reward.claim',
      resourceType: 'daily_reward',
      outcome: 'success',
      metadata: { rewardCoins: result.rewardCoins, streak: result.streak }
    });
    return ok('Daily reward claimed', result);
  }

  @Get('tasks')
  async tasks(@Req() req: { user: JwtPayload }) {
    const tasks = await this.engagementService.listTaskProgress(req.user.sub);
    return ok('Task rewards progress fetched', tasks);
  }

  @Post('tasks/invite-friend/complete')
  async completeInvite(
    @Req() req: { user: JwtPayload; ip?: string },
    @Body() dto: CompleteInviteTaskDto
  ) {
    const result = await this.engagementService.completeInviteTask(req.user.sub, dto.invitedUserId);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'engagement.task.invite_friend.complete',
      resourceType: 'task_reward',
      outcome: 'success',
      metadata: { invitedUserId: dto.invitedUserId, rewardCoins: result.rewardCoins }
    });
    return ok('Invite task progress updated', result);
  }

  @Post('tasks/claim')
  async claimTaskReward(
    @Req() req: { user: JwtPayload; ip?: string },
    @Body() dto: ClaimTaskRewardDto
  ) {
    const result = await this.engagementService.claimTaskReward(req.user.sub, dto.taskKey);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'engagement.task.reward.claim',
      resourceType: 'task_reward',
      outcome: 'success',
      metadata: { taskKey: dto.taskKey, rewardCoins: result.rewardCoins }
    });
    return ok('Task reward claimed', result);
  }
}
