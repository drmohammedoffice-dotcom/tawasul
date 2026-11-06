import { IsString, Length } from 'class-validator';

export class CompleteInviteTaskDto {
  @IsString()
  @Length(1, 191)
  invitedUserId!: string;
}
