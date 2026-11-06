import { IsString, Length } from 'class-validator';

export class ChannelMessageDto {
  @IsString()
  @Length(1, 10000)
  encryptedContent!: string;
}
