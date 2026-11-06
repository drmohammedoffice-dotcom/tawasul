import { IsBoolean, IsString, Length } from 'class-validator';

export class TypingIndicatorDto {
  @IsString()
  @Length(1, 191)
  receiverId!: string;

  @IsBoolean()
  isTyping!: boolean;
}
