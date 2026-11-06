import { IsOptional, IsString, Length } from 'class-validator';

export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @Length(8, 2048)
  refreshToken?: string;
}
