import { Global, Module } from '@nestjs/common';
import { FcmService } from './fcm.service';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Global()
@Module({
  controllers: [PushController],
  providers: [FcmService, PushService],
  exports: [PushService]
})
export class PushModule {}
