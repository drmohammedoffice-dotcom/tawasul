import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(configService: AppConfigService) {
    this.client = new Redis(configService.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true
    });
  }

  getClient(): Redis {
    return this.client;
  }

  duplicateClient(): Redis {
    return this.client.duplicate();
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
