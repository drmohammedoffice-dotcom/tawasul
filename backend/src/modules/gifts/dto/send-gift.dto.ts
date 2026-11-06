import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class SendGiftDto {
  @IsString()
  @Length(1, 191)
  receiverId!: string;

  @IsString()
  @Length(1, 64)
  giftKey!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
