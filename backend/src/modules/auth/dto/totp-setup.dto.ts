import { IsString, Length } from 'class-validator';

export class TotpBeginDto {
  @IsString()
  @Length(8, 128)
  password!: string;
}

export class TotpConfirmDto {
  @IsString()
  @Length(6, 12)
  code!: string;
}

export class TotpDisableDto {
  @IsString()
  @Length(8, 128)
  password!: string;

  @IsString()
  @Length(6, 64)
  code!: string;
}
