import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { BillingPlan } from '@prisma/client';

export class ActivateSubscriptionDto {
  @IsEnum(BillingPlan)
  plan!: BillingPlan;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  providerSubscriptionId?: string;
}
