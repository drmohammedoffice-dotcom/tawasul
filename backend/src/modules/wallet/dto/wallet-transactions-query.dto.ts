import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { WalletCurrency, WalletTransactionStatus, WalletTransactionType } from '@prisma/client';

export class WalletTransactionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(WalletCurrency)
  currency?: WalletCurrency;

  @IsOptional()
  @IsEnum(WalletTransactionType)
  type?: WalletTransactionType;

  @IsOptional()
  @IsEnum(WalletTransactionStatus)
  status?: WalletTransactionStatus;
}
