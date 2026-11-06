import { MiniGameType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class PlayMiniGameDto {
  @IsEnum(MiniGameType)
  gameType!: MiniGameType;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  requestId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  questionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(16)
  answerIndex?: number;
}
