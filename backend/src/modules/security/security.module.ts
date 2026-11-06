import { Global, Module } from '@nestjs/common';
import { SecurityEventService } from './security-event.service';
import { SecurityRateLimitService } from './security-rate-limit.service';

@Global()
@Module({
  providers: [SecurityRateLimitService, SecurityEventService],
  exports: [SecurityRateLimitService, SecurityEventService]
})
export class SecurityModule {}
