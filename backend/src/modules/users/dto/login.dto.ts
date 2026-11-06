import { IsOptional, IsString, Length } from 'class-validator';

export class LoginDto {
  @IsString()
  identifier!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsString()
  @Length(3, 64)
  deviceId!: string;

  /** TOTP or recovery code when MFA is enabled. */
  @IsOptional()
  @IsString()
  @Length(6, 64)
  totpCode?: string;
}
