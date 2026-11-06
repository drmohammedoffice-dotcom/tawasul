import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ContentAnalysisService } from './analysis.service';
import { CandidateService } from './candidate.service';
import { RecommendationFeatureService } from './feature.service';
import { RecommendationConfigService } from './config.service';
import { RecommendationEventsService } from './events.service';
import { InterestProfileService } from './interest-profile.service';
import { RecommendationMaintenance } from './maintenance.service';
import { RecommendationMetricsService } from './metrics.service';
import { RecommendationPlannerService } from './planner.service';
import { RecommendationsController } from './recommendations.controller';
import { SemanticSearchService } from './semantic-search.service';

@Module({
  imports: [MediaModule],
  controllers: [RecommendationsController],
  providers: [
    InterestProfileService,
    RecommendationFeatureService,
    ContentAnalysisService,
    SemanticSearchService,
    RecommendationEventsService,
    RecommendationConfigService,
    CandidateService,
    RecommendationPlannerService,
    RecommendationMetricsService,
    RecommendationMaintenance
  ],
  exports: [
    RecommendationEventsService,
    RecommendationPlannerService,
    InterestProfileService,
    RecommendationConfigService,
    RecommendationFeatureService,
    ContentAnalysisService,
    SemanticSearchService
  ]
})
export class RecommendationsModule {}
