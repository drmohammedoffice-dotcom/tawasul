import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { MediaProcessingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { AppConfigService } from '../config/app-config.service';
import { CreateUploadDto } from './dto/create-upload.dto';
import { AttachMediaDto } from './dto/attach-media.dto';
import { MediaStorageService } from './media.storage';
import { MediaEntity } from './entities/media.entity';
import { FeatureGateService } from '../monetization/feature-gate.service';
import { assertAllowedMime } from './storage/media-storage.types';
import { assertMagicMatchesMime } from './file-signature';

const PUBLICISH_PURPOSES = new Set(['avatar', 'cover', 'sticker']);

export function extractStoredMediaId(raw?: string | null): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const mediaRef = /^media:([a-z0-9]+)$/i.exec(value);
  if (mediaRef?.[1]) return mediaRef[1];
  const localFile = /\/api\/media\/local-file\/([a-z0-9]+)/i.exec(value);
  if (localFile?.[1]) return localFile[1];
  try {
    if (/^https?:\/\//i.test(value)) {
      const u = new URL(value);
      const fromPath = /\/api\/media\/local-file\/([a-z0-9]+)/i.exec(u.pathname);
      if (fromPath?.[1]) return fromPath[1];
      // R2/S3 object path …/purpose/{mediaId}/filename
      const objectId = /\/(?:avatar|cover|sticker|post|reel|chat|general)\/([a-z0-9]{20,})(?:\/|$)/i.exec(
        u.pathname
      );
      if (objectId?.[1]) return objectId[1];
    }
  } catch {
    /* ignore */
  }
  return null;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService,
    private readonly messagingService: MessagingService,
    private readonly config: AppConfigService,
    private readonly featureGateService: FeatureGateService
  ) {}

  async createUpload(uploaderId: string, dto: CreateUploadDto) {
    try {
      assertAllowedMime(dto.mediaType, dto.mimeType);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid mime type');
    }
    await this.featureGateService.assertCanUploadFile(uploaderId, dto.sizeBytes);

    const contentHash = dto.contentHash.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      throw new BadRequestException('contentHash must be a 64-char SHA-256 hex digest');
    }

    const purpose = dto.purpose ?? 'general';
    const allowClientPublic = PUBLICISH_PURPOSES.has(purpose);
    // Avatars/covers must be readable by other users' feeds without a private gate.
    const visibility = allowClientPublic
      ? dto.visibility === 'private'
        ? 'private'
        : 'public'
      : 'private';

    const instant = await this.tryInstantDedup(uploaderId, dto, contentHash, purpose, visibility);
    if (instant) {
      return instant;
    }

    const mediaId = randomUUID().replace(/-/g, '').slice(0, 24);
    const ticket = await this.storage.createUploadTicket({
      mediaId,
      mimeType: dto.mimeType,
      fileName: dto.fileName,
      uploaderId,
      purpose
    });

    const media = await this.prisma.mediaAsset.create({
      data: {
        id: mediaId,
        uploaderId,
        storageProvider: ticket.provider,
        bucket: ticket.bucket ?? null,
        storageKey: ticket.storageKey,
        originalFileName: dto.fileName,
        mimeType: dto.mimeType,
        mediaType: dto.mediaType,
        purpose,
        sizeBytes: dto.sizeBytes,
        encryptedFileKey: dto.encryptedFileKey?.trim() || 'public-unencrypted',
        contentHash,
        processingStatus: 'pending',
        visibility
      }
    });

    return {
      instant: false as const,
      media: this.toEntity(media),
      upload: {
        url: ticket.uploadUrl,
        method: ticket.method,
        headers: ticket.headers ?? {}
      }
    };
  }

  private async tryInstantDedup(
    uploaderId: string,
    dto: CreateUploadDto,
    contentHash: string,
    purpose: string,
    visibility: string
  ) {
    const existing = await this.prisma.mediaAsset.findFirst({
      where: {
        contentHash,
        deletedAt: null,
        uploadCompletedAt: { not: null },
        processingStatus: {
          in: [MediaProcessingStatus.ready, MediaProcessingStatus.uploaded, MediaProcessingStatus.processing]
        }
      },
      orderBy: { createdAt: 'asc' }
    });
    if (!existing) return null;

    // Same uploader already owns a completed copy — reuse that row.
    if (existing.uploaderId === uploaderId) {
      return {
        instant: true as const,
        media: this.toEntity(existing),
        upload: null
      };
    }

    const mediaId = randomUUID().replace(/-/g, '').slice(0, 24);
    const cloned = await this.prisma.mediaAsset.create({
      data: {
        id: mediaId,
        uploaderId,
        storageProvider: existing.storageProvider,
        bucket: existing.bucket,
        storageKey: existing.storageKey,
        originalFileName: dto.fileName || existing.originalFileName,
        mimeType: existing.mimeType,
        mediaType: dto.mediaType || existing.mediaType,
        purpose,
        sizeBytes: existing.sizeBytes,
        encryptedFileKey: dto.encryptedFileKey?.trim() || 'public-unencrypted',
        contentHash,
        checksum: existing.checksum,
        width: existing.width,
        height: existing.height,
        durationSeconds: existing.durationSeconds,
        thumbnailKey: existing.thumbnailKey,
        streamUid: existing.streamUid,
        processingStatus:
          existing.processingStatus === MediaProcessingStatus.processing
            ? MediaProcessingStatus.processing
            : MediaProcessingStatus.ready,
        visibility,
        uploadCompletedAt: existing.uploadCompletedAt ?? new Date()
      }
    });

    return {
      instant: true as const,
      media: this.toEntity(cloned),
      upload: null
    };
  }

  async completeUpload(
    userId: string,
    mediaId: string,
    opts?: { durationSeconds?: number; contentHash?: string }
  ): Promise<MediaEntity> {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media || media.deletedAt) {
      throw new NotFoundException('media not found');
    }
    if (media.uploaderId !== userId) {
      throw new ForbiddenException('only uploader can complete upload');
    }

    if (media.uploadCompletedAt && media.processingStatus !== MediaProcessingStatus.pending) {
      return this.toEntity(media);
    }

    const incomingHash = opts?.contentHash?.trim().toLowerCase();
    if (media.contentHash) {
      if (incomingHash && incomingHash !== media.contentHash) {
        throw new BadRequestException('contentHash does not match upload ticket');
      }
    } else if (incomingHash) {
      if (!/^[a-f0-9]{64}$/.test(incomingHash)) {
        throw new BadRequestException('contentHash must be a 64-char SHA-256 hex digest');
      }
    }

    const objectMeta = await this.storage.getObjectMetadata(media.storageKey);
    if (!objectMeta.exists) {
      throw new BadRequestException('uploaded object not found in storage');
    }
    if (objectMeta.sizeBytes !== undefined && objectMeta.sizeBytes > media.sizeBytes) {
      throw new BadRequestException('uploaded object exceeds declared size');
    }
    if (objectMeta.contentType && objectMeta.contentType.toLowerCase() !== media.mimeType.toLowerCase()) {
      const declared = media.mimeType.toLowerCase().split(';')[0]?.trim();
      const actual = objectMeta.contentType.toLowerCase().split(';')[0]?.trim();
      if (declared && actual && declared !== actual) {
        throw new BadRequestException('uploaded object mime mismatch');
      }
    }

    const processingStatus = this.resolveStatusAfterUploadComplete(media);
    const durationSeconds =
      opts?.durationSeconds != null && Number.isFinite(opts.durationSeconds)
        ? Math.min(600, Math.max(0.1, opts.durationSeconds))
        : undefined;
    const contentHash = media.contentHash || incomingHash || null;
    const updated = await this.prisma.mediaAsset.update({
      where: { id: mediaId },
      data: {
        uploadCompletedAt: new Date(),
        processingStatus,
        sizeBytes: objectMeta.sizeBytes ?? media.sizeBytes,
        checksum: objectMeta.etag ?? null,
        contentHash,
        ...(durationSeconds != null ? { durationSeconds } : {})
      }
    });
    return this.toEntity(updated);
  }

  /**
   * Videos only stay in `processing` when bound to Cloudflare Stream (streamUid).
   * Local/R2 originals become `ready` immediately so they never hang forever.
   */
  private resolveStatusAfterUploadComplete(media: {
    mediaType: string;
    streamUid: string | null;
  }): 'ready' | 'processing' {
    if (media.mediaType !== 'video') {
      return 'ready';
    }
    if (media.streamUid) {
      return 'processing';
    }
    return 'ready';
  }

  async deleteMedia(userId: string, mediaId: string) {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media || media.deletedAt) {
      throw new NotFoundException('media not found');
    }
    if (media.uploaderId !== userId) {
      throw new ForbiddenException('only owner can delete media');
    }
    await this.prisma.mediaAsset.update({
      where: { id: mediaId },
      data: { deletedAt: new Date(), processingStatus: 'deleted' }
    });

    const remaining = await this.prisma.mediaAsset.count({
      where: {
        storageKey: media.storageKey,
        deletedAt: null
      }
    });
    if (remaining === 0) {
      await this.storage.deleteObject(media.storageKey);
    }
    return { mediaId, deleted: true };
  }

  async attachToMessage(userId: string, dto: AttachMediaDto) {
    const message = await this.messagingService.getMessageById(dto.messageId);
    if (message.senderId !== userId && message.receiverId !== userId) {
      throw new ForbiddenException('not authorized for this message');
    }

    const media = await this.prisma.mediaAsset.findUnique({ where: { id: dto.mediaId } });
    if (!media || media.deletedAt) {
      throw new NotFoundException('media not found');
    }
    if (media.uploaderId !== userId) {
      throw new ForbiddenException('only the media uploader can attach this file');
    }
    if (!media.uploadCompletedAt) {
      throw new BadRequestException('media upload not completed');
    }

    await this.prisma.messageMedia.upsert({
      where: {
        messageId_mediaId: {
          messageId: dto.messageId,
          mediaId: dto.mediaId
        }
      },
      create: {
        messageId: dto.messageId,
        mediaId: dto.mediaId
      },
      update: {}
    });

    return {
      messageId: dto.messageId,
      mediaId: dto.mediaId,
      encryptedFileKey: media.encryptedFileKey
    };
  }

  async generateSecureReadUrl(userId: string, mediaId: string) {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media || media.deletedAt) {
      throw new NotFoundException('media not found');
    }

    const publicPurposes = new Set(['avatar', 'cover', 'sticker']);
    if (media.visibility === 'public' && publicPurposes.has(media.purpose || '')) {
      return this.mintRead(media);
    }

    const dmLinked = await this.prisma.messageMedia.findFirst({
      where: {
        mediaId,
        message: {
          OR: [{ senderId: userId }, { receiverId: userId }]
        }
      }
    });
    if (dmLinked) return this.mintRead(media);

    // Social content: media bytes only after APPROVED/RESTORED — even for the uploader/owner.
    const postLinked = await this.prisma.postMedia.findFirst({
      where: { mediaId, post: { deletedAt: null, archivedAt: null } },
      include: {
        post: {
          select: {
            authorId: true,
            moderationStatus: true,
            author: { select: { id: true, isPrivate: true } }
          }
        }
      }
    });
    if (postLinked?.post) {
      const st = postLinked.post.moderationStatus || 'PENDING_REVIEW';
      if (st !== 'APPROVED' && st !== 'RESTORED') {
        throw new NotFoundException('media not found');
      }
      if (await this.canEngageAuthor(userId, postLinked.post.author)) {
        return this.mintRead(media);
      }
      throw new NotFoundException('media not found');
    }

    const reel = await this.prisma.reel.findFirst({
      where: {
        deletedAt: null,
        archivedAt: null,
        OR: [{ mediaId }, { thumbnailMediaId: mediaId }]
      },
      include: { author: { select: { id: true, isPrivate: true } } }
    });
    if (reel) {
      const st = reel.moderationStatus || 'PENDING_REVIEW';
      if (st !== 'APPROVED' && st !== 'RESTORED') {
        throw new NotFoundException('media not found');
      }
      if (await this.canEngageAuthor(userId, reel.author)) {
        return this.mintRead(media);
      }
      throw new NotFoundException('media not found');
    }

    const story = await this.prisma.story.findFirst({
      where: { mediaId, deletedAt: null, expiresAt: { gt: new Date() } },
      include: { author: { select: { id: true, isPrivate: true } } }
    });
    if (story) {
      const st = story.moderationStatus || 'PENDING_REVIEW';
      if (st !== 'APPROVED' && st !== 'RESTORED') {
        throw new NotFoundException('media not found');
      }
      if (story.audience === 'close_friends' && story.authorId !== userId) {
        const cf = await this.prisma.closeFriend.findUnique({
          where: { ownerId_friendId: { ownerId: story.authorId, friendId: userId } }
        });
        if (!cf) throw new ForbiddenException('not authorized to access this media');
      }
      if (await this.canEngageAuthor(userId, story.author)) {
        return this.mintRead(media);
      }
      throw new NotFoundException('media not found');
    }

    // Unlinked upload still owned by user (draft before attach) — allow owner only.
    if (media.uploaderId === userId) {
      return this.mintRead(media);
    }

    const highlightItem = await this.prisma.storyHighlightItem.findFirst({
      where: { mediaId },
      include: {
        highlight: {
          include: { user: { select: { id: true, isPrivate: true } } }
        }
      }
    });
    if (highlightItem?.highlight?.user) {
      if (await this.canEngageAuthor(userId, highlightItem.highlight.user)) {
        return this.mintRead(media);
      }
    }

    const verificationDoc = await this.prisma.verificationDocument.findFirst({
      where: { mediaId },
      include: { request: { select: { userId: true } } }
    });
    if (verificationDoc) {
      if (verificationDoc.request.userId === userId) return this.mintRead(media);
      const admin = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true }
      });
      if (admin?.role === 'admin') return this.mintRead(media);
      throw new ForbiddenException('not authorized to access this media');
    }

    throw new ForbiddenException('not authorized to access this media');
  }

  private async mintRead(media: { id: string; storageKey: string }) {
    const secureUrl = await this.storage.createReadUrl(media.id, media.storageKey);
    return {
      mediaId: media.id,
      secureUrl,
      expiresInSeconds: this.config.mediaSignedUrlTtlSeconds
    };
  }

  private async canEngageAuthor(
    viewerId: string,
    author: { id: string; isPrivate: boolean }
  ): Promise<boolean> {
    if (viewerId === author.id) return true;
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: author.id },
          { blockerId: author.id, blockedId: viewerId }
        ]
      }
    });
    if (blocked) return false;
    if (!author.isPrivate) return true;
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId: viewerId, followingId: author.id }
      }
    });
    return Boolean(follow && follow.status === 'accepted');
  }

  async resolveLocalUploadKey(
    mediaId: string,
    token: string
  ): Promise<{ storageKey: string; mimeType: string }> {
    const storageKey = await this.storage.getValidatedLocalUploadStorageKey(mediaId, token);
    if (!storageKey) {
      throw new ForbiddenException('invalid or expired upload token');
    }
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media || media.deletedAt) {
      throw new NotFoundException('media not found');
    }
    return { storageKey, mimeType: media.mimeType };
  }

  async resolveLocalRead(mediaId: string, token: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const storageKey = await this.storage.getValidatedLocalReadStorageKey(mediaId, token);
    if (!storageKey) {
      throw new ForbiddenException('invalid or expired read token');
    }
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('media not found');
    }
    const buffer = await this.storage.readLocalFile(storageKey);
    return { buffer, mimeType: media.mimeType };
  }

  /** Streamable local file info (supports HTTP Range seeking in players). */
  async resolveLocalReadFile(
    mediaId: string,
    token: string
  ): Promise<{ absolutePath: string; mimeType: string; sizeBytes: number }> {
    const storageKey = await this.storage.getValidatedLocalReadStorageKey(mediaId, token);
    if (!storageKey) {
      throw new ForbiddenException('invalid or expired read token');
    }
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('media not found');
    }
    const absolutePath = this.storage.resolveLocalAbsolutePath(storageKey);
    const meta = await this.storage.getObjectMetadata(storageKey);
    if (!meta.exists || !meta.sizeBytes) {
      throw new NotFoundException('media file missing');
    }
    return { absolutePath, mimeType: media.mimeType, sizeBytes: meta.sizeBytes };
  }

  /**
   * Serve legacy /api/media/local-file links after switching to R2:
   * 1) stream from local disk when the object still exists there
   * 2) otherwise redirect to a fresh signed R2/S3 URL for publicish media
   */
  async resolveLocalFileRequest(
    mediaId: string,
    token?: string
  ): Promise<
    | { kind: 'file'; absolutePath: string; mimeType: string; sizeBytes: number }
    | { kind: 'redirect'; url: string }
  > {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media || media.deletedAt) {
      throw new NotFoundException('media not found');
    }

    const publicish =
      media.visibility === 'public' || PUBLICISH_PURPOSES.has(String(media.purpose || ''));

    if (this.storage.driver === 'local') {
      return {
        kind: 'file',
        ...(await this.resolveLocalReadFile(mediaId, String(token || '')))
      };
    }

    const localPath = this.safeLocalAbsolutePath(media.storageKey);
    if (localPath) {
      // Public avatars/covers may omit a token; private objects require a Redis capability token.
      if (!publicish) {
        const storageKey = await this.storage.getValidatedLocalReadStorageKey(
          mediaId,
          String(token || '')
        );
        if (!storageKey || storageKey !== media.storageKey) {
          throw new ForbiddenException('invalid or expired read token');
        }
      }
      const st = statSync(localPath);
      return {
        kind: 'file',
        absolutePath: localPath,
        mimeType: media.mimeType,
        sizeBytes: st.size
      };
    }

    if (!publicish) {
      throw new ForbiddenException('local read not available for private remote media');
    }
    const url = await this.storage.createReadUrl(media.id, media.storageKey);
    return { kind: 'redirect', url };
  }

  /** Resolve persisted avatar/cover refs (`media:id`, local-file, stale signed URLs). */
  async resolveStoredUserMediaUrl(raw?: string | null): Promise<string | null> {
    if (!raw) return null;
    const mediaId = extractStoredMediaId(raw);
    if (!mediaId) {
      // Absolute non-local URL (may still be a short-lived signed link).
      if (/^https?:\/\//i.test(raw) && !/local-file/i.test(raw)) return raw;
      return raw.startsWith('/') ? raw : null;
    }
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media || media.deletedAt) return null;
    const localPath = this.safeLocalAbsolutePath(media.storageKey);
    if (localPath) {
      // Prefer durable local-file links; always mint a Redis-backed capability token.
      try {
        return await this.storage.createReadUrl(media.id, media.storageKey);
      } catch {
        return null;
      }
    }
    try {
      return await this.storage.createReadUrl(media.id, media.storageKey);
    } catch {
      return null;
    }
  }

  async resolveStoredUserMediaUrls(rawUrls: Array<string | null | undefined>): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const unique = [...new Set(rawUrls.filter((v): v is string => Boolean(v && String(v).trim())))];
    await Promise.all(
      unique.map(async (raw) => {
        out.set(raw, await this.resolveStoredUserMediaUrl(raw));
      })
    );
    return out;
  }

  normalizePersistedUserMediaRef(raw?: string | null, mediaIdHint?: string): string | null {
    if (mediaIdHint && /^[a-z0-9]+$/i.test(mediaIdHint)) return `media:${mediaIdHint}`;
    const id = extractStoredMediaId(raw);
    return id ? `media:${id}` : raw ? String(raw).slice(0, 2000) : null;
  }

  private safeLocalAbsolutePath(storageKey: string): string | null {
    try {
      const base = path.resolve(this.config.mediaLocalBasePath);
      const full = path.resolve(base, storageKey);
      if (!full.startsWith(base + path.sep) && full !== base) return null;
      if (!existsSync(full)) return null;
      const st = statSync(full);
      return st.isFile() ? full : null;
    } catch {
      return null;
    }
  }

  async saveLocalUpload(
    storageKey: string,
    fileBuffer: Buffer,
    expectedMime?: string
  ): Promise<void> {
    if (expectedMime) {
      assertMagicMatchesMime(fileBuffer, expectedMime);
    }
    // Soft cap: refuse absurd buffers even if ticket size was wrong.
    if (fileBuffer.length > 200 * 1024 * 1024) {
      throw new BadRequestException('upload exceeds hard size limit');
    }
    await this.storage.persistLocalFile(storageKey, fileBuffer);
  }

  private toEntity(media: {
    id: string;
    uploaderId: string;
    storageProvider: string;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
    encryptedFileKey: string;
    uploadCompletedAt: Date | null;
    createdAt: Date;
    processingStatus?: string;
    mediaType?: string;
    purpose?: string;
    visibility?: string;
    contentHash?: string | null;
  }): MediaEntity {
    const entity: MediaEntity = {
      id: media.id,
      uploaderId: media.uploaderId,
      storageProvider: media.storageProvider,
      originalFileName: media.originalFileName,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      encryptedFileKey: media.encryptedFileKey,
      uploadCompletedAt: media.uploadCompletedAt,
      createdAt: media.createdAt
    };
    if (media.processingStatus) entity.processingStatus = media.processingStatus;
    if (media.mediaType) entity.mediaType = media.mediaType;
    if (media.purpose) entity.purpose = media.purpose;
    if (media.visibility) entity.visibility = media.visibility;
    if (media.contentHash !== undefined) entity.contentHash = media.contentHash;
    return entity;
  }
}
