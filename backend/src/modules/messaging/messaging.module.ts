import { Module, forwardRef } from '@nestjs/common';

import { JwtModule } from '@nestjs/jwt';

import { AuthModule } from '../auth/auth.module';

import { ChannelsModule } from '../channels/channels.module';

import { AppConfigService } from '../config/app-config.service';

import { GroupsModule } from '../groups/groups.module';

import { MessagingController } from './messaging.controller';
import { MessagingInboxController } from './messaging-inbox.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingPubSubService } from './messaging-pubsub.service';
import { MessagingService } from './messaging.service';
import { UnifiedInboxService } from './unified-inbox.service';
import { PresenceService } from './presence.service';
import { CallService } from './call.service';
import { CallsController } from './calls.controller';
import { SpacePinsService } from './space-pins.service';
import { SpacePinsController } from './space-pins.controller';
import { ChatMutesController } from './chat-mutes.controller';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { FocusProfileController } from './focus-profile.controller';
import { FocusProfileService } from './focus-profile.service';

@Module({
  imports: [
    AuthModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (configService: AppConfigService) => ({
        secret: configService.jwtAccessSecret
      })
    }),
    forwardRef(() => GroupsModule),
    forwardRef(() => ChannelsModule)
  ],
  controllers: [
    MessagingController,
    MessagingInboxController,
    SpacePinsController,
    ChatMutesController,
    CallsController,
    ContactsController,
    FocusProfileController
  ],
  providers: [
    MessagingService,
    UnifiedInboxService,
    MessagingGateway,
    MessagingPubSubService,
    PresenceService,
    CallService,
    SpacePinsService,
    ContactsService,
    FocusProfileService
  ],
  exports: [
    MessagingService,
    MessagingPubSubService,
    CallService,
    UnifiedInboxService,
    FocusProfileService,
    PresenceService
  ]
})
export class MessagingModule {}


