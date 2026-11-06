import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { TrackEventDto } from './dto/track-event.dto';
import { BetaService } from './beta.service';

@Controller('beta')
export class BetaController {
  constructor(private readonly betaService: BetaService) {}

  @Post('analytics')
  async trackAnalytics(
    @Body() dto: TrackEventDto,
    @Headers('user-agent') userAgent?: string
  ) {
    await this.betaService.trackEvent({
      data: dto,
      ...(userAgent ? { userAgent } : {})
    });
    return ok('Event tracked', { accepted: true });
  }

  @UseGuards(JwtAuthGuard)
  @Post('feedback')
  async feedbackAuthed(@Req() req: { user: JwtPayload }, @Body() dto: CreateFeedbackDto) {
    const feedback = await this.betaService.createFeedback({
      userId: req.user.sub,
      data: dto
    });
    return ok('Feedback submitted', feedback);
  }

  @Post('feedback/public')
  async feedbackPublic(@Body() dto: CreateFeedbackDto) {
    const feedback = await this.betaService.createFeedback({
      data: dto
    });
    return ok('Feedback submitted', feedback);
  }
}
