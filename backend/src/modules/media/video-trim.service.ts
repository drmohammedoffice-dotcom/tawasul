import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MediaStorageService } from './media.storage';

const MAX_CLIP_SECONDS = 60;

@Injectable()
export class VideoTrimService {
  private readonly logger = new Logger(VideoTrimService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService
  ) {}

  ffmpegAvailable(): boolean {
    return Boolean(this.resolveFfmpegBin());
  }

  status() {
    const bin = this.resolveFfmpegBin();
    return {
      available: Boolean(bin),
      binary: bin ? 'ffmpeg' : null,
      maxClipSeconds: MAX_CLIP_SECONDS,
      note: bin
        ? 'Server-side trim via FFmpeg is available.'
        : 'FFmpeg binary not found on PATH — install FFmpeg to enable server trim.'
    };
  }

  /**
   * Trim an uploaded video owned by the user into a new media asset ≤ 60s.
   * Validates duration with ffprobe; refuses to claim success without a valid output file.
   */
  async trimOwnedVideo(
    userId: string,
    input: { mediaId: string; startSeconds: number; endSeconds: number }
  ) {
    const bin = this.resolveFfmpegBin();
    if (!bin) {
      throw new ServiceUnavailableException('ffmpeg not available on server');
    }

    const start = Number(input.startSeconds);
    const end = Number(input.endSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new BadRequestException('invalid trim range');
    }
    const clip = end - start;
    if (clip > MAX_CLIP_SECONDS + 0.05) {
      throw new BadRequestException(`clip must be ${MAX_CLIP_SECONDS} seconds or less`);
    }

    const media = await this.prisma.mediaAsset.findFirst({
      where: {
        id: input.mediaId,
        uploaderId: userId,
        deletedAt: null,
        mediaType: 'video',
        uploadCompletedAt: { not: null }
      }
    });
    if (!media) throw new NotFoundException('video media not found');

    const workDir = join(tmpdir(), `sc-trim-${randomUUID()}`);
    const inPath = join(workDir, 'in.bin');
    const outPath = join(workDir, 'out.mp4');
    await fs.mkdir(workDir, { recursive: true });

    try {
      const buf = await this.storage.readLocalFile(media.storageKey).catch(async () => {
        // Local driver path; for remote, re-download via signed URL if needed.
        const url = await this.storage.createReadUrl(media.id, media.storageKey);
        const res = await fetch(url.startsWith('http') ? url : `http://127.0.0.1:${process.env.PORT || 3000}${url}`);
        if (!res.ok) throw new BadRequestException('unable to read source video');
        return Buffer.from(await res.arrayBuffer());
      });
      await fs.writeFile(inPath, buf);

      const duration = await this.probeDuration(bin, inPath);
      if (end > duration + 0.25) {
        throw new BadRequestException('trim end exceeds source duration');
      }

      await this.runFfmpeg(bin, [
        '-y',
        '-ss',
        String(start),
        '-i',
        inPath,
        '-t',
        String(clip),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        outPath
      ]);

      const st = await fs.stat(outPath);
      if (!st.isFile() || st.size < 64) {
        throw new BadRequestException('trim produced invalid output');
      }

      const outId = randomUUID().replace(/-/g, '').slice(0, 24);
      const ticket = await this.storage.createUploadTicket({
        mediaId: outId,
        mimeType: 'video/mp4',
        fileName: `trim-${outId}.mp4`,
        uploaderId: userId,
        purpose: media.purpose || 'reel'
      });

      const outBuf = await fs.readFile(outPath);
      await this.storage.persistLocalFile(ticket.storageKey, outBuf);

      const created = await this.prisma.mediaAsset.create({
        data: {
          id: outId,
          uploaderId: userId,
          storageProvider: ticket.provider,
          bucket: ticket.bucket ?? null,
          storageKey: ticket.storageKey,
          originalFileName: `trim-${outId}.mp4`,
          mimeType: 'video/mp4',
          mediaType: 'video',
          purpose: media.purpose || 'reel',
          sizeBytes: outBuf.length,
          encryptedFileKey: 'public-unencrypted',
          processingStatus: 'ready',
          visibility: 'private',
          uploadCompletedAt: new Date(),
          durationSeconds: clip
        }
      });

      return {
        mediaId: created.id,
        durationSeconds: clip,
        sizeBytes: created.sizeBytes,
        processingStatus: created.processingStatus
      };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private resolveFfmpegBin(): string | null {
    const pathEnv = process.env.PATH || '';
    if (pathEnv.toLowerCase().includes('ffmpeg') || process.platform !== 'win32') {
      return 'ffmpeg';
    }
    const winPaths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
      join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe')
    ];
    for (const p of winPaths) {
      if (p && existsSync(p)) return p;
    }
    // Prefer bare name — Node spawn uses PATH (refreshed after install).
    return 'ffmpeg';
  }

  private probeDuration(bin: string, filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath
      ];
      // ffprobe next to ffmpeg
      const probe = bin.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
      const child = spawn(existsSync(probe) ? probe : 'ffprobe', args, { windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += String(d)));
      child.stderr.on('data', (d) => (err += String(d)));
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        const n = Number(out.trim());
        if (code === 0 && Number.isFinite(n) && n > 0) resolve(n);
        else reject(new BadRequestException(`unable to probe duration${err ? ': probe failed' : ''}`));
      });
    });
  }

  private runFfmpeg(bin: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.log(`ffmpeg trim start args=${args.filter((a) => a !== args[args.indexOf('-i') + 1]).join(' ')}`);
      const child = spawn(bin, args, { windowsHide: true });
      let err = '';
      child.stderr.on('data', (d) => {
        err += String(d);
        if (err.length > 4000) err = err.slice(-4000);
      });
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new BadRequestException('ffmpeg trim failed'));
      });
    });
  }
}
