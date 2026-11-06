import { IsString, Length } from 'class-validator';

export class DeleteMessageDto {
  @IsString()
  @Length(1, 191)
  messageId!: string;
}
