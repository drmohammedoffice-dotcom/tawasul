import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ContentAnalysisService } from './analysis.service';
import { RecommendationConfigService } from './config.service';
import { RecommendationEventsService } from './events.service';

@Injectable()
export class RecommendationMaintenance implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecommendationMaintenance.name);
  private timer: NodeJS.Timeout | null = null;
  private analysisTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly events: RecommendationEventsService,
    private readonly config: RecommendationConfigService,
    private readonly analysis: ContentAnalysisService
  ) {}

  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 6 * 60 * 60 * 1000);
    this.timer.unref?.();
    this.analysisTimer = setInterval(() => {
      void this.analysis.processBatch(8).catch((err) => {
        this.logger.warn(`analysis retry skipped: ${err instanceof Error ? err.message : 'error'}`);
      });
    }, 15_000);
    this.analysisTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.analysisTimer) clearInterval(this.analysisTimer);
  }

  private async tick() {
    try {
      await this.config.ensureBaseline();
      const { weights } = await this.config.active();
      const removed = await this.events.prune(weights.eventRetentionDays, 500);
      if (removed) this.logger.log(`pruned ${removed} recommendation events`);
    } catch (err) {
      this.logger.warn(`maintenance skipped: ${err instanceof Error ? err.message : 'error'}`);
    }
  }
}
