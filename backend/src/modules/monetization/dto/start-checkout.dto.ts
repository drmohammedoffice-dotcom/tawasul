import { IsEnum } from 'class-validator';
import { BillingPlan } from '@prisma/client';

export class StartCheckoutDto {
  @IsEnum(BillingPlan)
  plan!: BillingPlan;
}
