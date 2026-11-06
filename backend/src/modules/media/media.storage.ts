import { Inject, Injectable, Logger } from '@nestjs/common';
import { existsSync, promises as fs, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { RedisService } from '../redis/redis.service';
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
  UploadTicket
} from './storage/media-storage.types';

export type { UploadTicket };

@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);

  constructor(
    @Inject(MEDIA_STORAGE_PROVIDER)
    private readonly provider: MediaStorageProvider,
    private readonly config: AppConfigService,
    private readonly redisService: RedisService
  ) {}

  get driver() {
    return this.provider.driver;
  }

  createUploadTicket(input: {
    mediaId: string;
    mimeType: string;
    fileName: string;
    uploaderId: string;
    purpose?: string;
  }): Promise<UploadTicket> {
    return this.provider.createUploadTicket(input);
  }

  /**
   * Prefer on-disk objects when present (legacy local uploads + NSFW scan mirrors)
   * so the feed keeps working even if the object was never uploaded to R2.
   * Otherwise mint a signed remote URL.
   */
  async createReadUrl(mediaId: string, storageKey: string): Promise<string> {
    if (this.localFileExists(storageKey)) {
      if (this.provider.driver === 'local' && this.provider.getValidatedLocalReadStorageKey) {
        try {
          return await this.provider.createReadUrl(mediaId, storageKey);
        } catch {
          /* fall through to hybrid Redis-backed local URL */
        }
      }
      // Hybrid R2+local: always mint a short-lived Redis capability token (never bare mediaId).
      return this.mintHybridLocalReadUrl(mediaId, storageKey);
    }
    return this.provider.createReadUrl(mediaId, storageKey);
  }

  getObjectMetadata(storageKey: string) {
    return this.provider.getObjectMetadata(storageKey);
  }

  deleteObject(storageKey: string) {
    return this.provider.deleteObject(storageKey);
  }

  getValidatedLocalUploadStorageKey(mediaId: string, token: string) {
    if (!this.provider.getValidatedLocalUploadStorageKey) {
      return Promise.resolve(null);
    }
    return this.provider.getValidatedLocalUploadStorageKey(mediaId, token);
  }

  async getValidatedLocalReadStorageKey(mediaId: string, token: string): Promise<string | null> {
    if (!token) return null;
    if (this.provider.getValidatedLocalReadStorageKey) {
      const fromProvider = await this.provider.getValidatedLocalReadStorageKey(mediaId, token);
      if (fromProvider) return fromProvider;
    }
    // Hybrid tokens minted by mintHybridLocalReadUrl use the same Redis key scheme.
    return this.redisService.getClient().get(`media:read-token:${mediaId}:${token}`);
  }

  private async mintHybridLocalReadUrl(mediaId: string, storageKey: string): Promise<string> {
    const token = randomUUID();
    await this.redisService.getClient().set(
      `media:read-token:${mediaId}:${token}`,
      storageKey,
      'EX',
      this.config.mediaSignedUrlTtlSeconds
    );
    return `/api/media/local-file/${mediaId}?token=${token}`;
  }

  persistLocalFile(storageKey: string, buffer: Buffer) {
    if (!this.provider.persistLocalFile) {
      // Mirror into local media root so hybrid R2→disk cache still works.
      return this.writeLocalMirror(storageKey, buffer);
    }
    return this.provider.persistLocalFile(storageKey, buffer);
  }

  /**
   * Read object bytes from local disk, provider local helper, or remote (R2/S3).
   * Always returns a Promise — never throws synchronously — so callers can `.catch()`.
   */
  async readLocalFile(storageKey: string): Promise<Buffer> {
    const local = this.safeLocalAbsolutePath(storageKey);
    if (local) return fs.readFile(local);
    if (this.provider.readLocalFile) {
      return this.provider.readLocalFile(storageKey);
    }
    if (this.provider.readObjectBuffer) {
      return this.provider.readObjectBuffer(storageKey);
    }
    throw new Error('Local read not supported by current storage provider');
  }

  /**
   * Ensure a storage key exists on local disk (download from R2/S3 if needed).
   * Used by moderation NSFW / OCR / fingerprint pipelines.
   */
  async ensureLocalFile(storageKey: string): Promise<string | null> {
    const existing = this.safeLocalAbsolutePath(storageKey);
    if (existing) return existing;
    try {
      const buf = await this.readLocalFile(storageKey);
      await this.writeLocalMirror(storageKey, buf);
      return this.safeLocalAbsolutePath(storageKey);
    } catch (err) {
      this.logger.warn(
        `ensureLocalFile failed for ${storageKey}: ${err instanceof Error ? err.message : 'error'}`
      );
      return null;
    }
  }

  private async writeLocalMirror(storageKey: string, buffer: Buffer): Promise<void> {
    const base = path.resolve(this.config.mediaLocalBasePath);
    const full = path.resolve(base, storageKey);
    if (!full.startsWith(base + path.sep) && full !== base) {
      throw new Error('Invalid storage key path');
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
  }

  resolveLocalAbsolutePath(storageKey: string): string {
    const provider = this.provider as MediaStorageProvider & {
      resolveLocalAbsolutePath?: (key: string) => string;
    };
    if (provider.resolveLocalAbsolutePath) {
      return provider.resolveLocalAbsolutePath(storageKey);
    }
    const full = this.safeLocalAbsolutePath(storageKey);
    if (!full) throw new Error('Local path resolve not supported by current storage provider');
    return full;
  }

  localFileExists(storageKey: string): boolean {
    return Boolean(this.safeLocalAbsolutePath(storageKey));
  }

  safeLocalAbsolutePath(storageKey: string): string | null {
    try {
      const base = path.resolve(this.config.mediaLocalBasePath);
      const full = path.resolve(base, storageKey);
      if (!full.startsWith(base + path.sep) && full !== base) return null;
      if (!existsSync(full)) return null;
      return statSync(full).isFile() ? full : null;
    } catch {
      return null;
    }
  }
}
