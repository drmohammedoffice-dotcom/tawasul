import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CacheService {
  constructor(private readonly redisService: RedisService) {}

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redisService.getClient().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redisService.getClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async delByPrefix(prefix: string): Promise<void> {
    const client = this.redisService.getClient();
    const keys = new Set<string>();
    let cursor = '0';
    do {
      const result = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = result[0];
      for (const key of result[1]) {
        keys.add(key);
      }
    } while (cursor !== '0');

    if (keys.size > 0) {
      await client.del(...Array.from(keys));
    }
  }
}
