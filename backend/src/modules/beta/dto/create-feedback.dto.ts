import { IsEmail, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateFeedbackDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @Length(2, 50)
  category!: string;

  @IsString()
  @Length(10, 2000)
  message!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
