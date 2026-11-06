import { IsObject, IsOptional, IsString, Length } from 'class-validator';

export class TrackEventDto {
  @IsString()
  @Length(1, 80)
  eventName!: string;

  @IsString()
  @Length(1, 256)
  path!: string;

  @IsString()
  @Length(8, 128)
  sessionId!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
