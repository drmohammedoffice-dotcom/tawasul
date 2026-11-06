import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { IsEnum } from 'class-validator';
import { WalletCurrency } from '@prisma/client';

export class SpendCoinsDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  reference?: string;

  @IsOptional()
  @IsEnum(WalletCurrency)
  currency?: WalletCurrency;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  requestId?: string;
}
