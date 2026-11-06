import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class SecurityRateLimitService {
  constructor(private readonly redisService: RedisService) {}

  async assertIpAllowed(ip: string): Promise<void> {
    const ttl = await this.redisService.getClient().ttl(this.blockKey(ip));
    if (ttl > 0) {
      throw new HttpException(
        `Too many requests. Try again in ${ttl} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  async consumeLimit(params: {
    ip: string;
    scope: string;
    windowSeconds: number;
    maxRequests: number;
    blockSeconds?: number;
  }): Promise<void> {
    const ip = params.ip || 'unknown';
    await this.assertIpAllowed(ip);

    const client = this.redisService.getClient();
    const key = `rate:${params.scope}:${ip}`;
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, Math.max(1, params.windowSeconds));
    }
    if (count > params.maxRequests) {
      const blockSeconds = params.blockSeconds ?? 0;
      if (blockSeconds > 0) {
        await client.set(this.blockKey(ip), '1', 'EX', blockSeconds);
      }
      throw new HttpException(
        'Too many requests. Slow down and try again.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  /** Ops helper — clear leftover rate/block keys (e.g. after deploy). Not called on every boot. */
  async clearAllLimits(): Promise<void> {
    try {
      const client = this.redisService.getClient();
      const keys = [...(await client.keys('rate:*')), ...(await client.keys('security:ip:block:*'))];
      if (keys.length) await client.del(...keys);
    } catch {
      /* ignore */
    }
  }

  private blockKey(ip: string): string {
    return `security:ip:block:${ip}`;
  }
}
