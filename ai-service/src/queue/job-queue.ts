import { createHash, randomUUID } from 'node:crypto';
import { aiConfig } from '../config';
import { analyzeText, contentHash } from '../providers/lexicon-text';
import {
  runEmbedding,
  runGgufText,
  runNsfw,
  runOcr,
  runVision,
  runWhisper
} from '../providers/heavy-providers';
import { resultCache } from '../cache/result-cache';
import { readResources } from '../monitor/resources';

export type JobType = 'text.analyze' | 'image.analyze' | 'video.analyze' | 'audio.transcribe' | 'embed.batch';

export type AiJob = {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  priority: number;
  status: 'queued' | 'running' | 'done' | 'failed' | 'dead' | 'unavailable';
  attempts: number;
  maxAttempts: number;
  dedupeKey: string;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
  runAfter: number;
};

const jobs = new Map<string, AiJob>();
const order: string[] = [];
let gpuBusy = 0;
let cpuBusy = 0;
let timer: NodeJS.Timeout | null = null;

const metrics = {
  enqueued: 0,
  done: 0,
  failed: 0,
  unavailable: 0,
  deduped: 0
};

export function queueStats() {
  const byStatus: Record<string, number> = {};
  for (const job of jobs.values()) byStatus[job.status] = (byStatus[job.status] || 0) + 1;
  return { ...metrics, byStatus, size: jobs.size, gpuBusy, cpuBusy };
}

export function listJobs(limit = 50): AiJob[] {
  return [...jobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.min(200, Math.max(1, limit)));
}

export function getJob(id: string): AiJob | null {
  return jobs.get(id) ?? null;
}

export function enqueueJob(input: {
  type: JobType;
  payload: Record<string, unknown>;
  priority?: number;
  idempotencyKey?: string;
}): AiJob {
  const dedupeKey =
    input.idempotencyKey ||
    createHash('sha256').update(JSON.stringify({ type: input.type, payload: input.payload })).digest('hex');
  for (const existing of jobs.values()) {
    if (existing.dedupeKey === dedupeKey && (existing.status === 'queued' || existing.status === 'running' || existing.status === 'done')) {
      metrics.deduped += 1;
      return existing;
    }
  }
  const job: AiJob = {
    id: randomUUID(),
    type: input.type,
    payload: input.payload,
    priority: input.priority ?? 5,
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    dedupeKey,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    runAfter: Date.now()
  };
  jobs.set(job.id, job);
  order.push(job.id);
  metrics.enqueued += 1;
  kick();
  return job;
}

export function startQueue(): void {
  if (timer) return;
  timer = setInterval(() => void pump(), 250);
  timer.unref?.();
}

export function stopQueue(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function kick(): void {
  void pump();
}

async function pump(): Promise<void> {
  const now = Date.now();
  const queued = [...jobs.values()]
    .filter((job) => job.status === 'queued' && job.runAfter <= now)
    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  for (const job of queued) {
    const needsGpu = job.type === 'image.analyze' || job.type === 'video.analyze' || job.type === 'audio.transcribe';
    if (needsGpu && gpuBusy >= aiConfig.maxGpuJobs) continue;
    if (!needsGpu && cpuBusy >= aiConfig.maxCpuJobs) continue;
    if (needsGpu) {
      const resources = await readResources();
      if (resources.gpu && resources.gpu.memoryFreeMiB < 1500) {
        job.runAfter = Date.now() + 2000;
        job.updatedAt = Date.now();
        continue;
      }
    }
    job.status = 'running';
    job.attempts += 1;
    job.updatedAt = Date.now();
    if (needsGpu) gpuBusy += 1;
    else cpuBusy += 1;
    try {
      job.result = await execute(job);
      job.status = typeof job.result === 'object' && job.result && 'status' in (job.result as object) && (job.result as { status?: string }).status === 'unavailable'
        ? 'unavailable'
        : 'done';
      if (job.status === 'unavailable') metrics.unavailable += 1;
      else metrics.done += 1;
    } catch (err) {
      job.error = err instanceof Error ? err.message.slice(0, 300) : 'error';
      if (job.attempts < job.maxAttempts) {
        job.status = 'queued';
        job.runAfter = Date.now() + job.attempts * 1000;
      } else {
        job.status = 'dead';
        metrics.failed += 1;
      }
    } finally {
      job.updatedAt = Date.now();
      if (needsGpu) gpuBusy = Math.max(0, gpuBusy - 1);
      else cpuBusy = Math.max(0, cpuBusy - 1);
    }
  }
}

async function execute(job: AiJob): Promise<unknown> {
  if (job.type === 'text.analyze') {
    const text = String(job.payload.text || '');
    const hashtags = Array.isArray(job.payload.hashtags) ? (job.payload.hashtags as string[]) : [];
    const hash = contentHash(text, hashtags);
    const cacheKey = resultCache.key({ type: 'text', hash });
    const cached = resultCache.get(cacheKey);
    if (cached) return { cached: true, hash, understanding: cached };
    const understanding = analyzeText(text, hashtags);
    resultCache.set(cacheKey, understanding);
    // Optional GGUF enrichment — never required, never sends data outside.
    if (aiConfig.enable.textGguf) {
      const heavy = await runGgufText(text.slice(0, 500));
      return { cached: false, hash, understanding, enrichment: heavy };
    }
    return { cached: false, hash, understanding };
  }
  if (job.type === 'image.analyze') {
    const path = String(job.payload.path || '');
    // NSFW is mandatory for safety; OCR/vision caption remain optional enrichment.
    const [nsfw, vision, ocr] = await Promise.all([runNsfw(path), runVision(path), runOcr(path)]);
    return {
      nsfw,
      vision,
      ocr,
      status: nsfw.ok || vision.ok || ocr.ok ? 'done' : 'unavailable'
    };
  }
  if (job.type === 'video.analyze') {
    const path = String(job.payload.path || '');
    const [vision, whisper] = await Promise.all([runVision(path), runWhisper(path)]);
    return {
      note: 'Video uses sampled media paths. Frames should be extracted with FFmpeg before vision jobs.',
      vision,
      whisper,
      status: vision.ok || whisper.ok ? 'done' : 'unavailable'
    };
  }
  if (job.type === 'audio.transcribe') {
    const result = await runWhisper(String(job.payload.path || ''));
    return { ...result, privacy: 'private_audio_not_used_for_recommendations' };
  }
  if (job.type === 'embed.batch') {
    const texts = Array.isArray(job.payload.texts) ? (job.payload.texts as string[]) : [];
    return runEmbedding(texts);
  }
  throw new Error('unknown_job_type');
}
