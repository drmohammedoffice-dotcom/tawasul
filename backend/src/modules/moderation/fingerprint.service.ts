import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type FingerprintMatch = {
  kind: string;
  value: string;
  distance?: number;
  blocked: boolean;
  priorCaseId: string | null;
  confidence: number;
};

@Injectable()
export class FingerprintService {
  private readonly logger = new Logger(FingerprintService.name);
  private readonly py = path.resolve(
    process.cwd(),
    process.cwd().endsWith('backend') ? '../ai-service/.venv/Scripts/python.exe' : 'ai-service/.venv/Scripts/python.exe'
  );
  private readonly worker = path.resolve(
    process.cwd(),
    process.cwd().endsWith('backend')
      ? '../ai-service/python/worker_phash.py'
      : 'ai-service/python/worker_phash.py'
  );

  constructor(private readonly prisma: PrismaService) {}

  sha256File(absolutePath: string): string | null {
    if (!absolutePath || !existsSync(absolutePath)) return null;
    const buf = readFileSync(absolutePath);
    return createHash('sha256').update(buf).digest('hex');
  }

  ahashFile(absolutePath: string): string | null {
    if (!absolutePath || !existsSync(absolutePath) || !existsSync(this.py)) return null;
    try {
      const r = spawnSync(this.py, [this.worker], {
        input: JSON.stringify({ path: absolutePath }),
        encoding: 'utf8',
        timeout: 20_000
      });
      if (r.status !== 0 || !r.stdout) return null;
      const json = JSON.parse(r.stdout) as { ok?: boolean; value?: string };
      return json.ok && json.value ? json.value : null;
    } catch (err) {
      this.logger.warn(`ahash failed: ${err instanceof Error ? err.message : 'error'}`);
      return null;
    }
  }

  /**
   * Local NSFW ViT inference (Falconsai). Used when AI service is down or as direct path.
   * Returns null only when the worker cannot run — never invents a "safe" score.
   */
  classifyNsfw(absolutePath: string): {
    ok: true;
    inference: true;
    label: string;
    nsfwScore: number;
    modelId: string;
    modelVersion: string | null;
    elapsedMs?: number;
  } | null {
    return this.runNsfwWorker('worker_nsfw.py', absolutePath, 300_000);
  }

  /** Sample frames across video duration — not thumbnail-only. */
  classifyVideoNsfw(absolutePath: string): {
    ok: true;
    inference: true;
    label: string;
    nsfwScore: number;
    modelId: string;
    modelVersion: string | null;
  } | null {
    return this.runNsfwWorker('worker_video_frames_nsfw.py', absolutePath, 420_000);
  }

  private runNsfwWorker(
    scriptName: string,
    absolutePath: string,
    timeoutMs: number
  ): {
    ok: true;
    inference: true;
    label: string;
    nsfwScore: number;
    modelId: string;
    modelVersion: string | null;
    elapsedMs?: number;
  } | null {
    const worker = path.resolve(
      process.cwd(),
      process.cwd().endsWith('backend')
        ? `../ai-service/python/${scriptName}`
        : `ai-service/python/${scriptName}`
    );
    const modelDir = path.resolve(
      process.cwd(),
      process.cwd().endsWith('backend') ? '../ai-service/models/nsfw' : 'ai-service/models/nsfw'
    );
    if (!absolutePath || !existsSync(absolutePath) || !existsSync(this.py) || !existsSync(worker)) {
      return null;
    }
    try {
      const r = spawnSync(this.py, [worker], {
        input: JSON.stringify({ path: absolutePath, modelDir }),
        encoding: 'utf8',
        timeout: timeoutMs,
        env: { ...process.env, PYTHONUTF8: '1' }
      });
      const line = (r.stdout || '').trim().split('\n').pop() || '{}';
      const json = JSON.parse(line) as {
        ok?: boolean;
        inference?: boolean;
        label?: string;
        nsfwScore?: number;
        modelId?: string;
        modelVersion?: string;
        elapsedMs?: number;
        reason?: string;
      };
      if (!json.ok || !json.inference || typeof json.nsfwScore !== 'number' || !json.label) {
        this.logger.warn(`nsfw ${scriptName} failed: ${json.reason || 'bad_payload'}`);
        return null;
      }
      return {
        ok: true,
        inference: true,
        label: json.label,
        nsfwScore: json.nsfwScore,
        modelId: json.modelId || 'Falconsai/nsfw_image_detection',
        modelVersion: json.modelVersion || null,
        ...(typeof json.elapsedMs === 'number' ? { elapsedMs: json.elapsedMs } : {})
      };
    } catch (err) {
      this.logger.warn(`nsfw ${scriptName} error: ${err instanceof Error ? err.message : 'error'}`);
      return null;
    }
  }

  hammingHex(a: string, b: string): number {
    if (a.length !== b.length) return 64;
    let dist = 0;
    for (let i = 0; i < a.length; i += 1) {
      const x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
      dist += bitCount(x);
    }
    return dist;
  }

  async registerBlocked(input: {
    kind: string;
    value: string;
    contentType?: string;
    contentId?: string;
    caseId?: string;
    confidence?: number;
  }) {
    return this.prisma.moderationFingerprint.upsert({
      where: { kind_value: { kind: input.kind, value: input.value } },
      create: {
        kind: input.kind,
        value: input.value,
        blocked: true,
        contentType: input.contentType || null,
        contentId: input.contentId || null,
        caseId: input.caseId || null,
        confidence: input.confidence ?? 1
      },
      update: {
        blocked: true,
        ...(input.caseId ? { caseId: input.caseId } : {}),
        ...(input.contentType ? { contentType: input.contentType } : {}),
        ...(input.contentId ? { contentId: input.contentId } : {})
      }
    });
  }

  async findMatches(
    absolutePath: string | null,
    opts?: { ahashThreshold?: number }
  ): Promise<FingerprintMatch[]> {
    const out: FingerprintMatch[] = [];
    if (!absolutePath) return out;
    const threshold = opts?.ahashThreshold ?? 8;

    const sha = this.sha256File(absolutePath);
    if (sha) {
      const exact = await this.prisma.moderationFingerprint.findUnique({
        where: { kind_value: { kind: 'sha256', value: sha } }
      });
      if (exact?.blocked) {
        out.push({
          kind: 'sha256',
          value: sha,
          blocked: true,
          priorCaseId: exact.caseId,
          confidence: 1
        });
      } else {
        out.push({
          kind: 'sha256',
          value: sha,
          blocked: false,
          priorCaseId: null,
          confidence: 1
        });
      }
    }

    const ah = this.ahashFile(absolutePath);
    if (ah) {
      const blocked = await this.prisma.moderationFingerprint.findMany({
        where: { kind: 'ahash', blocked: true },
        take: 500,
        orderBy: { createdAt: 'desc' }
      });
      let best: FingerprintMatch | null = null;
      for (const row of blocked) {
        const d = this.hammingHex(ah, row.value);
        if (d <= threshold) {
          const confidence = 1 - d / 64;
          if (!best || d < (best.distance ?? 99)) {
            best = {
              kind: 'ahash',
              value: ah,
              distance: d,
              blocked: true,
              priorCaseId: row.caseId,
              confidence
            };
          }
        }
      }
      if (best) out.push(best);
      else
        out.push({
          kind: 'ahash',
          value: ah,
          blocked: false,
          priorCaseId: null,
          confidence: 0.5
        });
    }
    return out;
  }
}

function bitCount(n: number): number {
  let c = 0;
  let x = n;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  return c;
}
