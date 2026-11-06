import { IsString, Length } from 'class-validator';

export class AttachMediaDto {
  @IsString()
  @Length(1, 191)
  messageId!: string;

  @IsString()
  @Length(1, 191)
  mediaId!: string;
}
