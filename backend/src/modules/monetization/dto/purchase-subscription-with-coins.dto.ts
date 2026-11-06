import { IsEnum } from 'class-validator';
import { BillingPlan } from '@prisma/client';

export class PurchaseSubscriptionWithCoinsDto {
  @IsEnum(BillingPlan)
  plan!: BillingPlan;
}
