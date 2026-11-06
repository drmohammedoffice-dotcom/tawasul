import {

  Body,

  Controller,

  Get,

  Headers,

  Param,

  Post,

  Req,

  UnauthorizedException,

  UseGuards

} from '@nestjs/common';

import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { ok } from '../../common/http/api-response';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { JwtPayload } from '../auth/types/jwt-payload.type';

import { AppConfigService } from '../config/app-config.service';

import { VideoStreamService } from './video-stream.service';



class CreateStreamUploadDto {

  @IsOptional()

  @IsInt()

  @Min(1)

  @Max(600)

  maxDurationSeconds?: number;

}



@Controller('video')

export class VideoStreamController {

  constructor(

    private readonly videoStreamService: VideoStreamService,

    private readonly config: AppConfigService

  ) {}



  @Get('stream/status')

  getStreamSetupStatus() {

    const status = this.videoStreamService.getSetupStatus();

    return ok('Stream setup status', {

      ...status,

      provider: this.config.videoStorageProvider,

      webhookConfigured: Boolean(this.config.cloudflareStreamWebhookSecret)

    });

  }



  @UseGuards(JwtAuthGuard)

  @Post('stream/direct-upload')

  async createDirectUpload(

    @Req() req: { user: JwtPayload },

    @Body() dto: CreateStreamUploadDto

  ) {

    const result = await this.videoStreamService.createDirectUpload(req.user.sub, dto);

    return ok('Stream direct upload created', result);

  }



  @UseGuards(JwtAuthGuard)

  @Post('stream/:mediaId/refresh')

  async refresh(@Req() req: { user: JwtPayload }, @Param('mediaId') mediaId: string) {

    const result = await this.videoStreamService.refreshProcessingStatus(req.user.sub, mediaId);

    return ok('Processing status refreshed', result);

  }



  @UseGuards(JwtAuthGuard)

  @Post('stream/:mediaId/retry')

  async retry(@Req() req: { user: JwtPayload }, @Param('mediaId') mediaId: string) {

    const result = await this.videoStreamService.retryProcessing(req.user.sub, mediaId);

    return ok('Processing retry requested', result);

  }



  @Post('stream/webhook')

  async webhook(

    @Req() req: { body: unknown; rawBody?: Buffer },

    @Headers('webhook-signature') signature: string | undefined

  ) {

    const secret = this.config.cloudflareStreamWebhookSecret;

    if (!secret) {

      throw new UnauthorizedException({

        code: 'missing_webhook_secret',

        message: 'Stream webhook secret is not configured. Set CLOUDFLARE_STREAM_WEBHOOK_SECRET.'

      });

    }



    // Cloudflare signs the exact raw body bytes. Prefer Nest rawBody when enabled.

    const raw =

      req.rawBody && Buffer.isBuffer(req.rawBody)

        ? req.rawBody.toString('utf8')

        : JSON.stringify(req.body ?? {});



    if (!this.videoStreamService.verifyWebhookSignature(raw, signature)) {

      throw new UnauthorizedException('Invalid Stream webhook signature');

    }



    const body = (typeof req.body === 'object' && req.body ? req.body : JSON.parse(raw || '{}')) as {

      uid?: string;

      status?: { state?: string };

      readyToStream?: boolean;

    };

    const uid = body.uid;

    if (!uid) {

      return ok('ignored', { accepted: false });

    }

    const ready = body.readyToStream === true || body.status?.state === 'ready';

    const failed = body.status?.state === 'error';

    if (ready) {

      await this.videoStreamService.markReadyByStreamUid(uid, 'ready');

    } else if (failed) {

      await this.videoStreamService.markReadyByStreamUid(uid, 'failed');

    }

    return ok('webhook processed', { uid, ready, failed });

  }

}


