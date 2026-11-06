import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsIn(['browse', 'focus'])
  appSpace?: 'browse' | 'focus';

  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  memberIds?: string[];
}
