import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  BadRequestException,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import type { Request, Response } from 'express';
import { ok } from '../../common/http/api-response';
import { AuditLogService } from '../audit/audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { AppConfigService } from '../config/app-config.service';
import { SecurityRateLimitService } from '../security/security-rate-limit.service';
import { AttachMediaDto } from './dto/attach-media.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateUploadDto } from './dto/create-upload.dto';
import { MediaService } from './media.service';
import { VideoTrimService } from './video-trim.service';

@Controller('media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly videoTrim: VideoTrimService,
    private readonly auditLogService: AuditLogService,
    private readonly securityRateLimitService: SecurityRateLimitService,
    private readonly configService: AppConfigService
  ) {}

  @Get('trim/status')
  trimStatus() {
    return ok('Video trim status', this.videoTrim.status());
  }

  @UseGuards(JwtAuthGuard)
  @Post('trim')
  async trimVideo(
    @Req() req: { user: JwtPayload; ip?: string },
    @Body()
    body: { mediaId: string; startSeconds: number; endSeconds: number }
  ) {
    await this.securityRateLimitService.consumeLimit({
      ip: req.ip ?? 'unknown',
      scope: 'media.trim',
      windowSeconds: this.configService.rateLimitWindowSeconds,
      maxRequests: Math.max(10, Math.floor(this.configService.rateLimitMaxRequests / 4)),
      blockSeconds: this.configService.rateLimitIpBlockSeconds
    });
    const result = await this.videoTrim.trimOwnedVideo(req.user.sub, body);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'media.trim',
      resourceType: 'media',
      resourceId: result.mediaId,
      outcome: 'success',
      metadata: { sourceMediaId: body.mediaId, durationSeconds: result.durationSeconds }
    });
    return ok('Video trimmed', result);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload-ticket')
  async createUploadTicket(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: CreateUploadDto) {
    await this.securityRateLimitService.consumeLimit({
      ip: req.ip ?? 'unknown',
      scope: 'media.upload-ticket',
      windowSeconds: this.configService.rateLimitWindowSeconds,
      maxRequests: this.configService.rateLimitMaxRequests,
      blockSeconds: this.configService.rateLimitIpBlockSeconds
    });
    const result = await this.mediaService.createUpload(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: result.instant ? 'media.upload-instant' : 'media.upload-ticket',
      resourceType: 'media',
      resourceId: result.media.id,
      outcome: 'success',
      metadata: {
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        instant: result.instant,
        contentHash: dto.contentHash
      }
    });
    return ok(result.instant ? 'Instant upload (deduplicated)' : 'Upload ticket created', result);
  }

  @UseGuards(JwtAuthGuard)
  @Post('complete')
  async completeUpload(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: CompleteUploadDto) {
    const media = await this.mediaService.completeUpload(req.user.sub, dto.mediaId, {
      ...(dto.durationSeconds != null ? { durationSeconds: dto.durationSeconds } : {}),
      ...(dto.contentHash ? { contentHash: dto.contentHash } : {})
    });
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'media.complete',
      resourceType: 'media',
      resourceId: dto.mediaId,
      outcome: 'success'
    });
    return ok('Upload marked completed', media);
  }

  /** Alias for complete — Confirm Upload in the R2 dedup workflow. */
  @UseGuards(JwtAuthGuard)
  @Post('confirm')
  async confirmUpload(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: CompleteUploadDto) {
    return this.completeUpload(req, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('attach')
  async attachMedia(@Req() req: { user: JwtPayload; ip?: string }, @Body() dto: AttachMediaDto) {
    const result = await this.mediaService.attachToMessage(req.user.sub, dto);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'media.attach',
      resourceType: 'message_media',
      resourceId: `${dto.messageId}:${dto.mediaId}`,
      outcome: 'success'
    });
    return ok('Media attached to message', result);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':mediaId/url')
  async getSecureUrl(@Req() req: { user: JwtPayload }, @Param('mediaId') mediaId: string) {
    const result = await this.mediaService.generateSecureReadUrl(req.user.sub, mediaId);
    return ok('Secure media URL generated', result);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':mediaId/delete')
  async deleteMedia(@Req() req: { user: JwtPayload; ip?: string }, @Param('mediaId') mediaId: string) {
    const result = await this.mediaService.deleteMedia(req.user.sub, mediaId);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'media.delete',
      resourceType: 'media',
      resourceId: mediaId,
      outcome: 'success'
    });
    return ok('Media deleted', result);
  }

  @Post('local-upload/:mediaId')
  @UseInterceptors(FileInterceptor('file'))
  async localUpload(
    @Req() req: { ip?: string },
    @Param('mediaId') mediaId: string,
    @Query('token') token: string,
    @UploadedFile() file: { buffer: Buffer } | undefined
  ) {
    await this.securityRateLimitService.assertIpAllowed(req.ip ?? 'unknown');
    await this.securityRateLimitService.consumeLimit({
      ip: req.ip ?? 'unknown',
      scope: 'media.local-upload',
      windowSeconds: this.configService.rateLimitWindowSeconds,
      maxRequests: Math.max(30, Math.floor(this.configService.rateLimitMaxRequests / 2)),
      blockSeconds: this.configService.rateLimitIpBlockSeconds
    });
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const { storageKey, mimeType } = await this.mediaService.resolveLocalUploadKey(mediaId, token);
    await this.mediaService.saveLocalUpload(storageKey, file.buffer, mimeType);
    await this.auditLogService.record({
      actorIp: 'local-upload',
      action: 'media.local-upload',
      resourceType: 'media',
      resourceId: mediaId,
      outcome: 'success'
    });
    return ok('Local upload completed', { mediaId });
  }

  @Get('local-file/:mediaId')
  async localRead(
    @Req() req: Request & { ip?: string },
    @Param('mediaId') mediaId: string,
    @Query('token') token: string,
    @Res() res: Response
  ) {
    await this.securityRateLimitService.assertIpAllowed(req.ip ?? 'unknown');
    await this.securityRateLimitService.consumeLimit({
      ip: req.ip ?? 'unknown',
      scope: 'media.local-read',
      windowSeconds: this.configService.rateLimitWindowSeconds,
      maxRequests: this.configService.rateLimitMaxRequests,
      blockSeconds: this.configService.rateLimitIpBlockSeconds
    });
    const resolved = await this.mediaService.resolveLocalFileRequest(mediaId, token);
    if (resolved.kind === 'redirect') {
      res.setHeader('Cache-Control', 'private, max-age=30');
      return res.redirect(302, resolved.url);
    }
    const file = resolved;
    // Allow embedding from the SPA origin (signed URL already authorizes access).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', file.mimeType);

    const size = file.sizeBytes;
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
      if (!m) {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${size}`);
        return res.end();
      }
      let start = m[1] !== '' ? Number(m[1]) : 0;
      let end = m[2] !== '' ? Number(m[2]) : size - 1;
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= size) end = size - 1;
      if (start >= size || start > end) {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${size}`);
        return res.end();
      }
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(chunkSize));
      return createReadStream(file.absolutePath, { start, end }).pipe(res);
    }

    res.setHeader('Content-Length', String(size));
    return createReadStream(file.absolutePath).pipe(res);
  }
}
