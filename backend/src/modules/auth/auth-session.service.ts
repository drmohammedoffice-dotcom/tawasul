import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export type SessionData = {
  sessionId: string;
  userId: string;
  deviceId: string;
  tokenId: string;
  ip: string;
  userAgent: string;
  createdAt: string;
};

@Injectable()
export class AuthSessionService {
  constructor(private readonly redisService: RedisService) {}

  async storeSession(data: SessionData, ttlSeconds: number): Promise<void> {
    try {
      const client = this.redisService.getClient();
      const ttl = Math.max(60, ttlSeconds);
      await client.set(this.sessionKey(data.sessionId), JSON.stringify(data), 'EX', ttl);
      const userKey = this.userSessionsKey(data.userId);
      await client.sadd(userKey, data.sessionId);
      await client.expire(userKey, ttl);
    } catch {
      throw new ServiceUnavailableException('session store unavailable');
    }
  }

  /**
   * Fail-closed: Redis outage / errors must NOT be treated as "no session → somehow ok".
   * Callers reject auth when this throws or returns null for a required session.
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const raw = await this.redisService.getClient().get(this.sessionKey(sessionId));
      if (!raw) return null;
      return JSON.parse(raw) as SessionData;
    } catch {
      throw new ServiceUnavailableException('session store unavailable');
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      const client = this.redisService.getClient();
      const raw = await client.get(this.sessionKey(sessionId));
      if (raw) {
        try {
          const data = JSON.parse(raw) as SessionData;
          if (data.userId) {
            await client.srem(this.userSessionsKey(data.userId), sessionId);
          }
        } catch {
          /* ignore corrupt payload */
        }
      }
      await client.del(this.sessionKey(sessionId));
    } catch {
      throw new ServiceUnavailableException('session store unavailable');
    }
  }

  async deleteAllForUser(userId: string): Promise<number> {
    try {
      const client = this.redisService.getClient();
      const userKey = this.userSessionsKey(userId);
      const sessionIds = await client.smembers(userKey);
      if (sessionIds.length) {
        await client.del(...sessionIds.map((id) => this.sessionKey(id)), userKey);
      } else {
        await client.del(userKey);
      }
      return sessionIds.length;
    } catch {
      throw new ServiceUnavailableException('session store unavailable');
    }
  }

  private sessionKey(sessionId: string): string {
    return `auth:session:${sessionId}`;
  }

  private userSessionsKey(userId: string): string {
    return `auth:user-sessions:${userId}`;
  }
}
