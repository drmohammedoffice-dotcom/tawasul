import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class SendPrivateMessageDto {
  @IsString()
  @Length(1, 191)
  receiverId!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 10000)
  encryptedContent!: string;

  /** Isolates Focus vs Browse inboxes. Default browse. */
  @IsOptional()
  @IsIn(['browse', 'focus'])
  appSpace?: 'browse' | 'focus';

  @IsOptional()
  @IsString()
  @Length(1, 191)
  replyToMessageId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  forwardFromMessageId?: string;

  /** Optional media attachments (image / audio voice note / sticker). Max 4. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(191, { each: true })
  mediaIds?: string[];

  /** Client idempotency key — accepted and ignored by the server. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientRequestId?: string;
}
