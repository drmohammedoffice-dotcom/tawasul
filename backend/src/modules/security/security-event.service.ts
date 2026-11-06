import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type SecurityEvent = {
  type: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  actorUserId?: string;
  ip?: string;
  resourceType?: string;
  resourceId?: string;
  outcome?: 'success' | 'failure' | 'blocked';
  /** Non-sensitive context only — never passwords, tokens, or DM bodies. */
  metadata?: Record<string, string | number | boolean | null>;
};

/**
 * Structured security event sink. Keeps a correlation id per process request
 * when callers pass one; never persists secrets.
 */
@Injectable()
export class SecurityEventService {
  private readonly logger = new Logger('SecurityEvent');

  emit(event: SecurityEvent, correlationId = randomUUID()): void {
    const line = {
      ts: new Date().toISOString(),
      correlationId,
      channel: 'security',
      ...event,
      metadata: this.sanitize(event.metadata)
    };
    if (event.severity === 'critical' || event.severity === 'high') {
      this.logger.warn(JSON.stringify(line));
    } else {
      this.logger.log(JSON.stringify(line));
    }
  }

  private sanitize(
    metadata?: Record<string, string | number | boolean | null>
  ): Record<string, string | number | boolean | null> | undefined {
    if (!metadata) return undefined;
    const out: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(metadata)) {
      const key = k.toLowerCase();
      if (
        key.includes('password') ||
        key.includes('token') ||
        key.includes('secret') ||
        key.includes('authorization') ||
        key.includes('cookie') ||
        key.includes('otp') ||
        key.includes('message')
      ) {
        continue;
      }
      out[k] = v;
    }
    return out;
  }
}
