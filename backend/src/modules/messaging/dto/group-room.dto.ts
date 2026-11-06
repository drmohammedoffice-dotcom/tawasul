import { IsOptional, IsString, Length } from 'class-validator';



export class GroupRoomDto {

  @IsString()

  @Length(1, 191)

  groupId!: string;

}



export class GroupMessageSendDto {

  @IsString()

  @Length(1, 191)

  groupId!: string;



  @IsString()

  @Length(1, 10000)

  encryptedContent!: string;



  /** Optional client idempotency key to suppress duplicate sends on retry/reconnect. */

  @IsOptional()

  @IsString()

  @Length(1, 191)

  clientRequestId?: string;

}


