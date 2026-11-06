import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { aiConfig } from '../config';

export type ModelKind = 'text-lexicon' | 'text-gguf' | 'ocr' | 'speech' | 'embedding' | 'vision';

export type ModelRecord = {
  id: string;
  kind: ModelKind;
  license: string;
  commercialUse: boolean | string;
  downloadRequired: boolean;
  enabledByDefault: boolean;
  sourceUrl?: string;
  localPath: string | null;
  approxDownloadGb: number;
  approxVramGb: number;
  approvalRequired?: boolean;
  notes?: string;
};

export type ModelStatus = ModelRecord & {
  installed: boolean;
  enabled: boolean;
  ready: boolean;
  bytesOnDisk: number;
  sha256: string | null;
  reason: string;
};

type RegistryFile = { version: string; models: ModelRecord[] };

export class ModelRegistry {
  private readonly file: RegistryFile;

  constructor() {
    this.file = JSON.parse(readFileSync(aiConfig.registryPath, 'utf8')) as RegistryFile;
  }

  list(): ModelStatus[] {
    return this.file.models.map((model) => this.statusOf(model));
  }

  get(id: string): ModelStatus | null {
    const model = this.file.models.find((row) => row.id === id);
    return model ? this.statusOf(model) : null;
  }

  readyFor(kind: ModelKind): ModelStatus | null {
    return this.list().find((row) => row.kind === kind && row.ready) ?? null;
  }

  private statusOf(model: ModelRecord): ModelStatus {
    const enabled = this.isEnabled(model);
    if (!model.downloadRequired) {
      return {
        ...model,
        installed: true,
        enabled,
        ready: enabled,
        bytesOnDisk: 0,
        sha256: null,
        reason: enabled ? 'builtin' : 'disabled'
      };
    }
    if (!model.localPath) {
      return { ...model, installed: false, enabled, ready: false, bytesOnDisk: 0, sha256: null, reason: 'no_local_path' };
    }
    const abs = join(aiConfig.modelsDir, model.localPath);
    const marker = join(abs, '.installed');
    const markerBeside = model.localPath.endsWith('/')
      ? join(aiConfig.modelsDir, model.localPath, '.installed')
      : join(aiConfig.modelsDir, model.localPath.replace(/[^/\\]+$/, ''), '.installed');
    let bytesOnDisk = 0;
    let sha256: string | null = null;
    let installed = false;
    if (existsSync(abs)) {
      const st = statSync(abs);
      if (st.isFile()) {
        installed = st.size > 0;
        bytesOnDisk = st.size;
        if (st.size <= 64 * 1024 * 1024) sha256 = hashFile(abs);
      } else {
        bytesOnDisk = dirSize(abs);
        // Empty placeholder dirs do not count as installed; require .installed or real bytes.
        installed = existsSync(marker) || existsSync(markerBeside) || bytesOnDisk > 1024;
      }
    } else if (existsSync(marker)) {
      installed = true;
    }
    const ready = enabled && installed;
    return {
      ...model,
      installed,
      enabled,
      ready,
      bytesOnDisk,
      sha256,
      reason: !enabled
        ? 'disabled_until_approval'
        : !installed
          ? 'model_missing'
          : 'ready'
    };
  }

  private isEnabled(model: ModelRecord): boolean {
    if (model.kind === 'text-lexicon') return aiConfig.enable.textLexicon;
    if (model.kind === 'text-gguf') return aiConfig.enable.textGguf;
    if (model.kind === 'vision') return aiConfig.enable.vision;
    if (model.kind === 'ocr') return aiConfig.enable.ocr;
    if (model.kind === 'speech') return aiConfig.enable.whisper;
    if (model.kind === 'embedding') return aiConfig.enable.embeddings;
    return false;
  }
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function dirSize(path: string): number {
  let total = 0;
  for (const name of readdirSync(path)) {
    const child = join(path, name);
    const st = statSync(child);
    total += st.isDirectory() ? dirSize(child) : st.size;
  }
  return total;
}
