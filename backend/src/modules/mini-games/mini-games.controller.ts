import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { AuditLogService } from '../audit/audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PlayMiniGameDto } from './dto/play-mini-game.dto';
import { MiniGamesService } from './mini-games.service';

@Controller('mini-games')
@UseGuards(JwtAuthGuard)
export class MiniGamesController {
  constructor(
    private readonly miniGamesService: MiniGamesService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Get('catalog')
  async catalog(@Req() req: { user: JwtPayload }) {
    const data = await this.miniGamesService.getCatalog(req.user.sub);
    return ok('Mini games catalog fetched', data);
  }

  @Get('quiz/question')
  async quizQuestion() {
    const data = await this.miniGamesService.getQuizQuestion();
    return ok('Quiz question fetched', data);
  }

  @Post('play')
  async play(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: PlayMiniGameDto) {
    const result = await this.miniGamesService.play(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'mini_games.play',
      resourceType: 'mini_game',
      outcome: 'success',
      metadata: {
        gameType: dto.gameType,
        requestId: dto.requestId,
        costCoins: result.costCoins,
        rewardCoins: result.rewardCoins,
        netCoins: result.netCoins
      }
    });
    return ok('Mini game completed', result);
  }
}
