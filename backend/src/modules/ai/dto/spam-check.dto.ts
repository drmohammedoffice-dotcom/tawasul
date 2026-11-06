import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class SpamCheckDto {
  @IsString()
  @Length(1, 10000)
  text!: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  senderId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['private', 'group', 'channel', 'generic'])
  context?: 'private' | 'group' | 'channel' | 'generic';
}
