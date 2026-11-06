import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string | null;

  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';
}
