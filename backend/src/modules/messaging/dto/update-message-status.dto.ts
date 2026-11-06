import { IsIn, IsString, Length } from 'class-validator';

export class UpdateMessageStatusDto {
  @IsString()
  @Length(1, 191)
  messageId!: string;

  @IsString()
  @IsIn(['delivered', 'read'])
  status!: 'delivered' | 'read';
}
