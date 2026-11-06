import { IsOptional, IsString, Length } from 'class-validator';

export class TranslateMessageDto {
  @IsString()
  @Length(1, 10000)
  text!: string;

  @IsString()
  @Length(2, 12)
  targetLanguage!: string;

  @IsOptional()
  @IsString()
  @Length(2, 12)
  sourceLanguage?: string;
}
