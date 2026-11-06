import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class R2ConfigValidator implements OnModuleInit {
  private readonly logger = new Logger(R2ConfigValidator.name);

  constructor(private readonly config: AppConfigService) {}

  onModuleInit() {
    if (this.config.mediaStorageDriver !== 'r2') {
      this.logger.log(`Media storage driver: ${this.config.mediaStorageDriver}`);
      return;
    }

    const missing: string[] = [];
    if (!this.config.resolvedMediaEndpoint) missing.push('CLOUDFLARE_R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID');
    if (!this.config.resolvedMediaBucket) missing.push('CLOUDFLARE_R2_BUCKET');
    if (!this.config.resolvedMediaAccessKeyId) missing.push('CLOUDFLARE_R2_ACCESS_KEY_ID');
    if (!this.config.resolvedMediaSecretAccessKey) missing.push('CLOUDFLARE_R2_SECRET_ACCESS_KEY');

    if (missing.length) {
      throw new Error(
        `MEDIA_STORAGE_DRIVER=r2 but missing Cloudflare config: ${missing.join(', ')}. ` +
          `See docs/social-platform/10-connect-cloudflare-ar.md`
      );
    }

    this.logger.log(
      `Cloudflare R2 enabled (bucket=${this.config.resolvedMediaBucket}, endpoint configured)`
    );
  }
}
