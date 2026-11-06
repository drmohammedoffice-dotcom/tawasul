import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { AuditLogService } from '../audit/audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { AppConfigService } from '../config/app-config.service';
import { EarnCoinsDto } from './dto/earn-coins.dto';
import { SpendCoinsDto } from './dto/spend-coins.dto';
import { TransferCoinsDto } from './dto/transfer-coins.dto';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly configService: AppConfigService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Get('me')
  async getMine(@Req() req: { user: JwtPayload }) {
    const wallet = await this.walletService.getWallet(req.user.sub);
    return ok('Wallet fetched', wallet);
  }

  @Get('transactions')
  async transactions(
    @Req() req: { user: JwtPayload },
    @Query() query?: WalletTransactionsQueryDto
  ) {
    const rows = await this.walletService.listTransactions(req.user.sub, {
      limit: query?.limit ?? 50,
      ...(query?.currency ? { currency: query.currency } : {}),
      ...(query?.type ? { type: query.type } : {}),
      ...(query?.status ? { status: query.status } : {})
    });
    return ok('Wallet transactions fetched', rows);
  }

  @Post('spend')
  async spend(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: SpendCoinsDto) {
    const wallet = await this.walletService.spend(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'wallet.spend',
      resourceType: 'wallet',
      resourceId: wallet.id,
      outcome: 'success',
      metadata: { amount: dto.amount, reference: dto.reference }
    });
    return ok('Currency spent successfully', wallet);
  }

  @Post('transfer')
  async transfer(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: TransferCoinsDto) {
    const result = await this.walletService.transfer(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'wallet.transfer',
      resourceType: 'wallet',
      outcome: 'success',
      metadata: {
        amount: dto.amount,
        recipientUserId: dto.recipientUserId,
        reference: dto.reference,
        currency: dto.currency ?? 'coins',
        requestId: dto.requestId
      }
    });
    return ok('Currency transferred successfully', result);
  }

  @Post('internal/earn')
  async internalEarn(
    @Req() req: { user: JwtPayload; ip?: string },
    @Headers('x-wallet-token') token: string | undefined,
    @Body() dto: EarnCoinsDto
  ) {
    const expected = this.configService.walletInternalToken;
    if (!expected || token !== expected) {
      throw new ForbiddenException('invalid wallet internal token');
    }
    const wallet = await this.walletService.earnCurrency(
      dto.userId,
      dto.amount,
      dto.currency ?? 'coins',
      dto.reference,
      dto.requestId
    );
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'wallet.earn.internal',
      resourceType: 'wallet',
      resourceId: wallet.id,
      outcome: 'success',
      metadata: { amount: dto.amount, userId: dto.userId, reference: dto.reference }
    });
    return ok('Currency granted successfully', wallet);
  }
}
