import { Global, Module } from '@nestjs/common';
import { EngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';

@Global()
@Module({
  controllers: [EngagementController],
  providers: [EngagementService],
  exports: [EngagementService]
})
export class EngagementModule {}
