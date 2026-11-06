import * as Joi from 'joi';

type EnvShape = {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  API_PREFIX: string;
  CLIENT_ORIGIN: string;
  CLIENT_ORIGINS?: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRES_IN: string;
  JWT_REFRESH_EXPIRES_IN: string;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
  JWT_ACCESS_KID?: string;
  JWT_REFRESH_KID?: string;
  JWT_ACCESS_PREVIOUS_KEYS?: string;
  JWT_REFRESH_PREVIOUS_KEYS?: string;
  AUTH_LOGIN_MAX_ATTEMPTS: number;
  AUTH_LOGIN_WINDOW_SECONDS: number;
  AUTH_LOGIN_BLOCK_SECONDS: number;
  AUTH_COOKIE_ENABLED: boolean;
  AUTH_COOKIE_SECURE: boolean;
  AUTH_COOKIE_SAME_SITE: 'lax' | 'strict' | 'none';
  AUTH_COOKIE_DOMAIN?: string;
  MEDIA_STORAGE_DRIVER: 's3' | 'local' | 'r2';
  MEDIA_SIGNED_URL_TTL_SECONDS: number;
  MEDIA_LOCAL_BASE_PATH: string;
  MEDIA_S3_ENDPOINT?: string;
  MEDIA_S3_REGION: string;
  MEDIA_S3_BUCKET: string;
  MEDIA_S3_ACCESS_KEY: string;
  MEDIA_S3_SECRET_KEY: string;
  MEDIA_S3_FORCE_PATH_STYLE: boolean;
  /** Optional aliases / Cloudflare R2 (used when MEDIA_STORAGE_DRIVER=r2) */
  MEDIA_STORAGE_PROVIDER?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_R2_BUCKET?: string;
  CLOUDFLARE_R2_ACCESS_KEY_ID?: string;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_R2_ENDPOINT?: string;
  CLOUDFLARE_R2_PUBLIC_BASE_URL?: string;
  MEDIA_ALLOW_PUBLIC_READS?: boolean;
  VIDEO_STORAGE_PROVIDER?: 'local' | 'stream' | 'r2';
  CLOUDFLARE_STREAM_ACCOUNT_ID?: string;
  CLOUDFLARE_STREAM_API_TOKEN?: string;
  CLOUDFLARE_STREAM_CUSTOMER_DOMAIN?: string;
  CLOUDFLARE_STREAM_WEBHOOK_SECRET?: string;
  CACHE_DEFAULT_TTL_SECONDS: number;
  RATE_LIMIT_WINDOW_SECONDS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  RATE_LIMIT_AUTH_MAX_REQUESTS: number;
  RATE_LIMIT_WS_MAX_EVENTS: number;
  RATE_LIMIT_IP_BLOCK_SECONDS: number;
  FREE_MAX_UPLOAD_BYTES: number;
  FREE_MAX_OWNED_GROUPS: number;
  FREE_MAX_OWNED_CHANNELS: number;
  PREMIUM_MAX_UPLOAD_BYTES: number;
  PREMIUM_MAX_OWNED_GROUPS: number;
  PREMIUM_MAX_OWNED_CHANNELS: number;
  REWARDS_MAX_COINS_PER_DAY: number;
  MINIGAMES_MAX_PLAYS_PER_DAY: number;
  WALLET_INTERNAL_TOKEN?: string;
  WS_ALLOWED_ORIGINS: string;
  POSTGRES_URL: string;
  REDIS_URL: string;
  OTP_PEPPER?: string;
  OTP_MESSAGING_DRIVER?: 'mock' | 'live';
  OTP_ALLOW_MOCK_IN_PRODUCTION?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_WHATSAPP_FROM?: string;
  WEBRTC_STUN_URLS?: string;
  WEBRTC_TURN_URL?: string;
  WEBRTC_TURN_URLS?: string;
  WEBRTC_TURN_USERNAME?: string;
  WEBRTC_TURN_CREDENTIAL?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  FIREBASE_SERVICE_ACCOUNT_PATH?: string;
};

export function validateEnv(config: Record<string, unknown>): EnvShape {
  const schema = Joi.object<EnvShape>({
    NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
    PORT: Joi.number().default(3000),
    API_PREFIX: Joi.string().default('api'),
    CLIENT_ORIGIN: Joi.string().uri().required(),
    CLIENT_ORIGINS: Joi.string().optional().allow(''),
    JWT_ACCESS_SECRET: Joi.string().min(16).required(),
    JWT_REFRESH_SECRET: Joi.string().min(16).required(),
    JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
    JWT_ISSUER: Joi.string().default('tawasul'),
    JWT_AUDIENCE: Joi.string().default('tawasul-api'),
    JWT_ACCESS_KID: Joi.string().default('v1'),
    JWT_REFRESH_KID: Joi.string().default('v1'),
    JWT_ACCESS_PREVIOUS_KEYS: Joi.string().optional().allow(''),
    JWT_REFRESH_PREVIOUS_KEYS: Joi.string().optional().allow(''),
    OTP_PEPPER: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(16).required(),
      otherwise: Joi.string().min(16).optional().allow('')
    }),
    AUTH_LOGIN_MAX_ATTEMPTS: Joi.number().integer().min(3).default(5),
    AUTH_LOGIN_WINDOW_SECONDS: Joi.number().integer().min(60).default(300),
    AUTH_LOGIN_BLOCK_SECONDS: Joi.number().integer().min(60).default(900),
    AUTH_COOKIE_ENABLED: Joi.boolean().default(false),
    AUTH_COOKIE_SECURE: Joi.boolean().default(true),
    AUTH_COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
    AUTH_COOKIE_DOMAIN: Joi.string().optional().allow(''),
    MEDIA_STORAGE_DRIVER: Joi.string().valid('s3', 'local', 'r2').default('local'),
    MEDIA_SIGNED_URL_TTL_SECONDS: Joi.number().integer().min(60).default(900),
    MEDIA_LOCAL_BASE_PATH: Joi.string().default('./storage/media'),
    MEDIA_S3_ENDPOINT: Joi.string().uri().optional().allow(''),
    MEDIA_S3_REGION: Joi.string().default('us-east-1'),
    MEDIA_S3_BUCKET: Joi.string().default('secure-messaging-media'),
    MEDIA_S3_ACCESS_KEY: Joi.string().default('minioadmin'),
    MEDIA_S3_SECRET_KEY: Joi.string().default('minioadmin'),
    MEDIA_S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
    MEDIA_STORAGE_PROVIDER: Joi.string().valid('local', 's3', 'r2').optional().allow(''),
    CLOUDFLARE_ACCOUNT_ID: Joi.string().optional().allow(''),
    CLOUDFLARE_R2_BUCKET: Joi.string().optional().allow(''),
    CLOUDFLARE_R2_ACCESS_KEY_ID: Joi.string().optional().allow(''),
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: Joi.string().optional().allow(''),
    CLOUDFLARE_R2_ENDPOINT: Joi.string().uri().optional().allow(''),
    CLOUDFLARE_R2_PUBLIC_BASE_URL: Joi.string().uri().optional().allow(''),
    MEDIA_ALLOW_PUBLIC_READS: Joi.boolean().default(false),
    VIDEO_STORAGE_PROVIDER: Joi.string().valid('local', 'stream', 'r2').default('local'),
    CLOUDFLARE_STREAM_ACCOUNT_ID: Joi.string().optional().allow(''),
    CLOUDFLARE_STREAM_API_TOKEN: Joi.string().optional().allow(''),
    CLOUDFLARE_STREAM_CUSTOMER_DOMAIN: Joi.string().optional().allow(''),
    CLOUDFLARE_STREAM_WEBHOOK_SECRET: Joi.string().optional().allow(''),
    CACHE_DEFAULT_TTL_SECONDS: Joi.number().integer().min(10).default(60),
    RATE_LIMIT_WINDOW_SECONDS: Joi.number().integer().min(10).default(60),
    RATE_LIMIT_MAX_REQUESTS: Joi.number().integer().min(10).default(200),
    RATE_LIMIT_AUTH_MAX_REQUESTS: Joi.number().integer().min(3).default(30),
    RATE_LIMIT_WS_MAX_EVENTS: Joi.number().integer().min(10).default(300),
    RATE_LIMIT_IP_BLOCK_SECONDS: Joi.number().integer().min(60).default(900),
    FREE_MAX_UPLOAD_BYTES: Joi.number().integer().min(1024).default(5 * 1024 * 1024),
    FREE_MAX_OWNED_GROUPS: Joi.number().integer().min(1).default(3),
    FREE_MAX_OWNED_CHANNELS: Joi.number().integer().min(1).default(1),
    PREMIUM_MAX_UPLOAD_BYTES: Joi.number().integer().min(1024).default(100 * 1024 * 1024),
    PREMIUM_MAX_OWNED_GROUPS: Joi.number().integer().min(1).default(200),
    PREMIUM_MAX_OWNED_CHANNELS: Joi.number().integer().min(1).default(100),
    REWARDS_MAX_COINS_PER_DAY: Joi.number().integer().min(10).default(250),
    MINIGAMES_MAX_PLAYS_PER_DAY: Joi.number().integer().min(1).default(30),
    WALLET_INTERNAL_TOKEN: Joi.string().optional().allow(''),
    WS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:5173'),
    POSTGRES_URL: Joi.string().uri().required(),
    REDIS_URL: Joi.string().uri().required(),
    OTP_MESSAGING_DRIVER: Joi.string().valid('mock', 'live').default('mock'),
    OTP_ALLOW_MOCK_IN_PRODUCTION: Joi.string().optional().allow(''),
    TWILIO_ACCOUNT_SID: Joi.string().optional().allow(''),
    TWILIO_AUTH_TOKEN: Joi.string().optional().allow(''),
    TWILIO_FROM_NUMBER: Joi.string().optional().allow(''),
    TWILIO_WHATSAPP_FROM: Joi.string().optional().allow(''),
    WEBRTC_STUN_URLS: Joi.string().optional().allow(''),
    WEBRTC_TURN_URL: Joi.string().optional().allow(''),
    WEBRTC_TURN_URLS: Joi.string().optional().allow(''),
    WEBRTC_TURN_USERNAME: Joi.string().optional().allow(''),
    WEBRTC_TURN_CREDENTIAL: Joi.string().optional().allow(''),
    FIREBASE_PROJECT_ID: Joi.string().optional().allow(''),
    FIREBASE_CLIENT_EMAIL: Joi.string().optional().allow(''),
    FIREBASE_PRIVATE_KEY: Joi.string().optional().allow(''),
    FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().optional().allow(''),
    FIREBASE_SERVICE_ACCOUNT_PATH: Joi.string().optional().allow('')
  });

  const { error, value } = schema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true
  });
  if (error) {
    throw new Error(`Environment validation failed: ${error.message}`);
  }
  return value;
}
