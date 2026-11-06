import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

type KeyRing = Map<string, string>;

/**
 * HS256 key ring with kid-based rotation.
 * Current key signs; current + previous keys verify.
 */
@Injectable()
export class JwtKeysService {
  private readonly accessKeys: KeyRing;
  private readonly refreshKeys: KeyRing;
  private readonly accessKid: string;
  private readonly refreshKid: string;

  constructor(private readonly config: AppConfigService) {
    this.accessKid = this.config.jwtAccessKid;
    this.refreshKid = this.config.jwtRefreshKid;
    this.accessKeys = this.buildRing(
      this.accessKid,
      this.config.jwtAccessSecret,
      this.config.jwtAccessPreviousKeys
    );
    this.refreshKeys = this.buildRing(
      this.refreshKid,
      this.config.jwtRefreshSecret,
      this.config.jwtRefreshPreviousKeys
    );
  }

  get issuer(): string {
    return this.config.jwtIssuer;
  }

  get audience(): string {
    return this.config.jwtAudience;
  }

  get currentAccessKid(): string {
    return this.accessKid;
  }

  get currentRefreshKid(): string {
    return this.refreshKid;
  }

  getAccessSecret(kid?: string): string | undefined {
    if (!kid) return this.accessKeys.get(this.accessKid);
    return this.accessKeys.get(kid);
  }

  getRefreshSecret(kid?: string): string | undefined {
    if (!kid) return this.refreshKeys.get(this.refreshKid);
    return this.refreshKeys.get(kid);
  }

  accessSignOptions() {
    return {
      secret: this.config.jwtAccessSecret,
      expiresIn: this.config.jwtAccessExpiresIn as never,
      algorithm: 'HS256' as const,
      issuer: this.issuer,
      audience: this.audience,
      keyid: this.accessKid
    };
  }

  refreshSignOptions() {
    return {
      secret: this.config.jwtRefreshSecret,
      expiresIn: this.config.jwtRefreshExpiresIn as never,
      algorithm: 'HS256' as const,
      issuer: this.issuer,
      audience: this.audience,
      keyid: this.refreshKid
    };
  }

  accessVerifyOptions(secret: string) {
    return {
      secret,
      algorithms: ['HS256'] as ('HS256')[],
      issuer: this.issuer,
      audience: this.audience
    };
  }

  refreshVerifyOptions(secret: string) {
    return {
      secret,
      algorithms: ['HS256'] as ('HS256')[],
      issuer: this.issuer,
      audience: this.audience
    };
  }

  private buildRing(
    currentKid: string,
    currentSecret: string,
    previous: Array<{ kid: string; secret: string }>
  ): KeyRing {
    const ring = new Map<string, string>();
    ring.set(currentKid, currentSecret);
    for (const prev of previous) {
      if (prev.kid && prev.secret && !ring.has(prev.kid)) {
        ring.set(prev.kid, prev.secret);
      }
    }
    return ring;
  }
}
