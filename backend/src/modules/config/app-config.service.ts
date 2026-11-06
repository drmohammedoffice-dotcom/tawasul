import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get nodeEnv(): string {
    return this.getOrThrow('NODE_ENV');
  }

  get port(): number {
    return Number(this.getOrThrow('PORT'));
  }

  get apiPrefix(): string {
    return this.getOrThrow('API_PREFIX');
  }

  get clientOrigin(): string {
    return this.getOrThrow('CLIENT_ORIGIN');
  }

  /** Explicit allowlist for browser CORS (comma-separated CLIENT_ORIGINS, else CLIENT_ORIGIN). */
  get clientOrigins(): string[] {
    const multi = this.configService.get<string>('CLIENT_ORIGINS');
    if (multi && multi.trim() !== '') {
      return multi
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [this.clientOrigin];
  }

  get postgresUrl(): string {
    return this.getOrThrow('POSTGRES_URL');
  }

  get redisUrl(): string {
    return this.getOrThrow('REDIS_URL');
  }

  get jwtAccessSecret(): string {
    return this.getOrThrow('JWT_ACCESS_SECRET');
  }

  get jwtRefreshSecret(): string {
    return this.getOrThrow('JWT_REFRESH_SECRET');
  }

  get jwtAccessExpiresIn(): string {
    return this.getOrThrow('JWT_ACCESS_EXPIRES_IN');
  }

  get jwtRefreshExpiresIn(): string {
    return this.getOrThrow('JWT_REFRESH_EXPIRES_IN');
  }

  get jwtIssuer(): string {
    return this.configService.get<string>('JWT_ISSUER')?.trim() || 'tawasul';
  }

  get jwtAudience(): string {
    return this.configService.get<string>('JWT_AUDIENCE')?.trim() || 'tawasul-api';
  }

  get jwtAccessKid(): string {
    return this.configService.get<string>('JWT_ACCESS_KID')?.trim() || 'v1';
  }

  get jwtRefreshKid(): string {
    return this.configService.get<string>('JWT_REFRESH_KID')?.trim() || 'v1';
  }

  /** Optional previous access keys for rotation: "kid:secret,kid2:secret2". */
  get jwtAccessPreviousKeys(): Array<{ kid: string; secret: string }> {
    return this.parseKeyRing(this.configService.get<string>('JWT_ACCESS_PREVIOUS_KEYS'));
  }

  get jwtRefreshPreviousKeys(): Array<{ kid: string; secret: string }> {
    return this.parseKeyRing(this.configService.get<string>('JWT_REFRESH_PREVIOUS_KEYS'));
  }

  get authLoginMaxAttempts(): number {
    return Number(this.getOrThrow('AUTH_LOGIN_MAX_ATTEMPTS'));
  }

  get authLoginWindowSeconds(): number {
    return Number(this.getOrThrow('AUTH_LOGIN_WINDOW_SECONDS'));
  }

  get authLoginBlockSeconds(): number {
    return Number(this.getOrThrow('AUTH_LOGIN_BLOCK_SECONDS'));
  }

  get authCookieEnabled(): boolean {
    return this.getBoolean('AUTH_COOKIE_ENABLED');
  }

  get authCookieSecure(): boolean {
    return this.getBoolean('AUTH_COOKIE_SECURE');
  }

  get authCookieSameSite(): 'lax' | 'strict' | 'none' {
    const sameSite = this.getOrThrow('AUTH_COOKIE_SAME_SITE');
    if (sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none') {
      return sameSite;
    }
    return 'lax';
  }

  get authCookieDomain(): string | undefined {
    const domain = this.configService.get<string>('AUTH_COOKIE_DOMAIN');
    return domain && domain.trim() !== '' ? domain : undefined;
  }

  get mediaStorageDriver(): 's3' | 'local' | 'r2' {
    const alias = this.configService.get<string>('MEDIA_STORAGE_PROVIDER');
    const raw = (alias && alias.trim() !== '' ? alias : this.getOrThrow('MEDIA_STORAGE_DRIVER'))
      .toLowerCase()
      .trim();
    if (raw === 'r2') return 'r2';
    if (raw === 's3') return 's3';
    return 'local';
  }

  get resolvedMediaEndpoint(): string | undefined {
    if (this.mediaStorageDriver === 'r2') {
      const explicit = this.configService.get<string>('CLOUDFLARE_R2_ENDPOINT');
      if (explicit && explicit.trim() !== '') return explicit.trim();
      const accountId = this.configService.get<string>('CLOUDFLARE_ACCOUNT_ID');
      if (accountId && accountId.trim() !== '') {
        return `https://${accountId.trim()}.r2.cloudflarestorage.com`;
      }
    }
    return this.mediaS3Endpoint;
  }

  get resolvedMediaRegion(): string {
    if (this.mediaStorageDriver === 'r2') return 'auto';
    return this.mediaS3Region;
  }

  get resolvedMediaBucket(): string {
    if (this.mediaStorageDriver === 'r2') {
      const bucket = this.configService.get<string>('CLOUDFLARE_R2_BUCKET');
      if (bucket && bucket.trim() !== '') return bucket.trim();
    }
    return this.mediaS3Bucket;
  }

  get resolvedMediaAccessKeyId(): string {
    if (this.mediaStorageDriver === 'r2') {
      const key = this.configService.get<string>('CLOUDFLARE_R2_ACCESS_KEY_ID');
      if (key && key.trim() !== '') return key.trim();
    }
    return this.mediaS3AccessKey;
  }

  get resolvedMediaSecretAccessKey(): string {
    if (this.mediaStorageDriver === 'r2') {
      const key = this.configService.get<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
      if (key && key.trim() !== '') return key.trim();
    }
    return this.mediaS3SecretKey;
  }

  get mediaForcePathStyle(): boolean {
    // Cloudflare R2 virtual-hosted URLs (bucket.account.r2...) often fail in browsers.
    // Always use path-style: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
    if (this.mediaStorageDriver === 'r2') return true;
    return this.mediaS3ForcePathStyle;
  }

  get mediaPublicBaseUrl(): string | undefined {
    const value = this.configService.get<string>('CLOUDFLARE_R2_PUBLIC_BASE_URL');
    return value && value.trim() !== '' ? value.trim() : undefined;
  }

  get mediaAllowPublicReads(): boolean {
    return this.getBoolean('MEDIA_ALLOW_PUBLIC_READS');
  }

  get videoStorageProvider(): 'local' | 'stream' | 'r2' {
    const value = this.configService.get<string>('VIDEO_STORAGE_PROVIDER') ?? 'local';
    if (value === 'stream' || value === 'r2') return value;
    return 'local';
  }

  get cloudflareStreamAccountId(): string | undefined {
    const value = this.configService.get<string>('CLOUDFLARE_STREAM_ACCOUNT_ID');
    return value && value.trim() !== '' ? value.trim() : undefined;
  }

  get cloudflareStreamApiToken(): string | undefined {
    const value = this.configService.get<string>('CLOUDFLARE_STREAM_API_TOKEN');
    return value && value.trim() !== '' ? value.trim() : undefined;
  }

  get cloudflareStreamCustomerDomain(): string | undefined {
    const value = this.configService.get<string>('CLOUDFLARE_STREAM_CUSTOMER_DOMAIN');
    return value && value.trim() !== '' ? value.trim() : undefined;
  }

  get cloudflareStreamWebhookSecret(): string | undefined {
    const value = this.configService.get<string>('CLOUDFLARE_STREAM_WEBHOOK_SECRET');
    return value && value.trim() !== '' ? value.trim() : undefined;
  }

  get mediaSignedUrlTtlSeconds(): number {
    return Number(this.getOrThrow('MEDIA_SIGNED_URL_TTL_SECONDS'));
  }

  get mediaLocalBasePath(): string {
    return this.getOrThrow('MEDIA_LOCAL_BASE_PATH');
  }

  get mediaS3Endpoint(): string | undefined {
    const endpoint = this.configService.get<string>('MEDIA_S3_ENDPOINT');
    return endpoint && endpoint.trim() !== '' ? endpoint : undefined;
  }

  get mediaS3Region(): string {
    return this.getOrThrow('MEDIA_S3_REGION');
  }

  get mediaS3Bucket(): string {
    return this.getOrThrow('MEDIA_S3_BUCKET');
  }

  get mediaS3AccessKey(): string {
    return this.getOrThrow('MEDIA_S3_ACCESS_KEY');
  }

  get mediaS3SecretKey(): string {
    return this.getOrThrow('MEDIA_S3_SECRET_KEY');
  }

  get mediaS3ForcePathStyle(): boolean {
    return this.getBoolean('MEDIA_S3_FORCE_PATH_STYLE');
  }

  get cacheDefaultTtlSeconds(): number {
    return Number(this.getOrThrow('CACHE_DEFAULT_TTL_SECONDS'));
  }

  get rateLimitWindowSeconds(): number {
    return Number(this.getOrThrow('RATE_LIMIT_WINDOW_SECONDS'));
  }

  get rateLimitMaxRequests(): number {
    return Number(this.getOrThrow('RATE_LIMIT_MAX_REQUESTS'));
  }

  get rateLimitAuthMaxRequests(): number {
    return Number(this.getOrThrow('RATE_LIMIT_AUTH_MAX_REQUESTS'));
  }

  get rateLimitWsMaxEvents(): number {
    return Number(this.getOrThrow('RATE_LIMIT_WS_MAX_EVENTS'));
  }

  get rateLimitIpBlockSeconds(): number {
    return Number(this.getOrThrow('RATE_LIMIT_IP_BLOCK_SECONDS'));
  }

  get freeMaxUploadBytes(): number {
    return Number(this.getOrThrow('FREE_MAX_UPLOAD_BYTES'));
  }

  get freeMaxOwnedGroups(): number {
    return Number(this.getOrThrow('FREE_MAX_OWNED_GROUPS'));
  }

  get freeMaxOwnedChannels(): number {
    return Number(this.getOrThrow('FREE_MAX_OWNED_CHANNELS'));
  }

  get premiumMaxUploadBytes(): number {
    return Number(this.getOrThrow('PREMIUM_MAX_UPLOAD_BYTES'));
  }

  get premiumMaxOwnedGroups(): number {
    return Number(this.getOrThrow('PREMIUM_MAX_OWNED_GROUPS'));
  }

  get premiumMaxOwnedChannels(): number {
    return Number(this.getOrThrow('PREMIUM_MAX_OWNED_CHANNELS'));
  }

  get rewardsMaxCoinsPerDay(): number {
    return Number(this.getOrThrow('REWARDS_MAX_COINS_PER_DAY'));
  }

  get miniGamesMaxPlaysPerDay(): number {
    return Number(this.getOrThrow('MINIGAMES_MAX_PLAYS_PER_DAY'));
  }

  get walletInternalToken(): string | undefined {
    const token = this.configService.get<string>('WALLET_INTERNAL_TOKEN');
    return token && token.trim() !== '' ? token : undefined;
  }

  get wsAllowedOrigins(): string[] {
    const raw = this.getOrThrow('WS_ALLOWED_ORIGINS');
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  /**
   * Dedicated OTP pepper.
   * Production: OTP_PEPPER is mandatory (no JWT-secret fallback).
   * Development: may fall back to JWT_ACCESS_SECRET with a clear console warning.
   */
  get otpPepper(): string {
    const dedicated = this.configService.get<string>('OTP_PEPPER');
    if (dedicated && dedicated.trim().length >= 16) return dedicated.trim();
    if (this.nodeEnv === 'production') {
      throw new Error(
        'OTP_PEPPER is required in production (min 16 chars). Refusing insecure JWT-secret fallback.'
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      '[security] OTP_PEPPER unset — using JWT_ACCESS_SECRET in development only. Set OTP_PEPPER before production.'
    );
    return this.getOrThrow('JWT_ACCESS_SECRET');
  }

  private parseKeyRing(raw?: string): Array<{ kid: string; secret: string }> {
    if (!raw || !raw.trim()) return [];
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf(':');
        if (idx <= 0) return null;
        const kid = part.slice(0, idx).trim();
        const secret = part.slice(idx + 1).trim();
        if (!kid || secret.length < 16) return null;
        return { kid, secret };
      })
      .filter((v): v is { kid: string; secret: string } => Boolean(v));
  }

  private getOrThrow(key: string): string {
    const value = this.configService.get<string | number | boolean>(key);
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required env key: ${key}`);
    }
    return String(value);
  }

  private getBoolean(key: string): boolean {
    const value = this.configService.get<string | number | boolean>(key);
    if (typeof value === 'boolean') {
      return value;
    }
    return String(value).toLowerCase() === 'true';
  }
}
