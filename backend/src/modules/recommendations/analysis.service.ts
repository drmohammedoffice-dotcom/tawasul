import { createHash } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TawasulAiClient } from '../ai/tawasul-ai.client';
import { MediaStorageService } from '../media/media.storage';
import { PrismaService } from '../prisma/prisma.service';
import { analyzeText, contentHash as textContentHash, LEXICON_VERSION } from './engine/taxonomy';
import { RecommendationFeatureService } from './feature.service';

const MAX_ATTEMPTS = 3;
const EMBED_MODEL = 'bge-m3';
const ANALYSIS_BUNDLE = 'tawasul-ai-bundle-1.0.0';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_AUDIO_BYTES = 40 * 1024 * 1024;
const IMAGE_MIME = /^(image\/(jpeg|jpg|png|webp|gif|bmp))$/i;
const AUDIO_MIME = /^(audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|m4a)|video\/(mp4|webm|quicktime))$/i;

type MediaRef = {
  mediaId: string;
  storageKey: string;
  mimeType: string;
  mediaType: string;
  sizeBytes: number;
  absolutePath: string | null;
};

type LoadedContent = {
  text: string;
  hashtags: string[];
  media: MediaRef[];
  deleted: boolean;
};

@Injectable()
export class ContentAnalysisService {
  private readonly logger = new Logger(ContentAnalysisService.name);
  private kicking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: RecommendationFeatureService,
    @Optional() private readonly tawasulAi?: TawasulAiClient,
    @Optional() private readonly mediaStorage?: MediaStorageService
  ) {}

  enqueue(contentType: 'post' | 'reel', contentId: string, text: string, hashtags: string[]): void {
    void this.enqueueAsync(contentType, contentId, text, hashtags).catch((err) => {
      this.logger.warn(`analysis enqueue skipped: ${err instanceof Error ? err.message : 'error'}`);
    });
  }

  async enqueueAsync(
    contentType: 'post' | 'reel',
    contentId: string,
    text: string,
    hashtags: string[]
  ): Promise<void> {
    const mode = await this.features.modeFor('system');
    if (!mode.textAnalysis) return;
    const source = await this.loadContent(contentType, contentId);
    const caption = source?.text ?? text;
    const tags = source?.hashtags?.length ? source.hashtags : hashtags;
    const mediaKeys = (source?.media || []).map((m) => m.storageKey).sort();
    const hash = bundleHash(caption, tags, mediaKeys);
    const current = await this.prisma.contentUnderstanding.findUnique({
      where: { contentType_contentId: { contentType, contentId } }
    });
    if (
      current &&
      current.contentHash === hash &&
      current.status === 'ready' &&
      (current.modelVersion === LEXICON_VERSION || current.modelVersion === ANALYSIS_BUNDLE)
    ) {
      return;
    }
    await this.prisma.contentAnalysisJob.upsert({
      where: { contentType_contentId_contentHash: { contentType, contentId, contentHash: hash } },
      create: { contentType, contentId, contentHash: hash, status: 'pending' },
      update: { status: 'pending', runAfter: new Date(), lastError: null }
    });
    this.kick();
  }

  /** Soft-delete / hide: invalidate embeddings so search cannot resurface them. */
  async invalidate(contentType: 'post' | 'reel', contentId: string): Promise<void> {
    await this.prisma.contentEmbedding.updateMany({
      where: { contentType, contentId },
      data: { status: 'stale' }
    });
    await this.prisma.contentUnderstanding.updateMany({
      where: { contentType, contentId },
      data: { status: 'stale' }
    });
  }

  kick(): void {
    if (this.kicking) return;
    this.kicking = true;
    setImmediate(() => {
      void this.processBatch(4)
        .catch((err) => {
          this.logger.warn(`analysis batch failed: ${err instanceof Error ? err.message : 'error'}`);
        })
        .finally(() => {
          this.kicking = false;
        });
    });
  }

  async processBatch(limit: number): Promise<{ done: number; failed: number }> {
    const jobs = await this.prisma.contentAnalysisJob.findMany({
      where: { status: 'pending', runAfter: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 10)
    });
    let done = 0;
    let failed = 0;
    for (const job of jobs) {
      const claimed = await this.prisma.contentAnalysisJob.updateMany({
        where: { id: job.id, status: 'pending' },
        data: { status: 'running', attempts: { increment: 1 } }
      });
      if (!claimed.count) continue;
      try {
        const source = await this.loadContent(job.contentType, job.contentId);
        if (!source || source.deleted) throw new Error('content_missing');
        const result = await this.analyzeBundle(job.contentType, job.contentId, job.contentHash, source);
        await this.prisma.contentUnderstanding.upsert({
          where: { contentType_contentId: { contentType: job.contentType, contentId: job.contentId } },
          create: result.understanding,
          update: {
            ...result.understanding,
            analyzedAt: new Date(),
            error: null
          }
        });
        if (result.embedding) {
          const emb = result.embedding;
          await this.prisma.contentEmbedding.upsert({
            where: {
              contentType_contentId_modelId: {
                contentType: job.contentType,
                contentId: job.contentId,
                modelId: EMBED_MODEL
              }
            },
            create: emb,
            update: {
              contentHash: emb.contentHash,
              dim: emb.dim,
              vector: emb.vector,
              status: 'ready',
              ...(emb.sourceText !== undefined ? { sourceText: emb.sourceText } : {})
            }
          });
        }
        await this.prisma.contentAnalysisJob.update({
          where: { id: job.id },
          data: { status: 'done', lastError: null }
        });
        done += 1;
      } catch (err) {
        const message = (err instanceof Error ? err.message : 'error').slice(0, 200);
        const attempts = job.attempts + 1;
        const again = attempts < MAX_ATTEMPTS;
        await this.prisma.contentAnalysisJob.update({
          where: { id: job.id },
          data: {
            status: again ? 'pending' : 'failed',
            lastError: message,
            runAfter: new Date(Date.now() + attempts * 30_000)
          }
        });
        if (!again) {
          await this.prisma.contentUnderstanding.upsert({
            where: { contentType_contentId: { contentType: job.contentType, contentId: job.contentId } },
            create: {
              contentType: job.contentType,
              contentId: job.contentId,
              contentHash: job.contentHash,
              modelVersion: LEXICON_VERSION,
              language: 'unknown',
              topics: [],
              keywords: [],
              quality: 'low',
              status: 'failed',
              confidence: 0,
              error: message
            },
            update: { status: 'failed', error: message, modelVersion: LEXICON_VERSION }
          });
          failed += 1;
          this.logger.warn(`content analysis failed for ${job.contentType}: ${message}`);
        }
      }
    }
    return { done, failed };
  }

  async topicKeys(contentType: string, contentId: string): Promise<string[]> {
    const row = await this.prisma.contentUnderstanding.findUnique({
      where: { contentType_contentId: { contentType, contentId } },
      select: { status: true, quality: true, topics: true }
    });
    if (!row || row.status !== 'ready' || row.quality === 'low' || !Array.isArray(row.topics)) return [];
    return row.topics
      .map((topic) => (topic && typeof topic === 'object' && 'key' in topic ? String(topic.key) : ''))
      .filter((key) => key.length > 0);
  }

  private async analyzeBundle(
    contentType: string,
    contentId: string,
    contentHash: string,
    source: LoadedContent
  ) {
    const kinds: string[] = ['text'];
    const remoteJobIds: string[] = [];
    const mediaAnalysis: Array<Record<string, unknown>> = [];
    let ocrRaw: string | null = null;
    let ocrLogical: string | null = null;
    let ocrDisplay: string | null = null;
    let ocrSearch: string | null = null;
    let transcript: string | null = null;
    let enrichment: Prisma.InputJsonValue | undefined;

    // 1) Text: prefer async /v1/jobs text.analyze (lexicon + optional GGUF); fall back to sync / lexicon.
    const understanding = await this.resolveUnderstanding(
      source.text,
      source.hashtags,
      contentType,
      contentId,
      contentHash,
      remoteJobIds
    );
    if (understanding.enrichment) enrichment = understanding.enrichment;

    // 2) Media: local paths only — never signed URLs, never private message attachments.
    if (this.tawasulAi?.enabled()) {
      for (const media of source.media) {
        const entry = await this.analyzeMedia(media, contentType, contentId, contentHash, remoteJobIds);
        mediaAnalysis.push(entry);
        if (entry.kind === 'image' && entry.ok) {
          kinds.push('ocr');
          ocrRaw = joinOpt(ocrRaw, entry.ocrRaw);
          ocrLogical = joinOpt(ocrLogical, entry.ocrLogical);
          ocrDisplay = joinOpt(ocrDisplay, entry.ocrDisplay);
          ocrSearch = joinOpt(ocrSearch, entry.ocrSearch);
        }
        if ((entry.kind === 'audio' || entry.kind === 'video') && entry.ok) {
          kinds.push(entry.kind === 'audio' ? 'whisper' : 'video');
          transcript = joinOpt(transcript, entry.transcript);
        }
      }
    }

    // 3) Embedding over caption + OCR logical + transcript (public content only).
    let embeddingCreate: {
      contentType: string;
      contentId: string;
      contentHash: string;
      modelId: string;
      dim: number;
      vector: Prisma.InputJsonValue;
      status: string;
      sourceText: string;
    } | null = null;
    const embedSource = [source.text, ocrLogical || '', transcript || '']
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
    if (embedSource && this.tawasulAi?.enabled()) {
      const emb = await this.createEmbedding(embedSource, contentType, contentId, contentHash, remoteJobIds);
      if (emb) {
        kinds.push('embed');
        embeddingCreate = {
          contentType,
          contentId,
          contentHash,
          modelId: EMBED_MODEL,
          dim: emb.dim,
          vector: emb.vector as unknown as Prisma.InputJsonValue,
          status: 'ready',
          sourceText: embedSource.slice(0, 500)
        };
      }
    }

    const usable = understanding.quality === 'ok' ? understanding.topics : [];
    const modelVersion =
      remoteJobIds.length || ocrLogical || transcript ? ANALYSIS_BUNDLE : understanding.modelVersion;

    return {
      understanding: {
        contentType,
        contentId,
        contentHash,
        modelVersion,
        language: understanding.language,
        topics: usable as unknown as Prisma.InputJsonValue,
        keywords: understanding.keywords as unknown as Prisma.InputJsonValue,
        quality: understanding.quality,
        status: 'ready',
        confidence: usable[0]?.confidence ?? 0,
        ocrRaw,
        ocrLogical,
        ocrDisplay,
        ocrSearch,
        transcript,
        enrichment: enrichment ?? Prisma.JsonNull,
        mediaAnalysis: mediaAnalysis as unknown as Prisma.InputJsonValue,
        analysisKinds: kinds as unknown as Prisma.InputJsonValue,
        remoteJobIds: remoteJobIds as unknown as Prisma.InputJsonValue
      },
      embedding: embeddingCreate
    };
  }

  private async resolveUnderstanding(
    text: string,
    hashtags: string[],
    contentType: string,
    contentId: string,
    contentHash: string,
    remoteJobIds: string[]
  ) {
    let enrichment: Prisma.InputJsonValue | undefined;
    if (this.tawasulAi?.enabled()) {
      const job = await this.tawasulAi.enqueueAndWait(
        {
          type: 'text.analyze',
          payload: { text: text.slice(0, 8000), hashtags },
          idempotencyKey: `text:${contentType}:${contentId}:${contentHash}`,
          priority: 4
        },
        { timeoutMs: 60_000, intervalMs: 500 }
      );
      if (job?.id) remoteJobIds.push(job.id);
      if (job?.status === 'done' && job.result && typeof job.result === 'object') {
        const result = job.result as {
          understanding?: {
            language: string;
            topics: Array<{ key: string; confidence: number; parent: string | null }>;
            keywords: string[];
            quality: string;
            modelVersion: string;
          };
          enrichment?: unknown;
        };
        if (result.understanding) {
          if (result.enrichment) enrichment = result.enrichment as Prisma.InputJsonValue;
          return {
            language: result.understanding.language as 'ar' | 'en' | 'mixed' | 'unknown',
            topics: result.understanding.topics || [],
            keywords: result.understanding.keywords || [],
            quality: (result.understanding.quality === 'low' ? 'low' : 'ok') as 'ok' | 'low',
            modelVersion: result.understanding.modelVersion || LEXICON_VERSION,
            enrichment
          };
        }
      }
      // Sync lexicon fallback if jobs path unavailable.
      const remote = await this.tawasulAi.analyzeText(text, hashtags);
      if (remote?.ok && remote.understanding) {
        return {
          language: remote.understanding.language as 'ar' | 'en' | 'mixed' | 'unknown',
          topics: remote.understanding.topics || [],
          keywords: remote.understanding.keywords || [],
          quality: (remote.understanding.quality === 'low' ? 'low' : 'ok') as 'ok' | 'low',
          modelVersion: remote.understanding.modelVersion || LEXICON_VERSION,
          enrichment
        };
      }
    }
    const local = analyzeText(text, hashtags);
    return { ...local, enrichment };
  }

  private async analyzeMedia(
    media: MediaRef,
    contentType: string,
    contentId: string,
    contentHash: string,
    remoteJobIds: string[]
  ): Promise<Record<string, unknown>> {
    const base = {
      mediaId: media.mediaId,
      mimeType: media.mimeType,
      mediaType: media.mediaType,
      sizeBytes: media.sizeBytes
    };
    if (!media.absolutePath) {
      return { ...base, ok: false, kind: 'skip', reason: 'local_path_missing' };
    }
    if (!this.tawasulAi?.enabled()) {
      return { ...base, ok: false, kind: 'skip', reason: 'ai_offline' };
    }

    const isImage = IMAGE_MIME.test(media.mimeType) || media.mediaType === 'image';
    const isAv =
      AUDIO_MIME.test(media.mimeType) ||
      media.mediaType === 'audio' ||
      media.mediaType === 'video';

    if (isImage) {
      if (media.sizeBytes > MAX_IMAGE_BYTES) {
        return { ...base, ok: false, kind: 'image', reason: 'image_too_large' };
      }
      const job = await this.tawasulAi.enqueueAndWait(
        {
          type: 'image.analyze',
          payload: { path: media.absolutePath },
          idempotencyKey: `img:${contentType}:${contentId}:${contentHash}:${media.mediaId}`,
          priority: 6
        },
        { timeoutMs: 120_000, intervalMs: 1000 }
      );
      if (job?.id) remoteJobIds.push(job.id);
      if (!job || (job.status !== 'done' && job.status !== 'unavailable')) {
        return { ...base, ok: false, kind: 'image', reason: job?.error || job?.status || 'job_failed' };
      }
      const ocr = extractOcr(job.result);
      return {
        ...base,
        ok: Boolean(ocr.ocrLogical || ocr.ocrRaw),
        kind: 'image',
        remoteJobId: job.id,
        status: job.status,
        ...ocr
      };
    }

    if (isAv) {
      if (media.sizeBytes > MAX_AUDIO_BYTES) {
        return { ...base, ok: false, kind: 'audio', reason: 'media_too_large' };
      }
      const videoLike =
        /video\//i.test(media.mimeType) || media.mediaType === 'video';
      const job = await this.tawasulAi.enqueueAndWait(
        {
          type: videoLike ? 'video.analyze' : 'audio.transcribe',
          payload: { path: media.absolutePath },
          idempotencyKey: `av:${contentType}:${contentId}:${contentHash}:${media.mediaId}`,
          priority: 7
        },
        { timeoutMs: 180_000, intervalMs: 1500 }
      );
      if (job?.id) remoteJobIds.push(job.id);
      if (!job || (job.status !== 'done' && job.status !== 'unavailable')) {
        return {
          ...base,
          ok: false,
          kind: videoLike ? 'video' : 'audio',
          reason: job?.error || job?.status || 'job_failed'
        };
      }
      const text = extractTranscript(job.result);
      return {
        ...base,
        ok: Boolean(text),
        kind: videoLike ? 'video' : 'audio',
        remoteJobId: job.id,
        status: job.status,
        transcript: text
      };
    }

    return { ...base, ok: false, kind: 'skip', reason: 'unsupported_mime' };
  }

  private async createEmbedding(
    text: string,
    contentType: string,
    contentId: string,
    contentHash: string,
    remoteJobIds: string[]
  ): Promise<{ dim: number; vector: number[] } | null> {
    if (!this.tawasulAi?.enabled()) return null;
    const job = await this.tawasulAi.enqueueAndWait(
      {
        type: 'embed.batch',
        payload: { texts: [text] },
        idempotencyKey: `emb:${contentType}:${contentId}:${contentHash}`,
        priority: 8
      },
      { timeoutMs: 120_000, intervalMs: 1000 }
    );
    if (job?.id) remoteJobIds.push(job.id);
    if (!job || job.status !== 'done' || !job.result || typeof job.result !== 'object') return null;
    const data = (job.result as { data?: { dim?: number; vectors?: number[][] }; ok?: boolean }).data;
    const vector = data?.vectors?.[0];
    const dim = data?.dim || vector?.length || 0;
    if (!vector || !dim || vector.length !== dim) return null;
    return { dim, vector };
  }

  private async loadContent(contentType: string, contentId: string): Promise<LoadedContent | null> {
    if (contentType === 'post') {
      const post = await this.prisma.post.findUnique({
        where: { id: contentId },
        select: {
          caption: true,
          deletedAt: true,
          hashtags: { select: { hashtag: { select: { tag: true } } } },
          media: {
            orderBy: { sortOrder: 'asc' },
            select: {
              media: {
                select: {
                  id: true,
                  storageKey: true,
                  mimeType: true,
                  mediaType: true,
                  sizeBytes: true,
                  deletedAt: true,
                  purpose: true,
                  visibility: true
                }
              }
            }
          }
        }
      });
      if (!post) return null;
      return {
        text: post.caption || '',
        hashtags: post.hashtags.map((row) => row.hashtag.tag),
        deleted: Boolean(post.deletedAt),
        media: this.mapMedia(post.media.map((row) => row.media))
      };
    }
    if (contentType === 'reel') {
      const reel = await this.prisma.reel.findUnique({
        where: { id: contentId },
        select: {
          caption: true,
          deletedAt: true,
          hashtags: { select: { hashtag: { select: { tag: true } } } },
          media: {
            select: {
              id: true,
              storageKey: true,
              mimeType: true,
              mediaType: true,
              sizeBytes: true,
              deletedAt: true,
              purpose: true,
              visibility: true
            }
          }
        }
      });
      if (!reel) return null;
      return {
        text: reel.caption || '',
        hashtags: reel.hashtags.map((row) => row.hashtag.tag),
        deleted: Boolean(reel.deletedAt),
        media: this.mapMedia(reel.media ? [reel.media] : [])
      };
    }
    return null;
  }

  private mapMedia(
    rows: Array<{
      id: string;
      storageKey: string;
      mimeType: string;
      mediaType: string;
      sizeBytes: number;
      deletedAt: Date | null;
      purpose: string;
      visibility: string;
    }>
  ): MediaRef[] {
    const out: MediaRef[] = [];
    for (const row of rows) {
      if (row.deletedAt) continue;
      // Never analyze chat/message attachments via post pipeline.
      if (row.purpose === 'message' || row.purpose === 'chat') continue;
      let absolutePath: string | null = null;
      if (this.mediaStorage) {
        absolutePath = this.mediaStorage.safeLocalAbsolutePath(row.storageKey);
      }
      out.push({
        mediaId: row.id,
        storageKey: row.storageKey,
        mimeType: row.mimeType,
        mediaType: row.mediaType,
        sizeBytes: row.sizeBytes,
        absolutePath
      });
    }
    return out;
  }
}

function bundleHash(text: string, hashtags: string[], mediaKeys: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ text: textContentHash(text, hashtags), mediaKeys }))
    .digest('hex');
}

function joinOpt(prev: string | null, next: unknown): string | null {
  const value = typeof next === 'string' ? next.trim() : '';
  if (!value) return prev;
  if (!prev) return value;
  return `${prev}\n${value}`;
}

function extractOcr(result: unknown): {
  ocrRaw: string | null;
  ocrLogical: string | null;
  ocrDisplay: string | null;
  ocrSearch: string | null;
} {
  const empty = { ocrRaw: null, ocrLogical: null, ocrDisplay: null, ocrSearch: null };
  if (!result || typeof result !== 'object') return empty;
  const ocr = (result as { ocr?: { ok?: boolean; data?: Record<string, unknown> } }).ocr;
  const data = ocr?.data;
  if (!data) return empty;
  return {
    ocrRaw: strOrNull(data.textRaw) || strOrNull(data.text),
    ocrLogical: strOrNull(data.textLogical) || strOrNull(data.text),
    ocrDisplay: strOrNull(data.textDisplay) || strOrNull(data.textLogical) || strOrNull(data.text),
    ocrSearch: strOrNull(data.textSearch) || strOrNull(data.textLogical) || strOrNull(data.text)
  };
}

function extractTranscript(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const root = result as {
    data?: { text?: string };
    whisper?: { data?: { text?: string }; ok?: boolean };
  };
  if (typeof root.data?.text === 'string') return root.data.text.trim() || null;
  if (typeof root.whisper?.data?.text === 'string') return root.whisper.data.text.trim() || null;
  return null;
}

function strOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}
