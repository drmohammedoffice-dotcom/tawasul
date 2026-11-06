import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class CreateUploadDto {
  @IsString()
  @Length(1, 255)
  fileName!: string;

  @IsString()
  @Length(1, 128)
  mimeType!: string;

  @IsString()
  @IsIn(['image', 'video', 'audio', 'file'])
  mediaType!: 'image' | 'video' | 'audio' | 'file';

  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  sizeBytes!: number;

  /** SHA-256 hex of file bytes — enables instant deduplicated uploads. */
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i, { message: 'contentHash must be a 64-char SHA-256 hex digest' })
  contentHash!: string;

  /** Optional client-side wrapped key; public social media may send a sentinel. */
  @IsOptional()
  @IsString()
  @Length(1, 4096)
  encryptedFileKey?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    'general',
    'chat',
    'voice',
    'post',
    'story',
    'reel',
    'avatar',
    'cover',
    'verification',
    'highlight',
    'sticker'
  ])
  purpose?:
    | 'general'
    | 'chat'
    | 'voice'
    | 'post'
    | 'story'
    | 'reel'
    | 'avatar'
    | 'cover'
    | 'verification'
    | 'highlight'
    | 'sticker';

  @IsOptional()
  @IsString()
  @IsIn(['private', 'public'])
  visibility?: 'private' | 'public';
}
