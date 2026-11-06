import { IsString, Length } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  @Length(20, 2048)
  mfaToken!: string;

  @IsString()
  @Length(6, 64)
  code!: string;

  @IsString()
  @Length(3, 64)
  deviceId!: string;
}
