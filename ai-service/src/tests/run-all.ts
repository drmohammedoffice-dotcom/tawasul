import assert from 'node:assert/strict';
import { analyzeText, contentHash } from '../providers/lexicon-text';
import { isBlockedUrl, installOfflineGuard, getBlockedAttempts } from '../offline-guard';
import { enqueueJob, getJob, queueStats, startQueue, stopQueue } from '../queue/job-queue';
import { ModelRegistry } from '../registry/model-registry';
import { createDataset, runLightweightTrain } from '../training/pipeline';
import { createAiServer } from '../http';
import { aiConfig } from '../config';

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // 1. Arabic + Iraqi + English lexicon
  const ar = analyzeText('شلونك، اكو سيارة كهربائية بتكنولوجيا حديثة بهسة');
  assert.equal(ar.language, 'ar');
  assert.ok(ar.topics.some((t) => t.key === 'electric_cars' || t.key === 'cars'));
  assert.ok(ar.topics.some((t) => t.key === 'technology' || t.key === 'iraq_local'));
  const en = analyzeText('football match and sports news');
  assert.ok(en.topics.some((t) => t.key === 'football'));
  const promo = analyzeText('اشتري الآن خصم كبير وتوصيل مجاني');
  assert.equal(promo.postType, 'promotional');
  assert.equal(contentHash('a', ['x']), contentHash('a', ['x']));

  // 2. Offline guard blocks external AI hosts
  installOfflineGuard();
  assert.equal(isBlockedUrl('https://generativelanguage.googleapis.com/v1/models'), true);
  assert.equal(isBlockedUrl('https://api.openai.com/v1/chat/completions'), true);
  assert.equal(isBlockedUrl('http://127.0.0.1:3100/health'), false);
  const before = getBlockedAttempts();
  let blocked = false;
  try {
    await fetch('https://api.openai.com/v1/models');
  } catch {
    blocked = true;
  }
  assert.equal(blocked, true);
  assert.ok(getBlockedAttempts() >= before + 1);

  // 3. Model registry: lexicon always ready; GGUF ready only when enabled + installed
  const models = new ModelRegistry().list();
  const lexicon = models.find((m) => m.id === 'lexicon-1.0.0');
  assert.ok(lexicon?.ready);
  const gguf = models.find((m) => m.id === 'qwen3-4b-q4_k_m');
  assert.ok(gguf);
  if (gguf.enabled && gguf.installed) {
    assert.equal(gguf.ready, true);
    assert.equal(gguf.reason, 'ready');
  } else {
    assert.equal(gguf.ready, false);
    assert.ok(gguf.reason === 'disabled_until_approval' || gguf.reason === 'model_missing');
  }
  const easyocr = models.find((m) => m.id === 'easyocr-ar-en');
  assert.ok(easyocr);
  const vision = models.find((m) => m.id === 'qwen3-vl-4b');
  assert.ok(vision);
  // Empty vision placeholder must not fake readiness after install markers.
  if (!vision.installed) assert.equal(vision.ready, false);

  // 4. Queue + idempotency + text job
  startQueue();
  const job = enqueueJob({
    type: 'text.analyze',
    payload: { text: 'سفر إلى بغداد', hashtags: [] },
    idempotencyKey: 'test-text-1'
  });
  const again = enqueueJob({
    type: 'text.analyze',
    payload: { text: 'سفر إلى بغداد', hashtags: [] },
    idempotencyKey: 'test-text-1'
  });
  assert.equal(job.id, again.id);
  for (let i = 0; i < 40; i += 1) {
    const current = getJob(job.id);
    if (current && (current.status === 'done' || current.status === 'unavailable' || current.status === 'dead')) break;
    await sleep(50);
  }
  const done = getJob(job.id);
  assert.ok(done);
  assert.equal(done.status, 'done');
  const understanding = (done.result as { understanding?: { topics?: Array<{ key: string }> } })?.understanding;
  assert.ok(understanding?.topics?.some((t) => t.key === 'travel' || t.key === 'iraq_local'));

  // 5. Privacy: training rejects private fields
  let privacyBlocked = false;
  try {
    createDataset('bad', [{ messageText: 'secret' }]);
  } catch {
    privacyBlocked = true;
  }
  assert.equal(privacyBlocked, true);

  // 6. Lightweight train on synthetic public features (not claimed as LLM)
  const ds = createDataset('toy', [
    { label: 1, features: [1, 0.2, 0] },
    { label: 0, features: [0, 0.1, 1] },
    { label: 1, features: [0.9, 0.3, 0.1] }
  ]);
  const train = runLightweightTrain(ds.id);
  assert.equal(train.status, 'done');
  assert.ok(train.modelVersion?.startsWith('linear-'));
  assert.ok(train.metrics);

  // 7. HTTP API with internal token
  const server = createAiServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const port = addr.port;
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
  assert.equal(health.service, 'securechat-ai-service');
  assert.equal(health.offlineAiMode, true);
  const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/text/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hi' })
  });
  assert.equal(unauthorized.status, 401);
  const analyzed = await fetch(`http://127.0.0.1:${port}/v1/text/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ai-token': aiConfig.internalToken },
    body: JSON.stringify({ text: 'طبخ عراقي كباب' })
  }).then((r) => r.json());
  assert.equal(analyzed.ok, true);
  assert.ok(analyzed.understanding.topics.some((t: { key: string }) => t.key === 'food'));
  const privateReject = await fetch(`http://127.0.0.1:${port}/v1/text/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ai-token': aiConfig.internalToken },
    body: JSON.stringify({ text: 'x', encryptedContent: 'nope' })
  });
  assert.equal(privateReject.status, 400);

  await new Promise<void>((resolve) => server.close(() => resolve()));
  stopQueue();

  console.log(
    JSON.stringify({
      ok: true,
      queue: queueStats(),
      offlineBlocked: getBlockedAttempts(),
      lexiconTopics: ar.topics.map((t) => t.key)
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
