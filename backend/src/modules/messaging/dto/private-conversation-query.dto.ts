import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Query for GET /messages/private/:peerUserId — must whitelist `space` under forbidNonWhitelisted. */
export class PrivateConversationQueryDto {
  @IsOptional()
  @IsDateString()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(['browse', 'focus'])
  space?: 'browse' | 'focus';
}
