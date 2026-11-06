import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { RedisService } from '../redis/redis.service';
import { SecurityEventService } from '../security/security-event.service';

@Injectable()
export class AuthRateLimitService {
  constructor(
    private readonly redisService: RedisService,
    private readonly configService: AppConfigService,
    private readonly securityEvents: SecurityEventService
  ) {}

  async assertAllowed(identifier: string, ip: string): Promise<void> {
    const key = this.blockKey(identifier, ip);
    const ttl = await this.redisService.getClient().ttl(key);
    if (ttl > 0) {
      throw new HttpException(
        `Too many login attempts. Try again in ${ttl} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  async recordFailure(identifier: string, ip: string): Promise<void> {
    const failedKey = this.failedKey(identifier, ip);
    const client = this.redisService.getClient();
    const failedAttempts = await client.incr(failedKey);
    if (failedAttempts === 1) {
      await client.expire(failedKey, this.configService.authLoginWindowSeconds);
    }
    if (failedAttempts >= this.configService.authLoginMaxAttempts) {
      await client.set(
        this.blockKey(identifier, ip),
        '1',
        'EX',
        this.configService.authLoginBlockSeconds
      );
      await client.del(failedKey);
      this.securityEvents.emit({
        type: 'auth.login_lockout',
        severity: 'high',
        ip,
        outcome: 'blocked',
        metadata: {
          attempts: failedAttempts,
          windowSeconds: this.configService.authLoginWindowSeconds,
          blockSeconds: this.configService.authLoginBlockSeconds
        }
      });
    }
  }

  async clearFailures(identifier: string, ip: string): Promise<void> {
    await this.redisService
      .getClient()
      .del(this.failedKey(identifier, ip), this.blockKey(identifier, ip));
  }

  private failedKey(identifier: string, ip: string): string {
    return `auth:failed:${identifier.toLowerCase()}:${ip}`;
  }

  private blockKey(identifier: string, ip: string): string {
    return `auth:blocked:${identifier.toLowerCase()}:${ip}`;
  }
}
