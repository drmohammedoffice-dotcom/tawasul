import { IsIn, IsString } from 'class-validator';

export class ClaimTaskRewardDto {
  @IsString()
  @IsIn(['invite_friend_1', 'send_messages_20', 'join_groups_3'])
  taskKey!: 'invite_friend_1' | 'send_messages_20' | 'join_groups_3';
}
