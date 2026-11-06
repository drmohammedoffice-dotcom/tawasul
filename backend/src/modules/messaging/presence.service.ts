import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class PresenceService {
  constructor(private readonly redisService: RedisService) {}

  async markOnline(userId: string): Promise<void> {
    await this.redisService.getClient().set(this.key(userId), 'online', 'EX', 120);
  }

  async refreshOnline(userId: string): Promise<void> {
    await this.redisService.getClient().expire(this.key(userId), 120);
  }

  async markOffline(userId: string): Promise<void> {
    await this.redisService.getClient().del(this.key(userId));
  }

  async isOnline(userId: string): Promise<boolean> {
    const val = await this.redisService.getClient().get(this.key(userId));
    return val === 'online';
  }

  private key(userId: string): string {
    return `presence:user:${userId}`;
  }
}
