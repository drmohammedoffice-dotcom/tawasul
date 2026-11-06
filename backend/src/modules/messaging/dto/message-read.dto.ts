import { IsString, Length } from 'class-validator';

export class MessageReadDto {
  @IsString()
  @Length(1, 191)
  messageId!: string;
}
