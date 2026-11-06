import { IsString, Length, Matches } from 'class-validator';

export class MessageReactionDto {
  @IsString()
  @Length(1, 191)
  messageId!: string;

  @IsString()
  @Length(1, 32)
  @Matches(/\p{Extended_Pictographic}/u, {
    message: 'reaction must be an emoji character'
  })
  emoji!: string;
}
