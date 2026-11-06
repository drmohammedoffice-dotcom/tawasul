import { IsString, Length } from 'class-validator';

export class EditMessageDto {
  @IsString()
  @Length(1, 191)
  messageId!: string;

  @IsString()
  @Length(1, 10000)
  encryptedContent!: string;
}
