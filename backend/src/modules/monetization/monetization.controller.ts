import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { AuditLogService } from '../audit/audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { PurchaseSubscriptionWithCoinsDto } from './dto/purchase-subscription-with-coins.dto';
import { StartCheckoutDto } from './dto/start-checkout.dto';
import { MonetizationService } from './monetization.service';

@Controller('monetization')
@UseGuards(JwtAuthGuard)
export class MonetizationController {
  constructor(
    private readonly monetizationService: MonetizationService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Get('subscription')
  async getSubscription(@Req() req: { user: JwtPayload }) {
    const subscription = await this.monetizationService.getCurrentSubscription(req.user.sub);
    return ok('Subscription fetched', subscription);
  }

  @Get('pricing/coins')
  getCoinPricing() {
    return ok('Coin subscription pricing fetched', this.monetizationService.getCoinPricing());
  }

  @Post('checkout/mock')
  async startMockCheckout(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: StartCheckoutDto) {
    const checkout = await this.monetizationService.startMockCheckout(req.user.sub, dto.plan);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'billing.checkout.mock',
      resourceType: 'subscription',
      outcome: 'success',
      metadata: { plan: dto.plan }
    });
    return ok('Mock checkout session created', checkout);
  }

  @Post('subscription/mock/activate')
  async activateMockSubscription(
    @Req() req: { user: JwtPayload; ip?: string },
    @Body() dto: ActivateSubscriptionDto
  ) {
    const subscription = await this.monetizationService.activateMockSubscription(
      req.user.sub,
      dto.plan,
      dto.providerSubscriptionId
    );
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'billing.subscription.activate.mock',
      resourceType: 'subscription',
      resourceId: subscription.id,
      outcome: 'success',
      metadata: { plan: dto.plan, provider: 'mock' }
    });
    return ok('Mock premium subscription activated', subscription);
  }

  @Post('subscription/cancel')
  async cancelSubscription(@Req() req: { user: JwtPayload; ip?: string }) {
    const canceled = await this.monetizationService.cancelCurrentSubscription(req.user.sub);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'billing.subscription.cancel',
      resourceType: 'subscription',
      resourceId: canceled.id,
      outcome: 'success'
    });
    return ok('Subscription canceled', canceled);
  }

  @Post('subscription/coins/purchase')
  async purchaseWithCoins(
    @Req() req: { user: JwtPayload; ip?: string },
    @Body() dto: PurchaseSubscriptionWithCoinsDto
  ) {
    const result = await this.monetizationService.purchaseWithCoins(req.user.sub, dto.plan);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'billing.subscription.purchase.coins',
      resourceType: 'subscription',
      resourceId: result.subscription.id,
      outcome: 'success',
      metadata: {
        plan: dto.plan,
        chargedCoins: result.chargedCoins,
        balanceAfter: result.balanceAfter
      }
    });
    return ok('Subscription purchased with coins', result);
  }
}
