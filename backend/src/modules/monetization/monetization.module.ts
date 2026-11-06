import { Global, Module } from '@nestjs/common';
import { MonetizationController } from './monetization.controller';
import { FeatureGateService } from './feature-gate.service';
import { MonetizationService } from './monetization.service';

@Global()
@Module({
  controllers: [MonetizationController],
  providers: [MonetizationService, FeatureGateService],
  exports: [MonetizationService, FeatureGateService]
})
export class MonetizationModule {}
