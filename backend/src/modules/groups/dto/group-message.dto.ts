import { IsString, Length } from 'class-validator';

export class GroupMessageDto {
  @IsString()
  @Length(1, 10000)
  encryptedContent!: string;
}
