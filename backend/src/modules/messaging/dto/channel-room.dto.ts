import { IsOptional, IsString, Length } from 'class-validator';



export class ChannelRoomDto {

  @IsString()

  @Length(1, 191)

  channelId!: string;

}



export class ChannelMessageSendDto {

  @IsString()

  @Length(1, 191)

  channelId!: string;



  @IsString()

  @Length(1, 10000)

  encryptedContent!: string;



  @IsOptional()

  @IsString()

  @Length(1, 191)

  clientRequestId?: string;

}


