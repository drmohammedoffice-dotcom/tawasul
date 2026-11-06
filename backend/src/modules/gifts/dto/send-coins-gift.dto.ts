import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class SendCoinsGiftDto {
  @IsString()
  @Length(1, 191)
  receiverId!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amountCoins!: number;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
