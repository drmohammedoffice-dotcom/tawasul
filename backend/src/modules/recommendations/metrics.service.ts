import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RecommendationMetricsService {
  private readonly memory = new Map<string, number>();
  private redisFallbackLogged = false;

  constructor(private readonly redis: RedisService) {}

  async bump(field: string, by = 1) {
    const key = field.slice(0, 80);
    this.memory.set(key, (this.memory.get(key) ?? 0) + by);
    try {
      await this.redis.getClient().hincrby('rec:metrics', key, by);
    } catch (err) {
      if (!this.redisFallbackLogged) {
        this.redisFallbackLogged = true;
        console.warn(
          `recommendation metrics are using an in-process counter because Redis failed (${err instanceof Error ? err.message : 'error'}). That counter is not shared across API processes.`
        );
      }
    }
  }

  async timing(surface: string, ms: number) {
    await this.bump(`serve:${surface}:count`, 1);
    await this.bump(`serve:${surface}:ms`, Math.max(0, Math.round(ms)));
  }

  async snapshot(): Promise<Record<string, number>> {
    try {
      const raw = await this.redis.getClient().hgetall('rec:metrics');
      const out: Record<string, number> = {};
      for (const [key, value] of Object.entries(raw)) out[key] = Number(value) || 0;
      if (Object.keys(out).length) return out;
    } catch {
      /* use memory */
    }
    return Object.fromEntries(this.memory.entries());
  }
}
