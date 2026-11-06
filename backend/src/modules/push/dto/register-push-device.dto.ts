import { IsIn, IsString, Length } from 'class-validator';

export class RegisterPushDeviceDto {
  @IsString()
  @Length(20, 4096)
  token!: string;

  @IsIn(['android', 'ios', 'web'])
  platform!: 'android' | 'ios' | 'web';
}

export class RemovePushDeviceDto {
  @IsString()
  @Length(20, 4096)
  token!: string;
}
