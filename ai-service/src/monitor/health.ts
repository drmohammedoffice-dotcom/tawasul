import { aiConfig } from '../config';
import { getBlockedAttempts, assertNoExternalAiPlan } from '../offline-guard';
import { ModelRegistry } from '../registry/model-registry';
import { resultCache } from '../cache/result-cache';
import { queueStats } from '../queue/job-queue';
import { readResources } from './resources';

const startedAt = Date.now();

export async function healthReport() {
  const registry = new ModelRegistry();
  const resources = await readResources();
  return {
    service: aiConfig.serviceName,
    version: aiConfig.serviceVersion,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    offlineAiMode: aiConfig.offlineMode,
    offlinePolicy: assertNoExternalAiPlan(),
    blockedExternalAttempts: getBlockedAttempts(),
    models: registry.list(),
    queue: queueStats(),
    cacheEntries: resultCache.size(),
    resources,
    recommendationBaseline: 'baseline-1.0.0',
    note: 'Heavy models remain disabled until owner approves download and enable flags.'
  };
}
