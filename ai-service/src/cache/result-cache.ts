import { createHash } from 'node:crypto';
import { aiConfig } from '../config';

type Entry = { value: unknown; expiresAt: number };

export class ResultCache {
  private readonly map = new Map<string, Entry>();

  key(parts: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  }

  get<T>(key: string): T | null {
    const row = this.map.get(key);
    if (!row) return null;
    if (Date.now() > row.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return row.value as T;
  }

  set(key: string, value: unknown, ttlSeconds = aiConfig.cacheTtlSeconds): void {
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export const resultCache = new ResultCache();
