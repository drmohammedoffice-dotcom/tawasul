import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModerationGovernanceService } from './moderation-governance.service';
import { ModerationPolicyService } from './moderation-policy.service';
import { ModerationService } from './moderation.service';

@Injectable()
export class ModerationMaintenance implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModerationMaintenance.name);
  private timer: NodeJS.Timeout | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly moderation: ModerationService,
    private readonly policy: ModerationPolicyService,
    private readonly governance: ModerationGovernanceService
  ) {}

  onModuleInit() {
    void this.policy.ensureSeeded().catch((err) => {
      this.logger.warn(`policy seed skipped: ${err instanceof Error ? err.message : 'error'}`);
    });
    void this.governance.ensureRuntime().catch((err) => {
      this.logger.warn(`runtime seed skipped: ${err instanceof Error ? err.message : 'error'}`);
    });
    this.timer = setInterval(() => {
      void this.moderation.processBatch(3).catch((err) => {
        this.logger.warn(`moderation retry skipped: ${err instanceof Error ? err.message : 'error'}`);
      });
    }, 12_000);
    this.timer.unref?.();
    this.retentionTimer = setInterval(
      () => {
        void this.governance.retentionSweep().catch((err) => {
          this.logger.warn(`retention sweep skipped: ${err instanceof Error ? err.message : 'error'}`);
        });
      },
      24 * 60 * 60 * 1000
    );
    this.retentionTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.retentionTimer) clearInterval(this.retentionTimer);
  }
}
