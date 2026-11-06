import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ModerationModule } from '../moderation/moderation.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { ReelsController } from './reels.controller';
import { ReelsService } from './reels.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ContentControlsController } from './content-controls.controller';
import { ContentControlsService } from './content-controls.service';

@Module({
  imports: [MediaModule, RecommendationsModule, ModerationModule],
  controllers: [
    PostsController,
    ProfilesController,
    StoriesController,
    ReelsController,
    NotificationsController,
    SearchController,
    ContentControlsController
  ],
  providers: [
    PostsService,
    ProfilesService,
    StoriesService,
    ReelsService,
    NotificationsService,
    SearchService,
    ContentControlsService
  ],
  exports: [PostsService, ProfilesService, NotificationsService]
})
export class SocialModule {}
