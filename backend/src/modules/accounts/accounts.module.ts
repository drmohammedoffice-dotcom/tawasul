import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { AccountSettingsService } from './account-settings.service';
import { AccountsController } from './accounts.controller';
import { BusinessService } from './business.service';
import { CloseFriendsService } from './close-friends.service';
import { HighlightsService } from './highlights.service';
import { MessagingProvider } from './messaging-provider';
import { PhoneAuthService } from './phone-auth.service';
import { StoreService } from './store.service';
import { VerificationService } from './verification.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [AccountsController],
  providers: [
    MessagingProvider,
    BusinessService,
    StoreService,
    VerificationService,
    HighlightsService,
    CloseFriendsService,
    AccountSettingsService,
    PhoneAuthService
  ],
  exports: [CloseFriendsService, BusinessService, MessagingProvider]
})
export class AccountsModule {}
