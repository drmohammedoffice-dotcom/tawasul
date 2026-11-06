import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../redis/redis.service';
import {
  CreateUploadTicketInput,
  MediaStorageProvider,
  ObjectMetadata,
  UploadTicketResult,
  buildObjectKey
} from './media-storage.types';

@Injectable()
export class LocalMediaStorageProvider implements MediaStorageProvider {
  readonly driver = 'local' as const;

  constructor(
    private readonly config: AppConfigService,
    private readonly redisService: RedisService
  ) {}

  async createUploadTicket(input: CreateUploadTicketInput): Promise<UploadTicketResult> {
    const storageKey = buildObjectKey(input);
    const token = randomUUID();
    await this.redisService.getClient().set(
      `media:upload-token:${input.mediaId}:${token}`,
      storageKey,
      'EX',
      this.config.mediaSignedUrlTtlSeconds
    );
    return {
      storageKey,
      uploadUrl: `/api/media/local-upload/${input.mediaId}?token=${token}`,
      method: 'POST',
      provider: 'local'
    };
  }

  async createReadUrl(mediaId: string, storageKey: string): Promise<string> {
    const token = randomUUID();
    await this.redisService.getClient().set(
      `media:read-token:${mediaId}:${token}`,
      storageKey,
      'EX',
      this.config.mediaSignedUrlTtlSeconds
    );
    return `/api/media/local-file/${mediaId}?token=${token}`;
  }

  async getObjectMetadata(storageKey: string): Promise<ObjectMetadata> {
    try {
      const stat = await fs.stat(this.localFullPath(storageKey));
      return { exists: true, sizeBytes: stat.size };
    } catch {
      return { exists: false };
    }
  }

  async deleteObject(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.localFullPath(storageKey));
    } catch {
      // idempotent delete
    }
  }

  async getValidatedLocalUploadStorageKey(mediaId: string, token: string): Promise<string | null> {
    return this.redisService.getClient().get(`media:upload-token:${mediaId}:${token}`);
  }

  async getValidatedLocalReadStorageKey(mediaId: string, token: string): Promise<string | null> {
    return this.redisService.getClient().get(`media:read-token:${mediaId}:${token}`);
  }

  async persistLocalFile(storageKey: string, buffer: Buffer): Promise<void> {
    const fullPath = this.localFullPath(storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
  }

  async readLocalFile(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.localFullPath(storageKey));
  }

  resolveLocalAbsolutePath(storageKey: string): string {
    return this.localFullPath(storageKey);
  }

  private localFullPath(storageKey: string): string {
    const base = path.resolve(this.config.mediaLocalBasePath);
    const full = path.resolve(base, storageKey);
    if (!full.startsWith(base + path.sep) && full !== base) {
      throw new Error('Invalid storage key path');
    }
    return full;
  }
}
