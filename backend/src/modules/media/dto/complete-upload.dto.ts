import { IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class CompleteUploadDto {
  @IsString()
  @Length(1, 191)
  mediaId!: string;

  /** Must match the contentHash stored on the upload ticket. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i, { message: 'contentHash must be a 64-char SHA-256 hex digest' })
  contentHash?: string;

  /** Client-reported duration after trim (seconds). Required for reel eligibility. */
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(600)
  durationSeconds?: number;
}
