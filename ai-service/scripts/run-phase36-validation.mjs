/**
 * Phase 36 — backend integration validation (re-runnable evidence).
 * Does not claim success for steps that did not execute.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'models', 'fixtures');
const outDir = path.join(root, 'validation-results');
mkdirSync(outDir, { recursive: true });

const base = (process.env.AI_SERVICE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const token = process.env.AI_INTERNAL_TOKEN || process.env.AI_SERVICE_TOKEN || '';
const py = path.join(root, '.venv', 'Scripts', 'python.exe');

const report = {
  at: new Date().toISOString(),
  phase: 36,
  base,
  passed: [],
  failed: [],
  skipped: [],
  metrics: {}
};

function mark(ok, name, detail) {
  const row = { name, ...detail };
  if (ok) report.passed.push(row);
  else report.failed.push(row);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail?.note || detail?.error || '');
}

function skip(name, reason) {
  report.skipped.push({ name, reason });
  console.log(`SKIP ${name}: ${reason}`);
}

async function api(method, p, body, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-ai-token': token
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function waitJob(id, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { status, json } = await api('GET', `/v1/jobs/${id}`);
    if (status === 404) return null;
    if (json && ['done', 'failed', 'unavailable', 'dead'].includes(json.status)) return json;
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

function runPy(script, args = []) {
  if (!existsSync(py)) return { ok: false, error: 'venv_python_missing' };
  const r = spawnSync(py, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: process.env
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim()
  };
}

async function main() {
  // 1) OCR bidi unit
  {
    const r = runPy(path.join(root, 'python', 'test_ocr_bidi.py'));
    mark(r.ok, 'ocr_bidi_unit', { stdout: r.stdout.slice(0, 120), error: r.stderr || undefined });
  }

  // 2) Health
  let healthy = false;
  try {
    const h = await api('GET', '/health', undefined, 3000);
    healthy = h.status === 200;
    mark(healthy, 'ai_service_health', { status: h.status });
  } catch (err) {
    mark(false, 'ai_service_health', { error: err instanceof Error ? err.message : 'error' });
  }

  if (!healthy) {
    skip('remaining_live_tests', 'AI service not reachable on :3100');
    finish();
    return;
  }

  // 3) Privacy: private fields forbidden
  {
    const res = await api('POST', '/v1/jobs', {
      type: 'text.analyze',
      payload: { text: 'hi', messageText: 'secret' }
    });
    mark(res.status === 400 && res.json?.error === 'private_fields_forbidden', 'privacy_private_fields', {
      status: res.status,
      error: res.json?.error
    });
  }

  // 4) Text job + idempotency
  {
    const key = `phase36-text-${Date.now()}`;
    const payload = {
      type: 'text.analyze',
      payload: { text: 'سيارة كهربائية في بغداد', hashtags: ['tech'] },
      idempotencyKey: key
    };
    const a = await api('POST', '/v1/jobs', payload);
    const b = await api('POST', '/v1/jobs', payload);
    const same = a.json?.job?.id && a.json.job.id === b.json?.job?.id;
    const done = a.json?.job?.id ? await waitJob(a.json.job.id, 90_000) : null;
    mark(Boolean(same && done && done.status === 'done'), 'text_job_idempotent', {
      sameId: same,
      status: done?.status,
      topics: done?.result?.understanding?.topics?.slice?.(0, 3)
    });
    report.metrics.textJobMs = done ? done.updatedAt - done.createdAt : null;
  }

  // 5) OCR Arabic + English fixtures
  const ocrCases = [
    {
      name: 'ocr_ar_clear',
      file: 'ocr-ar-clear.png',
      expectAny: ['بغداد', 'سيارة', 'كهرباء', 'تكنولوجيا', 'العراق']
    },
    {
      name: 'ocr_en_clear',
      file: 'ocr-en-clear.png',
      expectAny: ['BAGHDAD', 'ELECTRIC', 'CAR']
    },
    {
      name: 'ocr_mixed',
      file: 'ocr-mixed.png',
      expectAny: ['Baghdad', 'بغداد']
    },
    {
      name: 'ocr_ad',
      file: 'ocr-ad.png',
      expectAny: ['SALE', 'TODAY']
    }
  ];

  for (const c of ocrCases) {
    const abs = path.join(fixtures, c.file);
    if (!existsSync(abs)) {
      skip(c.name, `fixture missing: ${c.file}`);
      continue;
    }
    const started = Date.now();
    const created = await api('POST', '/v1/jobs', {
      type: 'image.analyze',
      payload: { path: abs },
      idempotencyKey: `phase36-ocr-${c.name}-${createHash('sha1').update(abs).digest('hex').slice(0, 8)}`
    });
    const job = created.json?.job?.id ? await waitJob(created.json.job.id, 180_000) : null;
    const data = job?.result?.ocr?.data || {};
    const logical = String(data.textLogical || data.text || '');
    const raw = String(data.textRaw || '');
    const hits = c.expectAny.filter((w) => logical.toLowerCase().includes(w.toLowerCase()));
    const reversedStill = /دادغب|ةرايس/.test(logical);
    const ok = job?.status === 'done' && hits.length > 0 && !reversedStill;
    mark(ok, c.name, {
      ms: Date.now() - started,
      hits,
      logical: logical.slice(0, 120),
      raw: raw.slice(0, 80),
      reversedStill,
      confidence: data.lines?.[0]?.confidence
    });
  }

  // 6) Whisper EN
  {
    const abs = path.join(fixtures, 'speech-en.wav');
    if (!existsSync(abs)) skip('whisper_en', 'fixture missing');
    else {
      const started = Date.now();
      const created = await api('POST', '/v1/jobs', {
        type: 'audio.transcribe',
        payload: { path: abs },
        idempotencyKey: 'phase36-whisper-en'
      });
      const job = created.json?.job?.id ? await waitJob(created.json.job.id, 120_000) : null;
      const text = String(job?.result?.data?.text || '');
      mark(
        job?.status === 'done' && /baghdad|electric|car/i.test(text),
        'whisper_en',
        { ms: Date.now() - started, text: text.slice(0, 160), privacy: job?.result?.privacy }
      );
    }
  }

  // 7) Embeddings dim + batch
  {
    const started = Date.now();
    const created = await api('POST', '/v1/jobs', {
      type: 'embed.batch',
      payload: {
        texts: [
          'سيارة كهربائية في بغداد',
          'electric car in Baghdad',
          'وصفة كباب عراقي'
        ]
      },
      idempotencyKey: `phase36-embed-${Date.now()}`
    });
    const job = created.json?.job?.id ? await waitJob(created.json.job.id, 180_000) : null;
    const dim = job?.result?.data?.dim;
    const vectors = job?.result?.data?.vectors || [];
    const ok = job?.status === 'done' && dim === 1024 && vectors.length === 3;
    mark(ok, 'embed_bge_m3', {
      ms: Date.now() - started,
      dim,
      count: vectors.length
    });
    report.metrics.embedMs = Date.now() - started;
  }

  // 8) No cloud hosts in offline guard overview
  {
    const overview = await api('GET', '/v1/admin/overview');
    const offline = overview.json?.offline ?? overview.json?.offlineMode ?? null;
    mark(overview.status === 200, 'admin_overview', {
      status: overview.status,
      offline,
      note: 'Nest must keep OFFLINE_AI_MODE=true; no Gemini/OpenAI keys required'
    });
  }

  finish();
}

function finish() {
  report.summary = {
    passed: report.passed.length,
    failed: report.failed.length,
    skipped: report.skipped.length
  };
  const dest = path.join(outDir, 'phase36-latest.json');
  writeFileSync(dest, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nSummary', report.summary);
  console.log('Wrote', dest);
  if (report.failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  report.failed.push({ name: 'runner', error: String(err) });
  finish();
});
