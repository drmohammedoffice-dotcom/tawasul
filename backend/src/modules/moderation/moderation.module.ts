import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ContentAccessGate } from './content-access.gate';
import { FingerprintService } from './fingerprint.service';
import { ModerationController } from './moderation.controller';
import { ModerationGovernanceService } from './moderation-governance.service';
import { ModerationMaintenance } from './moderation-maintenance.service';
import { ModerationPolicyService } from './moderation-policy.service';
import { ModerationRbacService } from './moderation-rbac.service';
import { ModerationService } from './moderation.service';
import { RiskScoreService } from './risk-score.service';

@Module({
  imports: [MediaModule],
  controllers: [ModerationController],
  providers: [
    ModerationService,
    ModerationPolicyService,
    ModerationRbacService,
    ModerationMaintenance,
    ContentAccessGate,
    FingerprintService,
    RiskScoreService,
    ModerationGovernanceService
  ],
  exports: [
    ModerationService,
    ModerationPolicyService,
    ModerationRbacService,
    ContentAccessGate,
    FingerprintService,
    RiskScoreService,
    ModerationGovernanceService
  ]
})
export class ModerationModule {}
