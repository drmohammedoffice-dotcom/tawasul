import { Module, forwardRef } from '@nestjs/common';

import { MessagingModule } from '../messaging/messaging.module';

import { ChannelsController } from './channels.controller';

import { ChannelsService } from './channels.service';



@Module({

  imports: [forwardRef(() => MessagingModule)],

  controllers: [ChannelsController],

  providers: [ChannelsService],

  exports: [ChannelsService]

})

export class ChannelsModule {}


