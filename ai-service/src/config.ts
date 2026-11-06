import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) loadEnv({ path: envFile });
else loadEnv({ path: resolve(process.cwd(), '.env.example') });

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

function int(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export const aiConfig = {
  port: int('AI_PORT', 3100),
  host: process.env.AI_HOST || '127.0.0.1',
  internalToken: process.env.AI_INTERNAL_TOKEN || 'change-me-local-only',
  offlineMode: bool('OFFLINE_AI_MODE', true),
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  modelsDir: resolve(process.cwd(), process.env.MODELS_DIR || './models'),
  registryPath: resolve(process.cwd(), 'manifests/models.registry.json'),
  cacheTtlSeconds: int('CACHE_TTL_SECONDS', 86400),
  maxGpuJobs: int('MAX_CONCURRENT_GPU_JOBS', 1),
  maxCpuJobs: int('MAX_CONCURRENT_CPU_JOBS', 2),
  enable: {
    textLexicon: bool('ENABLE_TEXT_LEXICON', true),
    textGguf: bool('ENABLE_TEXT_GGUF', false),
    vision: bool('ENABLE_VISION', false),
    ocr: bool('ENABLE_OCR', false),
    /** Image NSFW classifier — default on for content safety quarantine. */
    nsfw: bool('ENABLE_NSFW', true),
    whisper: bool('ENABLE_WHISPER', false),
    embeddings: bool('ENABLE_EMBEDDINGS', false),
    training: bool('ENABLE_TRAINING', true)
  },
  serviceName: 'securechat-ai-service',
  serviceVersion: 'tawasul-ai-1.0.0'
};
