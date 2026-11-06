import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { MessagingModule } from '../messaging/messaging.module';
import { RedisService } from '../redis/redis.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaStorageService } from './media.storage';
import { LocalMediaStorageProvider } from './storage/local-media.storage';
import { S3CompatibleMediaStorageProvider } from './storage/s3-compatible-media.storage';
import { MEDIA_STORAGE_PROVIDER } from './storage/media-storage.types';
import { VideoStreamService } from './video-stream.service';
import { VideoStreamController } from './video-stream.controller';
import { VideoTrimService } from './video-trim.service';
import { R2ConfigValidator } from './r2-config.validator';

@Module({
  imports: [MessagingModule],
  controllers: [MediaController, VideoStreamController],
  providers: [
    MediaService,
    MediaStorageService,
    VideoStreamService,
    VideoTrimService,
    R2ConfigValidator,
    {
      provide: MEDIA_STORAGE_PROVIDER,
      inject: [AppConfigService, RedisService],
      useFactory: (config: AppConfigService, redis: RedisService) => {
        if (config.mediaStorageDriver === 'local') {
          return new LocalMediaStorageProvider(config, redis);
        }
        return new S3CompatibleMediaStorageProvider(config);
      }
    }
  ],
  exports: [MediaService, MediaStorageService, VideoStreamService, VideoTrimService]
})
export class MediaModule {}
