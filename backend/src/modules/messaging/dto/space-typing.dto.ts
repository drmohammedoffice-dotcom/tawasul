import { IsBoolean, IsString, Length } from 'class-validator';

export class GroupTypingDto {
  @IsString()
  @Length(1, 191)
  groupId!: string;

  @IsBoolean()
  isTyping!: boolean;
}

export class ChannelTypingDto {
  @IsString()
  @Length(1, 191)
  channelId!: string;

  @IsBoolean()
  isTyping!: boolean;
}
