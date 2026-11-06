import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { RecommendationConfigService } from './config.service';
import { TawasulAiClient } from '../ai/tawasul-ai.client';
import { RecommendationFeatureService } from './feature.service';
import { EVENT_TYPES } from './engine/types';
import { RecommendationEventsService } from './events.service';
import { InterestProfileService } from './interest-profile.service';
import { RecommendationMetricsService } from './metrics.service';
import { RecommendationPlannerService } from './planner.service';

class EventDto {
  @IsString()
  @Length(8, 80)
  eventId!: string;

  @IsString()
  @IsIn(EVENT_TYPES as unknown as string[])
  eventType!: string;

  @IsOptional()
  @IsIn(['post', 'reel', 'story', 'user', 'hashtag'])
  contentType?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  contentId?: string;

  @IsOptional()
  @IsIn(['feed', 'reels', 'stories', 'explore', 'search', 'profile', 'people'])
  surface?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(600_000)
  dwellMs?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  progress?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  query?: string;

  @IsOptional()
  @IsString()
  occurredAt?: string;
}

class EventBatchDto {
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => EventDto)
  events!: EventDto[];
}

class PreferenceDto {
  @IsIn(['personalized', 'following_chronological'])
  feedMode!: 'personalized' | 'following_chronological';

  @IsOptional()
  @IsBoolean()
  personalizationEnabled?: boolean;
}

class RollbackDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  version?: string;
}

class FeatureDto {
  @IsString()
  key!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  value?: number;
}

class MuteDto {
  @IsIn(['author', 'hashtag'])
  targetType!: 'author' | 'hashtag';

  @IsString()
  @Length(1, 64)
  targetId!: string;
}

class PublishDto {
  @IsObject()
  weights!: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

@Controller('recommendations')
@UseGuards(JwtAuthGuard)
export class RecommendationsController {
  constructor(
    private readonly events: RecommendationEventsService,
    private readonly interests: InterestProfileService,
    private readonly planner: RecommendationPlannerService,
    private readonly config: RecommendationConfigService,
    private readonly metrics: RecommendationMetricsService,
    private readonly features: RecommendationFeatureService,
    private readonly tawasulAi: TawasulAiClient,
    private readonly prisma: PrismaService
  ) {}

  @Post('events')
  async eventsIn(@Req() req: { user: JwtPayload }, @Body() dto: EventBatchDto) {
    const { weights } = await this.config.active();
    const incoming = dto.events.map((event) => ({
      eventId: event.eventId,
      eventType: event.eventType,
      ...(event.contentType ? { contentType: event.contentType } : {}),
      ...(event.contentId ? { contentId: event.contentId } : {}),
      ...(event.surface ? { surface: event.surface } : {}),
      ...(event.dwellMs !== undefined ? { dwellMs: event.dwellMs } : {}),
      ...(event.progress !== undefined ? { progress: event.progress } : {}),
      ...(event.query ? { query: event.query } : {}),
      ...(event.occurredAt ? { occurredAt: event.occurredAt } : {})
    }));
    const result = await this.events.ingest(req.user.sub, incoming, weights);
    await this.planner.invalidate(req.user.sub);
    return ok('Recommendation events', result);
  }

  @Get('preferences')
  async preferences(@Req() req: { user: JwtPayload }) {
    const pref = await this.interests.preference(req.user.sub);
    return ok('Recommendation preferences', {
      feedMode: pref.feedMode,
      personalizationEnabled: pref.personalizationEnabled
    });
  }

  @Put('preferences')
  async savePreferences(@Req() req: { user: JwtPayload }, @Body() dto: PreferenceDto) {
    const saved = await this.interests.savePreference(req.user.sub, {
      feedMode: dto.feedMode,
      ...(dto.personalizationEnabled === undefined ? {} : { personalizationEnabled: dto.personalizationEnabled })
    });
    await this.planner.invalidate(req.user.sub);
    return ok('Recommendation preferences saved', {
      feedMode: saved.feedMode,
      personalizationEnabled: saved.personalizationEnabled
    });
  }

  @Get('interests')
  async interestsView(@Req() req: { user: JwtPayload }) {
    const { weights } = await this.config.active();
    return ok('Inferred interests', await this.interests.inferredTopics(req.user.sub, weights.interestHalfLifeDays));
  }

  @Delete('interests/:key')
  async forgetInterest(@Req() req: { user: JwtPayload }, @Param('key') key: string) {
    await this.interests.forgetInferred(req.user.sub, key);
    await this.planner.invalidate(req.user.sub);
    return ok('Inferred interest removed', { removed: true });
  }

  @Post('reset')
  async reset(@Req() req: { user: JwtPayload }) {
    await this.interests.reset(req.user.sub);
    await this.planner.invalidate(req.user.sub);
    return ok('Recommendation history cleared', { cleared: true });
  }

  @Post('mute')
  async mute(@Req() req: { user: JwtPayload }, @Body() dto: MuteDto) {
    await this.prisma.recommendationMute.upsert({
      where: {
        userId_targetType_targetId: {
          userId: req.user.sub,
          targetType: dto.targetType,
          targetId: dto.targetId
        }
      },
      create: {
        userId: req.user.sub,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: 'mute'
      },
      update: { reason: 'mute' }
    });
    await this.planner.invalidate(req.user.sub);
    return ok('Muted', { muted: true });
  }

  @Get('people')
  async people(@Req() req: { user: JwtPayload }) {
    const rows = await this.planner.planPeople(req.user.sub);
    return ok('Suggested accounts', rows);
  }

  @Get('trending')
  async trending() {
    return ok('Trending topics', await this.planner.planTrending());
  }

  @Get('explain/:kind/:id')
  async explain(
    @Req() req: { user: JwtPayload },
    @Param('kind') kind: string,
    @Param('id') id: string
  ) {
    if (kind !== 'post' && kind !== 'reel' && kind !== 'story') {
      throw new BadRequestException('invalid kind');
    }
    return ok('Recommendation', await this.explainFor(req.user.sub, kind, id));
  }

  @Get('admin/overview')
  async overview(@Req() req: { user: JwtPayload }) {
    await this.assertAdmin(req.user.sub);
    const active = await this.config.active();
    const history = await this.config.history();
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const stats = await this.prisma.recommendationDailyStat.findMany({
      where: { day },
      select: { eventType: true, outcome: true, reason: true, count: true }
    });
    const metrics = await this.metrics.snapshot();
    const latencies = ['feed', 'reels', 'explore', 'hashtag'].map((surface) => {
      const count = metrics[`serve:${surface}:count`] ?? 0;
      const ms = metrics[`serve:${surface}:ms`] ?? 0;
      return { surface, requests: count, avgMs: count ? Math.round(ms / count) : 0 };
    });
    return ok('Recommendation admin', {
      version: active.version,
      trainedModel: false,
      baseline: this.config.document(),
      weights: active.weights,
      history,
      today: stats,
      serve: latencies,
      distribution: {
        feedItems: metrics['feed:items'] ?? 0,
        feedAuthors: metrics['feed:authors'] ?? 0,
        exploreItems: metrics['explore:items'] ?? 0,
        reelsItems: metrics['reels:items'] ?? 0,
        kinds: Object.fromEntries(Object.entries(metrics).filter(([key]) => key.includes(':kind:')))
      },
      exclusions: Object.fromEntries(Object.entries(metrics).filter(([key]) => key.startsWith('exclude:'))),
      retentionDays: active.weights.eventRetentionDays,
      ml: {
        trained: false,
        registry: 'baseline-only',
        note: 'RankingModel can replace the baseline later. No model has been trained.'
      },
      features: await this.features.all(),
      analysis: await this.analysisSummary(),
      participantsToday: await this.participantCount(day),
      conversationSignals: false,
      tawasulAi: (await this.tawasulAi.adminOverview()) || {
        connected: false,
        note: 'AI_SERVICE_URL not set or service offline. App continues on baseline-1.0.0 and local lexicon.'
      }
    });
  }

  @Put('admin/features')
  async saveFeature(@Req() req: { user: JwtPayload }, @Body() dto: FeatureDto) {
    await this.assertAdmin(req.user.sub);
    const saved = await this.features.set(dto.key, dto.enabled, dto.value ?? 0);
    if (!saved.ok) throw new BadRequestException(saved.reason);
    await this.prisma.recommendationConfigAudit.create({
      data: { version: dto.key.slice(0, 64), actorId: req.user.sub, action: dto.enabled ? 'feature_on' : 'feature_off' }
    });
    return ok('Feature updated', saved);
  }

  @Post('admin/rollback')
  async rollback(@Req() req: { user: JwtPayload }, @Body() dto: RollbackDto) {
    await this.assertAdmin(req.user.sub);
    const version = dto.version || 'baseline-1.0.0';
    const okRollback = await this.config.activate(req.user.sub, version);
    if (!okRollback) throw new BadRequestException('unknown version');
    return ok('Ranking version restored', { version });
  }

  @Put('admin/config')
  async publish(@Req() req: { user: JwtPayload }, @Body() dto: PublishDto) {
    await this.assertAdmin(req.user.sub);
    const saved = await this.config.publish(req.user.sub, {
      weights: dto.weights,
      ...(dto.note ? { note: dto.note } : {})
    });
    if (!saved.version) {
      throw new BadRequestException(`invalid weights: ${saved.rejectedKeys.join(', ')}`);
    }
    return ok('Ranking config published', saved);
  }

  @Get('admin/content/:kind/:id')
  async inspect(@Req() req: { user: JwtPayload }, @Param('kind') kind: string, @Param('id') id: string) {
    await this.assertAdmin(req.user.sub);
    const reasons: string[] = [];
    let reportCount = 0;
    if (kind === 'post') {
      const post = await this.prisma.post.findUnique({
        where: { id },
        include: {
          author: { select: { isPrivate: true, isAutomatedTest: true } },
          media: { select: { media: { select: { sizeBytes: true, mimeType: true } } } }
        }
      });
      if (!post || post.deletedAt || post.archivedAt) reasons.push('excluded_deleted');
      if (post?.author.isPrivate) reasons.push('private_author');
      if (post?.author.isAutomatedTest) reasons.push('automated_fixture');
      if (!post?.media.length) reasons.push('excluded_media');
      reportCount = await this.prisma.report.count({ where: { targetType: 'post', targetId: id } });
    } else if (kind === 'reel') {
      const reel = await this.prisma.reel.findUnique({
        where: { id },
        include: { author: { select: { isPrivate: true, isAutomatedTest: true } }, media: true }
      });
      if (!reel || reel.deletedAt || reel.archivedAt) reasons.push('excluded_deleted');
      if (reel?.author.isPrivate) reasons.push('private_author');
      if (!reel?.media) reasons.push('excluded_media');
      reportCount = await this.prisma.report.count({ where: { targetType: 'reel', targetId: id } });
    } else {
      throw new BadRequestException('invalid kind');
    }
    if (reportCount > 0) reasons.push('has_reports');
    return ok('Content eligibility', {
      kind,
      id,
      eligibleForDiscovery: reasons.length === 0,
      reasons,
      reportCount
    });
  }

  private async explainFor(userId: string, kind: 'post' | 'reel' | 'story', id: string) {
    if (kind === 'story') {
      const story = await this.prisma.story.findFirst({
        where: { id, deletedAt: null, expiresAt: { gt: new Date() } }
      });
      if (!story) return { eligible: false };
      const seen = await this.prisma.storyView.findFirst({
        where: { storyId: id, viewerId: userId },
        select: { id: true }
      });
      const ordered = await this.planner.orderStories(userId, [
        {
          id: story.id,
          authorId: story.authorId,
          createdAt: story.createdAt,
          audience: story.audience,
          seen: Boolean(seen),
          hasMedia: true
        }
      ]);
      if (!ordered.includes(id)) return { eligible: false };
      return { eligible: true, reason: 'following', source: 'following' };
    }
    const found = await this.planner.findRanked(userId, id);
    if (!found || (kind === 'reel' && found.kind !== 'reel') || (kind === 'post' && found.kind !== 'post')) {
      return { eligible: false };
    }
    return { eligible: true, reason: found.reason, source: found.source };
  }

  private async analysisSummary() {
    try {
      const [rows, jobs] = await Promise.all([
        this.prisma.contentUnderstanding.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.contentAnalysisJob.groupBy({ by: ['status'], _count: { _all: true } })
      ]);
      return {
        understanding: rows.map((row) => ({ status: row.status, count: row._count._all })),
        jobs: jobs.map((row) => ({ status: row.status, count: row._count._all }))
      };
    } catch {
      return { understanding: [], jobs: [] };
    }
  }

  private async participantCount(day: Date): Promise<number> {
    const rows = await this.prisma.recommendationEvent.findMany({
      where: { createdAt: { gte: day } },
      distinct: ['userId'],
      select: { userId: true }
    });
    return rows.length;
  }

  private async assertAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'admin') throw new ForbiddenException('admin only');
  }
}
