import { IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(1, 30)
  @Matches(/^[a-zA-Z0-9._]+$/, {
    message: 'username can only contain letters, numbers, dot, and underscore'
  })
  username!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsString()
  @Length(3, 64)
  deviceId!: string;
}
