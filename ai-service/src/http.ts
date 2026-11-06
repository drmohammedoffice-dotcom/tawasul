import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { aiConfig } from './config';
import { assertInternalToken } from './auth/internal-token';
import { healthReport } from './monitor/health';
import { enqueueJob, getJob, listJobs, queueStats } from './queue/job-queue';
import { ModelRegistry } from './registry/model-registry';
import { analyzeText, contentHash } from './providers/lexicon-text';
import { createDataset, listDatasets, runLightweightTrain, trainingRegistry } from './training/pipeline';
import { resultCache } from './cache/result-cache';
import { getBlockedAttempts } from './offline-guard';

type Json = Record<string, unknown>;

async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(raw);
}

function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (assertInternalToken(req.headers['x-ai-token'] as string | undefined) || assertInternalToken(req.headers.authorization)) {
    return true;
  }
  send(res, 401, { ok: false, error: 'unauthorized' });
  return false;
}

export function createAiServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${aiConfig.host}:${aiConfig.port}`);
      const path = url.pathname;
      const method = req.method || 'GET';

      if (method === 'GET' && path === '/health') {
        send(res, 200, await healthReport());
        return;
      }

      if (method === 'GET' && path === '/ready') {
        send(res, 200, { ready: true, offlineAiMode: aiConfig.offlineMode });
        return;
      }

      if (!requireAuth(req, res)) return;

      if (method === 'GET' && path === '/v1/models') {
        send(res, 200, { models: new ModelRegistry().list() });
        return;
      }

      if (method === 'GET' && path === '/v1/admin/overview') {
        send(res, 200, {
          ...(await healthReport()),
          jobs: listJobs(30),
          training: trainingRegistry(),
          datasets: listDatasets()
        });
        return;
      }

      if (method === 'GET' && path.startsWith('/v1/jobs/')) {
        const id = path.slice('/v1/jobs/'.length);
        const job = getJob(id);
        if (!job) {
          send(res, 404, { ok: false, error: 'not_found' });
          return;
        }
        send(res, 200, job);
        return;
      }

      if (method === 'GET' && path === '/v1/jobs') {
        send(res, 200, { jobs: listJobs(Number(url.searchParams.get('limit') || 50)), stats: queueStats() });
        return;
      }

      if (method === 'POST' && path === '/v1/text/analyze') {
        const body = await readJson(req);
        const text = String(body.text || '');
        const hashtags = Array.isArray(body.hashtags) ? (body.hashtags as string[]) : [];
        if ('messageText' in body || 'encryptedContent' in body) {
          send(res, 400, { ok: false, error: 'private_fields_forbidden' });
          return;
        }
        const hash = contentHash(text, hashtags);
        const cacheKey = resultCache.key({ type: 'text-sync', hash });
        const cached = resultCache.get(cacheKey);
        if (cached) {
          send(res, 200, { ok: true, cached: true, hash, understanding: cached });
          return;
        }
        const understanding = analyzeText(text, hashtags);
        resultCache.set(cacheKey, understanding);
        send(res, 200, { ok: true, cached: false, hash, understanding });
        return;
      }

      if (method === 'POST' && path === '/v1/jobs') {
        const body = await readJson(req);
        const type = String(body.type || '') as 'text.analyze' | 'image.analyze' | 'video.analyze' | 'audio.transcribe' | 'embed.batch';
        const allowed = ['text.analyze', 'image.analyze', 'video.analyze', 'audio.transcribe', 'embed.batch'];
        if (!allowed.includes(type)) {
          send(res, 400, { ok: false, error: 'bad_type' });
          return;
        }
        const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>;
        if ('messageText' in payload || 'encryptedContent' in payload || 'conversationId' in payload) {
          send(res, 400, { ok: false, error: 'private_fields_forbidden' });
          return;
        }
        const job = enqueueJob({
          type,
          payload,
          ...(typeof body.priority === 'number' ? { priority: body.priority } : {}),
          ...(typeof body.idempotencyKey === 'string' ? { idempotencyKey: body.idempotencyKey } : {})
        });
        send(res, 202, { ok: true, job });
        return;
      }

      if (method === 'POST' && path === '/v1/training/datasets') {
        if (!aiConfig.enable.training) {
          send(res, 403, { ok: false, error: 'training_disabled' });
          return;
        }
        const body = await readJson(req);
        const rows = Array.isArray(body.rows) ? (body.rows as Array<Record<string, unknown>>) : [];
        const dataset = createDataset(String(body.name || 'dataset'), rows);
        send(res, 201, { ok: true, dataset });
        return;
      }

      if (method === 'POST' && path === '/v1/training/run') {
        if (!aiConfig.enable.training) {
          send(res, 403, { ok: false, error: 'training_disabled' });
          return;
        }
        const body = await readJson(req);
        const job = runLightweightTrain(String(body.datasetId || ''));
        send(res, 200, { ok: true, job });
        return;
      }

      if (method === 'POST' && path === '/v1/admin/cache/clear') {
        resultCache.clear();
        send(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && path === '/v1/offline/status') {
        send(res, 200, {
          offlineAiMode: aiConfig.offlineMode,
          blockedExternalAttempts: getBlockedAttempts()
        });
        return;
      }

      send(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      send(res, 500, { ok: false, error: err instanceof Error ? err.message : 'error' });
    }
  });
}
