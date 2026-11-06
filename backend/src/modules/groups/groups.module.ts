import { Module, forwardRef } from '@nestjs/common';

import { MessagingModule } from '../messaging/messaging.module';

import { GroupsController } from './groups.controller';

import { GroupsService } from './groups.service';



@Module({

  imports: [forwardRef(() => MessagingModule)],

  controllers: [GroupsController],

  providers: [GroupsService],

  exports: [GroupsService]

})

export class GroupsModule {}


