import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SummarizeChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  messages!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxSentences?: number;
}
