import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './modules/config/env.validation';
import { AppConfigModule } from './modules/config/app-config.module';
import { HealthModule } from './modules/health/health.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { MediaModule } from './modules/media/media.module';
import { GroupsModule } from './modules/groups/groups.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { AiModule } from './modules/ai/ai.module';
import { CacheModule } from './modules/cache/cache.module';
import { SecurityModule } from './modules/security/security.module';
import { AuditModule } from './modules/audit/audit.module';
import { MonetizationModule } from './modules/monetization/monetization.module';
import { BetaModule } from './modules/beta/beta.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { GiftsModule } from './modules/gifts/gifts.module';
import { MiniGamesModule } from './modules/mini-games/mini-games.module';
import { SocialModule } from './modules/social/social.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { PushModule } from './modules/push/push.module';
import { ModerationModule } from './modules/moderation/moderation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '.env.local'],
      validate: validateEnv
    }),
    AppConfigModule,
    CacheModule,
    SecurityModule,
    AuditModule,
    MonetizationModule,
    BetaModule,
    PrismaModule,
    PushModule,
    RedisModule,
    HealthModule,
    UsersModule,
    AuthModule,
    AiModule,
    MessagingModule,
    MediaModule,
    GroupsModule,
    ChannelsModule,
    WalletModule,
    EngagementModule,
    GiftsModule,
    MiniGamesModule,
    SocialModule,
    AccountsModule,
    ModerationModule
  ]
})
export class AppModule {}
