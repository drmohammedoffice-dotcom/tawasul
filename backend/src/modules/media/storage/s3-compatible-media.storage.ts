import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../../config/app-config.service';
import {
  CreateUploadTicketInput,
  MediaStorageDriver,
  MediaStorageProvider,
  ObjectMetadata,
  UploadTicketResult,
  buildObjectKey
} from './media-storage.types';

@Injectable()
export class S3CompatibleMediaStorageProvider implements MediaStorageProvider {
  private readonly logger = new Logger(S3CompatibleMediaStorageProvider.name);
  private readonly client: S3Client;
  readonly driver: MediaStorageDriver;
  private readonly bucket: string;

  constructor(private readonly config: AppConfigService) {
    this.driver = this.config.mediaStorageDriver;
    this.bucket = this.config.resolvedMediaBucket;
    const endpoint = this.config.resolvedMediaEndpoint;
    this.client = new S3Client({
      region: this.config.resolvedMediaRegion,
      forcePathStyle: this.config.mediaForcePathStyle,
      ...(endpoint ? { endpoint } : {}),
      credentials: {
        accessKeyId: this.config.resolvedMediaAccessKeyId,
        secretAccessKey: this.config.resolvedMediaSecretAccessKey
      }
    });
  }

  async createUploadTicket(input: CreateUploadTicketInput): Promise<UploadTicketResult> {
    const storageKey = buildObjectKey(input);
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: input.mimeType
    });
    const uploadUrl = await getSignedUrl(this.client, cmd, {
      expiresIn: this.config.mediaSignedUrlTtlSeconds
    });
    return {
      storageKey,
      bucket: this.bucket,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      provider: this.driver
    };
  }

  async createReadUrl(_mediaId: string, storageKey: string): Promise<string> {
    const publicBase = this.config.mediaPublicBaseUrl;
    if (publicBase && this.config.mediaAllowPublicReads) {
      return `${publicBase.replace(/\/$/, '')}/${storageKey}`;
    }
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey
    });
    return getSignedUrl(this.client, cmd, {
      expiresIn: this.config.mediaSignedUrlTtlSeconds
    });
  }

  async getObjectMetadata(storageKey: string): Promise<ObjectMetadata> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey })
      );
      const meta: ObjectMetadata = { exists: true };
      if (typeof head.ContentLength === 'number') meta.sizeBytes = head.ContentLength;
      if (head.ContentType) meta.contentType = head.ContentType;
      if (head.ETag) meta.etag = head.ETag;
      return meta;
    } catch {
      this.logger.debug(`HeadObject miss for key=${storageKey}`);
      return { exists: false };
    }
  }

  async deleteObject(storageKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey })
    );
  }

  async readObjectBuffer(storageKey: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey })
    );
    if (!res.Body) throw new Error(`empty object body for key=${storageKey}`);
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }
}
