import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { aiConfig } from '../config';

export type DatasetMeta = {
  id: string;
  name: string;
  createdAt: string;
  rows: number;
  source: 'public_content_only';
  excludesPrivateMessages: true;
  path: string;
};

export type TrainJob = {
  id: string;
  datasetId: string;
  status: 'queued' | 'done' | 'failed';
  createdAt: string;
  metrics: Record<string, number> | null;
  modelVersion: string | null;
  note: string;
};

const root = () => join(aiConfig.modelsDir, '..', 'training-data');
const datasetsDir = () => join(root(), 'datasets');
const jobsDir = () => join(root(), 'jobs');
const registryFile = () => join(root(), 'model-registry.json');

function ensureDirs(): void {
  mkdirSync(datasetsDir(), { recursive: true });
  mkdirSync(jobsDir(), { recursive: true });
  if (!existsSync(registryFile())) {
    writeFileSync(registryFile(), JSON.stringify({ versions: [], baseline: 'baseline-1.0.0' }, null, 2));
  }
}

export function createDataset(name: string, rows: Array<Record<string, unknown>>): DatasetMeta {
  ensureDirs();
  for (const row of rows) {
    if ('messageText' in row || 'encryptedContent' in row || 'conversationId' in row) {
      throw new Error('private_or_sensitive_fields_forbidden');
    }
  }
  const id = randomUUID();
  const path = join(datasetsDir(), `${id}.jsonl`);
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  writeFileSync(path, body);
  const meta: DatasetMeta = {
    id,
    name: name.slice(0, 80),
    createdAt: new Date().toISOString(),
    rows: rows.length,
    source: 'public_content_only',
    excludesPrivateMessages: true,
    path
  };
  writeFileSync(join(datasetsDir(), `${id}.meta.json`), JSON.stringify(meta, null, 2));
  return meta;
}

export function listDatasets(): DatasetMeta[] {
  ensureDirs();
  return readdirSync(datasetsDir())
    .filter((name) => name.endsWith('.meta.json'))
    .map((name) => JSON.parse(readFileSync(join(datasetsDir(), name), 'utf8')) as DatasetMeta);
}

/**
 * Lightweight offline evaluation of a logistic interest score — not a trained LLM.
 * Produces a versioned artifact so rollback and shadow comparison have a real file.
 */
export function runLightweightTrain(datasetId: string): TrainJob {
  ensureDirs();
  const metaPath = join(datasetsDir(), `${datasetId}.meta.json`);
  if (!existsSync(metaPath)) throw new Error('dataset_missing');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as DatasetMeta;
  const lines = readFileSync(meta.path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { label?: number; features?: number[] });
  const job: TrainJob = {
    id: randomUUID(),
    datasetId,
    status: 'queued',
    createdAt: new Date().toISOString(),
    metrics: null,
    modelVersion: null,
    note: 'Lightweight linear weights only. Not a fine-tuned language model.'
  };
  if (!lines.length) {
    job.status = 'failed';
    job.note = 'empty_dataset';
    writeFileSync(join(jobsDir(), `${job.id}.json`), JSON.stringify(job, null, 2));
    return job;
  }
  const dim = Math.max(...lines.map((row) => row.features?.length || 0), 1);
  const weights = new Array(dim).fill(0);
  let correct = 0;
  for (const row of lines) {
    const x = row.features || [];
    const y = row.label === 1 ? 1 : 0;
    let score = 0;
    for (let i = 0; i < dim; i += 1) score += (x[i] || 0) * (weights[i] || 0);
    const pred = score > 0 ? 1 : 0;
    if (pred === y) correct += 1;
    const err = y - pred;
    for (let i = 0; i < dim; i += 1) weights[i] += 0.05 * err * (x[i] || 0);
  }
  const version = `linear-${createHash('sha256').update(JSON.stringify(weights)).digest('hex').slice(0, 12)}`;
  const artifact = { version, weights, trainedAt: new Date().toISOString(), datasetId, kind: 'linear-interest' };
  writeFileSync(join(jobsDir(), `${version}.model.json`), JSON.stringify(artifact, null, 2));
  const registry = JSON.parse(readFileSync(registryFile(), 'utf8')) as {
    versions: Array<{ version: string; at: string }>;
    baseline: string;
  };
  registry.versions.unshift({ version, at: artifact.trainedAt });
  writeFileSync(registryFile(), JSON.stringify(registry, null, 2));
  job.status = 'done';
  job.modelVersion = version;
  job.metrics = { accuracyOnTrain: Math.round((correct / lines.length) * 1000) / 1000, rows: lines.length };
  writeFileSync(join(jobsDir(), `${job.id}.json`), JSON.stringify(job, null, 2));
  return job;
}

export function trainingRegistry() {
  ensureDirs();
  return JSON.parse(readFileSync(registryFile(), 'utf8'));
}
