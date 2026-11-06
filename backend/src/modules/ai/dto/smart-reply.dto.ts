import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min
} from 'class-validator';

export class SmartReplyDto {
  @IsString()
  @Length(1, 2000)
  latestMessage!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  recentMessages!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  maxSuggestions?: number;
}
