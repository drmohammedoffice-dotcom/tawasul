import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
export type StreamSetupReason =
  | 'ok'
  | 'provider_not_stream'
  | 'missing_account_id'
  | 'missing_api_token'
  | 'misconfigured'
  | 'connection_error'
  | 'upstream_error'
  | 'upstream_rejected';
export type StreamSetupStatus = {
  enabled: boolean;
  reason: StreamSetupReason;
  message: string;
  hints: string[];
};
/**
 * Optional Cloudflare Stream integration.
 * Never logs API tokens or webhook secrets.
 */
@Injectable()
export class VideoStreamService {
  private readonly logger = new Logger(VideoStreamService.name);
  /** Videos stuck in processing longer than this without webhook → failed (retryable). */
  static readonly PROCESSING_TIMEOUT_MS = 60 * 60 * 1000;
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService
  ) {}
  getSetupStatus(): StreamSetupStatus {
    if (this.config.videoStorageProvider !== 'stream') {
      return {
        enabled: false,
        reason: 'provider_not_stream',
        message:
          'Cloudflare Stream is not the active video provider. Set VIDEO_STORAGE_PROVIDER=stream to enable direct uploads and encoding webhooks.',
        hints: [
          'VIDEO_STORAGE_PROVIDER=stream',
          'CLOUDFLARE_STREAM_ACCOUNT_ID=<account>',
          'CLOUDFLARE_STREAM_API_TOKEN=<token with Stream:Edit>',
          'CLOUDFLARE_STREAM_WEBHOOK_SECRET=<webhook signing secret>'
        ]
      };
    }
    if (!this.config.cloudflareStreamAccountId) {
      return {
        enabled: false,
        reason: 'missing_account_id',
        message: 'CLOUDFLARE_STREAM_ACCOUNT_ID is missing. Stream direct-upload cannot start.',
        hints: ['Set CLOUDFLARE_STREAM_ACCOUNT_ID in backend/.env and restart the API']
      };
    }
    if (!this.config.cloudflareStreamApiToken) {
      return {
        enabled: false,
        reason: 'missing_api_token',
        message: 'CLOUDFLARE_STREAM_API_TOKEN is missing. Stream direct-upload cannot start.',
        hints: ['Create a Cloudflare API token with Stream:Edit and set CLOUDFLARE_STREAM_API_TOKEN']
      };
    }
    return {
      enabled: true,
      reason: 'ok',
      message: 'Cloudflare Stream credentials are present.',
      hints: []
    };
  }
  isEnabled(): boolean {
    return this.getSetupStatus().enabled;
  }
  private unavailable(code: StreamSetupReason, message: string, hints: string[] = []): never {
    throw new HttpException({ code, message, hints }, HttpStatus.SERVICE_UNAVAILABLE);
  }
  async createDirectUpload(userId: string, input: { maxDurationSeconds?: number }) {
    const setup = this.getSetupStatus();
    if (!setup.enabled) {
      this.unavailable(setup.reason, setup.message, setup.hints);
    }
    const accountId = this.config.cloudflareStreamAccountId!;
    const token = this.config.cloudflareStreamApiToken!;
    const maxDurationSeconds = input.maxDurationSeconds ?? 90;
    let response: Response;
    try {
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/direct_upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            maxDurationSeconds,
            requireSignedURLs: true,
            meta: { uploaderId: userId }
          })
        }
      );
    } catch (error) {
      this.logger.warn(`Stream direct_upload connection error: ${this.safeError(error)}`);
      this.unavailable('connection_error', 'Could not reach Cloudflare Stream API. Check network connectivity and retry.', [
        'Verify outbound HTTPS to api.cloudflare.com'
      ]);
    }
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      errors?: Array<{ message?: string; code?: number }>;
      result?: { uploadURL?: string; uid?: string };
    } | null;
    if (response.status === 401 || response.status === 403) {
      this.logger.warn(`Stream direct_upload auth rejected status=${response.status}`);
      this.unavailable(
        'misconfigured',
        'Cloudflare Stream rejected the API token or account. Check CLOUDFLARE_STREAM_ACCOUNT_ID and token permissions (Stream:Edit).',
        ['Rotate the Stream API token', 'Confirm the account id matches the token']
      );
    }
    if (response.status >= 500) {
      this.logger.warn(`Stream direct_upload upstream error status=${response.status}`);
      this.unavailable('upstream_error', 'Cloudflare Stream is temporarily unavailable. Retry later.');
    }
    if (!response.ok || !payload?.success || !payload.result?.uploadURL || !payload.result?.uid) {
      const upstreamMessage = payload?.errors?.[0]?.message ?? 'Failed to create Stream direct upload';
      this.logger.warn(`Stream direct_upload rejected status=${response.status}`);
      throw new BadRequestException({
        code: 'upstream_rejected' satisfies StreamSetupReason,
        message: upstreamMessage
      });
    }
    const uid = payload.result.uid;
    const mediaId = randomUUID().replace(/-/g, '').slice(0, 24);
    const media = await this.prisma.mediaAsset.create({
      data: {
        id: mediaId,
        uploaderId: userId,
        storageProvider: 'stream',
        storageKey: `stream:${uid}`,
        originalFileName: `stream-${uid}.mp4`,
        mimeType: 'video/mp4',
        mediaType: 'video',
        purpose: 'reel',
        sizeBytes: 0,
        encryptedFileKey: 'public-unencrypted',
        streamUid: uid,
        processingStatus: 'processing',
        visibility: 'private'
      }
    });
    return {
      uploadURL: payload.result.uploadURL,
      uid,
      mediaId: media.id,
      processingStatus: media.processingStatus,
      provider: 'stream' as const
    };
  }
  async markReadyByStreamUid(streamUid: string, status: 'ready' | 'failed') {
    await this.prisma.mediaAsset.updateMany({
      where: { streamUid },
      data:
        status === 'ready'
          ? { processingStatus: status, uploadCompletedAt: new Date() }
          : { processingStatus: status }
    });
  }
  async refreshProcessingStatus(userId: string, mediaId: string) {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media || media.deletedAt) {
      throw new NotFoundException('media not found');
    }
    if (media.uploaderId !== userId) {
      throw new BadRequestException('only uploader can refresh processing status');
    }
    if (media.processingStatus === 'ready' || media.processingStatus === 'deleted') {
      return {
        mediaId: media.id,
        processingStatus: media.processingStatus,
        changed: false,
        reason: 'already_terminal'
      };
    }
    if (media.streamUid && this.isEnabled()) {
      const remote = await this.fetchStreamStatus(media.streamUid);
      if (remote === 'ready' || remote === 'failed') {
        await this.markReadyByStreamUid(media.streamUid, remote);
        return {
          mediaId: media.id,
          processingStatus: remote,
          changed: true,
          reason: 'stream_poll'
        };
      }
    }
    if (media.processingStatus === 'processing') {
      const ageMs = Date.now() - media.updatedAt.getTime();
      if (ageMs >= VideoStreamService.PROCESSING_TIMEOUT_MS) {
        await this.prisma.mediaAsset.update({
          where: { id: media.id },
          data: { processingStatus: 'failed' }
        });
        return {
          mediaId: media.id,
          processingStatus: 'failed' as const,
          changed: true,
          reason: 'processing_timeout',
          message:
            'Video stayed in processing too long without a Stream ready webhook. Fix Stream setup or retry processing.'
        };
      }
    }
    if (!media.streamUid && media.uploadCompletedAt && media.processingStatus === 'processing') {
      const updated = await this.prisma.mediaAsset.update({
        where: { id: media.id },
        data: { processingStatus: 'ready' }
      });
      return {
        mediaId: updated.id,
        processingStatus: updated.processingStatus,
        changed: true,
        reason: 'local_ready_no_stream'
      };
    }
    return {
      mediaId: media.id,
      processingStatus: media.processingStatus,
      changed: false,
      reason: 'still_processing',
      streamConfigured: this.isEnabled()
    };
  }
  async retryProcessing(userId: string, mediaId: string) {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media || media.deletedAt) {
      throw new NotFoundException('media not found');
    }
    if (media.uploaderId !== userId) {
      throw new BadRequestException('only uploader can retry processing');
    }
    if (media.mediaType !== 'video') {
      throw new BadRequestException('only video media supports processing retry');
    }
    if (media.streamUid) {
      if (!this.isEnabled()) {
        const setup = this.getSetupStatus();
        this.unavailable(setup.reason, setup.message, setup.hints);
      }
      await this.prisma.mediaAsset.update({
        where: { id: media.id },
        data: { processingStatus: 'processing' }
      });
      return this.refreshProcessingStatus(userId, mediaId);
    }
    if (!media.uploadCompletedAt) {
      throw new BadRequestException('upload is not completed yet');
    }
    const updated = await this.prisma.mediaAsset.update({
      where: { id: media.id },
      data: { processingStatus: 'ready' }
    });
    return {
      mediaId: updated.id,
      processingStatus: updated.processingStatus,
      changed: true,
      reason: 'marked_ready_without_stream'
    };
  }
  private async fetchStreamStatus(streamUid: string): Promise<'ready' | 'failed' | 'processing' | 'unknown'> {
    const accountId = this.config.cloudflareStreamAccountId;
    const token = this.config.cloudflareStreamApiToken;
    if (!accountId || !token) return 'unknown';
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${streamUid}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.status === 401 || response.status === 403) {
        this.logger.warn('Stream status poll auth rejected');
        return 'unknown';
      }
      if (!response.ok) {
        this.logger.warn(`Stream status poll failed status=${response.status}`);
        return 'unknown';
      }
      const payload = (await response.json()) as {
        result?: { readyToStream?: boolean; status?: { state?: string } };
      };
      if (payload.result?.readyToStream || payload.result?.status?.state === 'ready') {
        return 'ready';
      }
      if (payload.result?.status?.state === 'error') {
        return 'failed';
      }
      return 'processing';
    } catch (error) {
      this.logger.warn(`Stream status poll connection error: ${this.safeError(error)}`);
      return 'unknown';
    }
  }
  /**
   * Cloudflare Stream signs webhooks as:
   *   Webhook-Signature: time=<unix>,sig1=<hex>
   * where sig1 = HMAC-SHA256(secret, `${time}.${rawBody}`) hex-encoded.
   * @see https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    const secret = this.config.cloudflareStreamWebhookSecret;
    if (!secret || !signatureHeader) {
      return false;
    }
    const parts: Record<string, string> = {};
    for (const piece of signatureHeader.split(',')) {
      const idx = piece.indexOf('=');
      if (idx <= 0) continue;
      parts[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim();
    }
    const time = parts.time;
    const sig1 = parts.sig1;
    if (time && sig1) {
      const ageSec = Math.abs(Math.floor(Date.now() / 1000) - Number(time));
      if (!Number.isFinite(ageSec) || ageSec > 300) {
        return false;
      }
      const expected = createHmac('sha256', secret).update(`${time}.${rawBody}`).digest('hex');
      try {
        const a = Buffer.from(expected, 'hex');
        const b = Buffer.from(sig1, 'hex');
        return a.length === b.length && timingSafeEqual(a, b);
      } catch {
        return false;
      }
    }
    // Legacy fallback (older internal tests)
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = signatureHeader.replace(/^sha256=/i, '').trim();
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(provided);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
  private safeError(error: unknown): string {
    if (error instanceof Error) {
      return error.name;
    }
    return 'unknown';
  }
}
