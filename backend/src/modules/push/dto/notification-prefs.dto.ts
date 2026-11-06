import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPrefsDto {
  @IsOptional()
  @IsBoolean()
  privateChats?: boolean;

  @IsOptional()
  @IsBoolean()
  groups?: boolean;

  @IsOptional()
  @IsBoolean()
  channels?: boolean;

  @IsOptional()
  @IsBoolean()
  stories?: boolean;

  @IsOptional()
  @IsBoolean()
  reactions?: boolean;

  @IsOptional()
  @IsBoolean()
  newContacts?: boolean;

  @IsOptional()
  @IsBoolean()
  social?: boolean;

  @IsOptional()
  @IsBoolean()
  calls?: boolean;

  @IsOptional()
  @IsBoolean()
  inAppPreview?: boolean;

  @IsOptional()
  @IsBoolean()
  namesOnLockScreen?: boolean;
}
