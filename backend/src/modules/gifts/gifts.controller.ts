import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { AuditLogService } from '../audit/audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { GiftHistoryQueryDto } from './dto/gift-history-query.dto';
import { SendCoinsGiftDto } from './dto/send-coins-gift.dto';
import { SendGiftDto } from './dto/send-gift.dto';
import { GiftsService } from './gifts.service';

@Controller('gifts')
@UseGuards(JwtAuthGuard)
export class GiftsController {
  constructor(
    private readonly giftsService: GiftsService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Get('catalog')
  catalog() {
    return ok('Gift catalog fetched', this.giftsService.getCatalog());
  }

  @Get('history')
  async history(@Req() req: { user: JwtPayload }, @Query() query?: GiftHistoryQueryDto) {
    const rows = await this.giftsService.listHistory(req.user.sub, query?.limit ?? 50);
    return ok('Gift history fetched', rows);
  }

  @Post('send-coins')
  async sendCoins(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: SendCoinsGiftDto) {
    const transfer = await this.giftsService.sendCoinsGift(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'gift.send.coins',
      resourceType: 'gift_transfer',
      outcome: 'success',
      metadata: { receiverId: dto.receiverId, amountCoins: dto.amountCoins }
    });
    return ok('Coins gift sent', transfer);
  }

  @Post('send')
  async sendGift(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: SendGiftDto) {
    const transfer = await this.giftsService.sendPresetGift(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'gift.send.item',
      resourceType: 'gift_transfer',
      outcome: 'success',
      metadata: {
        receiverId: dto.receiverId,
        giftKey: dto.giftKey,
        quantity: dto.quantity ?? 1
      }
    });
    return ok('Gift sent', transfer);
  }
}
