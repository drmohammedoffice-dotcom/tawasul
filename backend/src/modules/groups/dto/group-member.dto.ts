import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class GroupMemberDto {
  @IsString()
  @Length(1, 191)
  userId!: string;

  @IsOptional()
  @IsString()
  @IsIn(['admin', 'member'])
  role?: 'admin' | 'member';
}
