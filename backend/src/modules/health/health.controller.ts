import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService
  ) {}

  @Get()
  async getHealth() {
    await this.prisma.$queryRaw`SELECT 1`;
    const redisPing = await this.redis.ping();
    const mediaDriver = this.config.mediaStorageDriver;
    const r2Configured =
      mediaDriver === 'r2' &&
      Boolean(this.config.resolvedMediaBucket) &&
      Boolean(this.config.resolvedMediaAccessKeyId) &&
      Boolean(this.config.resolvedMediaSecretAccessKey) &&
      Boolean(this.config.resolvedMediaEndpoint);

    return {
      status: 'ok',
      dependencies: {
        postgres: 'up',
        redis: redisPing.toUpperCase() === 'PONG' ? 'up' : 'degraded',
        media: {
          driver: mediaDriver,
          r2Configured: mediaDriver === 'r2' ? r2Configured : null
        }
      },
      timestamp: new Date().toISOString()
    };
  }
}
