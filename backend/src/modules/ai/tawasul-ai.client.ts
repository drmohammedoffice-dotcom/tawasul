import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type RemoteTextUnderstanding = {
  ok: boolean;
  hash?: string;
  understanding?: {
    language: string;
    topics: Array<{ key: string; confidence: number; parent: string | null }>;
    keywords: string[];
    hashtags?: string[];
    postType?: string;
    quality: string;
    modelVersion: string;
    provider: string;
    summary?: string | null;
  };
  error?: string;
};

export type AiJobType =
  | 'text.analyze'
  | 'image.analyze'
  | 'video.analyze'
  | 'audio.transcribe'
  | 'embed.batch';

export type AiJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'dead' | 'unavailable';

export type AiJob = {
  id: string;
  type: AiJobType | string;
  payload: Record<string, unknown>;
  priority: number;
  status: AiJobStatus | string;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
  runAfter: number;
};

export type CreateJobInput = {
  type: AiJobType;
  payload: Record<string, unknown>;
  priority?: number;
  idempotencyKey?: string;
};

const TERMINAL = new Set(['done', 'failed', 'unavailable', 'dead']);

@Injectable()
export class TawasulAiClient {
  private readonly logger = new Logger(TawasulAiClient.name);

  constructor(private readonly config: ConfigService) {}

  enabled(): boolean {
    return Boolean(this.config.get<string>('AI_SERVICE_URL'));
  }

  /** Sync lexicon path — fast fallback / admin. */
  async analyzeText(text: string, hashtags: string[]): Promise<RemoteTextUnderstanding | null> {
    return this.postJson<RemoteTextUnderstanding>('/v1/text/analyze', { text, hashtags }, 2_500);
  }

  async createJob(input: CreateJobInput): Promise<AiJob | null> {
    const body = {
      type: input.type,
      payload: input.payload,
      priority: input.priority ?? 5,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
    };
    const res = await this.postJson<{ ok: boolean; job?: AiJob; error?: string }>(
      '/v1/jobs',
      body,
      5_000
    );
    if (!res?.ok || !res.job) return null;
    return res.job;
  }

  async getJob(id: string): Promise<AiJob | null> {
    return this.getJson<AiJob>(`/v1/jobs/${encodeURIComponent(id)}`, 3_000);
  }

  /**
   * Poll until terminal status or timeout. Returns null if AI unreachable.
   * Does not throw — callers decide fallbacks so publish/feed stay up.
   */
  async waitJob(
    id: string,
    opts?: { timeoutMs?: number; intervalMs?: number }
  ): Promise<AiJob | null> {
    const timeoutMs = opts?.timeoutMs ?? 90_000;
    const intervalMs = opts?.intervalMs ?? 750;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const job = await this.getJob(id);
      if (!job) return null;
      if (TERMINAL.has(String(job.status))) return job;
      await sleep(intervalMs);
    }
    this.logger.warn(`AI job poll timeout id=${id.slice(0, 8)}`);
    return this.getJob(id);
  }

  async enqueueAndWait(
    input: CreateJobInput,
    opts?: { timeoutMs?: number; intervalMs?: number }
  ): Promise<AiJob | null> {
    const created = await this.createJob(input);
    if (!created) return null;
    if (TERMINAL.has(String(created.status))) return created;
    return this.waitJob(created.id, opts);
  }

  async adminOverview(): Promise<Record<string, unknown> | null> {
    return this.getJson<Record<string, unknown>>('/v1/admin/overview', 3_000);
  }

  private baseUrl(): string | null {
    const base = this.config.get<string>('AI_SERVICE_URL');
    if (!base) return null;
    const offline = String(this.config.get('OFFLINE_AI_MODE') ?? 'true').toLowerCase();
    if (offline === 'true' || offline === '1') {
      try {
        const host = new URL(base).hostname;
        if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
          this.logger.warn('OFFLINE_AI_MODE refuses non-local AI_SERVICE_URL');
          return null;
        }
      } catch {
        return null;
      }
    }
    return base.replace(/\/$/, '');
  }

  private token(): string {
    return this.config.get<string>('AI_SERVICE_TOKEN') || '';
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    timeoutMs: number
  ): Promise<T | null> {
    const base = this.baseUrl();
    if (!base) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ai-token': this.token()
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) {
        this.logger.warn(`AI POST ${path} status=${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`AI service unreachable: ${err instanceof Error ? err.message : 'error'}`);
      return null;
    }
  }

  private async getJson<T>(path: string, timeoutMs: number): Promise<T | null> {
    const base = this.baseUrl();
    if (!base) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${base}${path}`, {
        headers: { 'x-ai-token': this.token() },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const json = (await res.json()) as T | { ok?: boolean; job?: T };
      if (json && typeof json === 'object' && 'job' in json && (json as { job?: T }).job) {
        return (json as { job: T }).job;
      }
      return json as T;
    } catch (err) {
      this.logger.warn(`AI GET ${path} failed: ${err instanceof Error ? err.message : 'error'}`);
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
