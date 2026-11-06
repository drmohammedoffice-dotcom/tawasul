import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ModerationGovernanceService } from './moderation-governance.service';
import { ModerationRbacService } from './moderation-rbac.service';
import { ModerationPolicyService } from './moderation-policy.service';
import { ModerationService } from './moderation.service';
import type { PolicyCategory } from './policy/default-policy';

class AppealDto {
  @IsString()
  @MaxLength(2000)
  statement!: string;
}

class AppealResolveDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class StaffDecideDto {
  @IsString()
  action!: 'approve' | 'flag' | 'restrict' | 'hide' | 'remove' | 'restore' | 'permanent_delete';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

class PolicyPublishDto {
  @IsString()
  @MaxLength(32)
  version!: string;

  categories!: PolicyCategory[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changelog?: string;
}

class ReportDto {
  @IsString()
  targetType!: string;

  @IsString()
  targetId!: string;

  @IsString()
  @MaxLength(80)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  details?: string;
}

class AccountStateDto {
  @IsIn(['warned', 'restricted', 'suspended', 'disabled', 'none'])
  state!: 'warned' | 'restricted' | 'suspended' | 'disabled' | 'none';

  @IsOptional()
  days?: number;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly rbac: ModerationRbacService,
    private readonly policy: ModerationPolicyService,
    private readonly governance: ModerationGovernanceService
  ) {}

  @Post('moderation/reports')
  async report(@Req() req: { user: JwtPayload }, @Body() dto: ReportDto) {
    return ok('Report filed', await this.moderation.fileReport(req.user.sub, dto));
  }

  @Get('moderation/me/content/:kind/:id')
  async myContentStatus(
    @Req() req: { user: JwtPayload },
    @Param('kind') kind: string,
    @Param('id') id: string
  ) {
    return ok('Owner moderation status', await this.moderation.ownerStatus(req.user.sub, kind, id));
  }

  @Post('moderation/cases/:caseId/appeals')
  async appeal(
    @Req() req: { user: JwtPayload },
    @Param('caseId') caseId: string,
    @Body() dto: AppealDto
  ) {
    if (!dto.statement?.trim()) throw new BadRequestException('statement_required');
    return ok('Appeal submitted', await this.moderation.createAppeal(req.user.sub, caseId, dto.statement));
  }

  @Get('moderation/admin/queues')
  async queues(@Req() req: { user: JwtPayload }, @Query('limit') limit?: string) {
    await this.rbac.assert(req.user.sub, 'case.read');
    return ok('Moderation queues', await this.moderation.adminQueues(limit ? Number(limit) : 40));
  }

  @Get('moderation/admin/cases/:id')
  async caseDetail(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    await this.rbac.assert(req.user.sub, 'case.read');
    const row = await this.moderation.getCase(id, req.user.sub);
    if (!row) throw new BadRequestException('not_found');
    return ok('Moderation case', row);
  }

  @Post('moderation/admin/cases/:id/assign')
  async assign(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() body: { reviewerId?: string }
  ) {
    await this.rbac.assert(req.user.sub, 'case.decide');
    const reviewerId = body.reviewerId || req.user.sub;
    return ok('Case assigned', await this.moderation.assignCase(req.user.sub, id, reviewerId));
  }

  @Post('moderation/admin/cases/:id/decide')
  async decide(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: StaffDecideDto
  ) {
    await this.rbac.assert(req.user.sub, 'case.decide');
    return ok('Decision recorded', await this.moderation.staffDecide(req.user.sub, id, dto));
  }

  @Post('moderation/admin/appeals/:id/resolve')
  async resolveAppeal(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: AppealResolveDto
  ) {
    await this.rbac.assert(req.user.sub, 'appeal.review');
    return ok('Appeal resolved', await this.moderation.resolveAppeal(req.user.sub, id, dto));
  }

  @Get('moderation/admin/policy')
  async policyGet(@Req() req: { user: JwtPayload }) {
    await this.rbac.assert(req.user.sub, 'case.read');
    return ok('Policy', await this.policy.listVersions());
  }

  @Put('moderation/admin/policy')
  async policyPut(@Req() req: { user: JwtPayload }, @Body() dto: PolicyPublishDto) {
    await this.rbac.assert(req.user.sub, 'policy.edit');
    if (!Array.isArray(dto.categories) || !dto.categories.length) {
      throw new BadRequestException('categories_required');
    }
    return ok(
      'Policy published',
      await this.policy.publishVersion(req.user.sub, {
        version: dto.version,
        categories: dto.categories,
        ...(dto.changelog ? { changelog: dto.changelog } : {})
      })
    );
  }

  @Post('moderation/admin/accounts/:userId/state')
  async accountState(
    @Req() req: { user: JwtPayload },
    @Param('userId') userId: string,
    @Body() dto: AccountStateDto
  ) {
    if (dto.state === 'disabled') {
      await this.rbac.assert(req.user.sub, 'account.disable');
    } else {
      await this.rbac.assert(req.user.sub, 'account.suspend');
    }
    return ok(
      'Account moderation state updated',
      await this.moderation.setAccountState(req.user.sub, userId, dto)
    );
  }

  @Get('moderation/me/account')
  async myAccount(@Req() req: { user: JwtPayload }) {
    return ok('Account transparency', await this.governance.accountTransparency(req.user.sub));
  }

  @Get('moderation/admin/quality')
  async quality(@Req() req: { user: JwtPayload }, @Query('days') days?: string) {
    await this.rbac.assert(req.user.sub, 'case.read');
    return ok('Quality dashboard', await this.governance.qualityStats(days ? Number(days) : 30));
  }

  @Get('moderation/admin/runtime')
  async runtimeGet(@Req() req: { user: JwtPayload }) {
    await this.rbac.assert(req.user.sub, 'case.read');
    return ok('Runtime config', await this.governance.runtime());
  }

  @Put('moderation/admin/shadow')
  async shadowPut(
    @Req() req: { user: JwtPayload },
    @Body() body: { enabled: boolean; shadowPolicyVersionId?: string | null }
  ) {
    await this.rbac.assert(req.user.sub, 'policy.edit');
    return ok(
      'Shadow updated',
      await this.governance.setShadow(req.user.sub, Boolean(body.enabled), body.shadowPolicyVersionId)
    );
  }

  @Get('moderation/admin/incidents')
  async incidents(@Req() req: { user: JwtPayload }) {
    await this.rbac.assert(req.user.sub, 'case.read');
    return ok('Incidents', await this.governance.listIncidents());
  }

  @Post('moderation/admin/incidents')
  async incidentOpen(
    @Req() req: { user: JwtPayload },
    @Body() body: { title: string; severity: string; caseIds?: string[]; notes?: string }
  ) {
    await this.rbac.assert(req.user.sub, 'case.decide');
    if (!body.title?.trim()) throw new BadRequestException('title_required');
    return ok(
      'Incident opened',
      await this.governance.openIncident(req.user.sub, {
        title: body.title,
        severity: body.severity || 'high',
        ...(body.caseIds ? { caseIds: body.caseIds } : {}),
        ...(body.notes ? { notes: body.notes } : {})
      })
    );
  }

  @Post('moderation/admin/incidents/:id/close')
  async incidentClose(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() body: { closeReason: string }
  ) {
    await this.rbac.assert(req.user.sub, 'case.decide');
    return ok(
      'Incident closed',
      await this.governance.closeIncident(req.user.sub, id, body.closeReason || 'closed')
    );
  }

  @Get('moderation/admin/retention')
  async retentionGet(@Req() req: { user: JwtPayload }) {
    await this.rbac.assert(req.user.sub, 'policy.edit');
    return ok('Retention policy', await this.governance.getRetention());
  }

  @Put('moderation/admin/retention')
  async retentionPut(
    @Req() req: { user: JwtPayload },
    @Body()
    body: Partial<{ caseDays: number; decisionDays: number; evidenceDays: number; shadowDays: number }>
  ) {
    await this.rbac.assert(req.user.sub, 'policy.edit');
    return ok('Retention updated', await this.governance.updateRetention(req.user.sub, body));
  }

  @Post('moderation/admin/retention/sweep')
  async retentionSweep(@Req() req: { user: JwtPayload }) {
    await this.rbac.assert(req.user.sub, 'policy.edit');
    return ok('Retention sweep', await this.governance.retentionSweep());
  }

  @Delete('moderation/admin/audit/:id')
  async auditDeleteForbidden(@Req() req: { user: JwtPayload }) {
    await this.rbac.assert(req.user.sub, 'case.read');
    this.governance.refuseAuditDelete();
  }
}
