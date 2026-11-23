import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);

const encryptionKey = z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
  error: 'TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 (run `npm run secrets`)',
});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  TRUST_PROXY: z.string().optional(),

  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/socialhub'),
  MONGODB_AUTO_INDEX: booleanString.optional(),

  /** Browser origins allowed by CORS. The first one is used to build links in emails. */
  CLIENT_ORIGIN: csv.default(['http://localhost:5173']),
  APP_URL: z.string().url().optional(),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, { error: 'JWT_ACCESS_SECRET must be at least 32 characters' }),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Window during which a just-rotated refresh token is treated as a benign multi-tab race, not theft. */
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(120).default(20),
  COOKIE_SECURE: booleanString.optional(),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  TOKEN_ENCRYPTION_KEY: encryptionKey,

  INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(30),

  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_SECURE: booleanString.optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('SocialHub <no-reply@socialhub.local>'),

  /** Absolute or API-relative path to the built web app (apps/web/dist) to serve it from the API. */
  SERVE_WEB_DIST: z.string().optional(),

  /** Public base URL where Meta can reach the API (OAuth redirect + callbacks). Defaults to APP_URL. */
  API_PUBLIC_URL: z.string().url().optional(),

  /* --- Meta: Facebook Login (Pages + Instagram accounts linked to Pages) --- */
  META_APP_ID: z.string().regex(/^\d+$/, { error: 'META_APP_ID must be numeric' }).optional(),
  META_APP_SECRET: z.string().min(16).optional(),
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, { error: 'META_GRAPH_API_VERSION must look like v27.0' })
    .default('v27.0'),
  /** Facebook Login for Business configuration id; replaces the `scope` parameter when set. */
  META_FACEBOOK_LOGIN_CONFIG_ID: z.string().regex(/^\d+$/).optional(),
  META_FACEBOOK_SCOPES: csv.default([
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish',
  ]),

  /* --- Meta: Instagram API with Instagram Login (separate Instagram app id/secret) --- */
  INSTAGRAM_APP_ID: z
    .string()
    .regex(/^\d+$/, { error: 'INSTAGRAM_APP_ID must be numeric' })
    .optional(),
  INSTAGRAM_APP_SECRET: z.string().min(16).optional(),
  INSTAGRAM_SCOPES: csv.default(['instagram_business_basic', 'instagram_business_content_publish']),

  /* --- Media storage for the composer. Unset = uploads disabled. --- */
  STORAGE_DRIVER: z.enum(['s3', 'local']).optional(),
  STORAGE_S3_BUCKET: z.string().min(1).optional(),
  STORAGE_S3_REGION: z.string().min(1).default('us-east-1'),
  /** Custom endpoint for S3-compatible providers (Cloudflare R2, MinIO, …). */
  STORAGE_S3_ENDPOINT: z.string().url().optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_S3_FORCE_PATH_STYLE: booleanString.optional(),
  /** Public HTTPS base URL of the bucket or its CDN; Meta fetches media from it. */
  STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),
  /**
   * Directory for STORAGE_DRIVER=local: an absolute path (e.g. "F:/Social Hub Data") or a
   * path relative to apps/api. Created at start if it does not exist.
   */
  STORAGE_LOCAL_DIR: z.string().min(1).default('./storage-data'),
  STORAGE_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),

  /**
   * Turns on GET /api/v1/health/details (version, queues, workers) for monitoring, answered
   * only with `Authorization: Bearer <this token>`. Unset = that route does not exist. The
   * public /health only says whether the API and its database are up.
   */
  HEALTH_DETAILS_TOKEN: z
    .string()
    .min(32, { error: 'HEALTH_DETAILS_TOKEN must be at least 32 characters' })
    .optional(),

  /* --- Publishing engine (BullMQ on Redis). --- */
  /** redis:// or rediss:// URL. Unset = no queue: publishing answers 503 QUEUE_UNAVAILABLE. */
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, { error: 'REDIS_URL must start with redis:// or rediss://' })
    .optional(),
  /**
   * disabled   jobs cannot be created (default)
   * simulated  development only: the whole engine runs, nothing is sent to Meta
   * Real publishing is not enabled in this build, so there is no "live" value.
   */
  PUBLISHING_MODE: z.enum(['disabled', 'simulated']).default('disabled'),
  /** Run the publish worker inside the API process. Set false when `npm run worker` runs it. */
  PUBLISHING_WORKER_INLINE: booleanString.optional(),
  PUBLISHING_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  /** Automatic attempts per destination, including the first one. */
  PUBLISHING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  /** First retry delay; it doubles on every further attempt. */
  PUBLISHING_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
  /**
   * Recovery timings. Leave the defaults; the end-to-end check shortens them.
   * CLAIM: how long a worker may hold one destination before it counts as interrupted.
   * REQUEUE: how overdue a waiting destination must be before its queue entry is re-added.
   */
  PUBLISHING_CLAIM_SECONDS: z.coerce.number().int().min(15).max(3600).default(900),
  PUBLISHING_REQUEUE_SECONDS: z.coerce.number().int().min(5).max(3600).default(120),
  PUBLISHING_RECOVERY_INTERVAL_SECONDS: z.coerce.number().int().min(2).max(3600).default(60),

  META_OAUTH_STATE_TTL_MINUTES: z.coerce.number().int().min(2).max(60).default(10),
  META_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
});

function formatIssues(issues) {
  return issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

export function loadConfig(source = process.env) {
  // Treat empty strings as "unset" so `.env` templates with blank values fall back to defaults.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${formatIssues(parsed.error.issues)}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';

  if (env.COOKIE_SAMESITE === 'none' && env.COOKIE_SECURE === false) {
    throw new Error(
      'Invalid environment configuration: COOKIE_SAMESITE=none requires COOKIE_SECURE=true',
    );
  }

  for (const [id, secret] of [
    ['META_APP_ID', 'META_APP_SECRET'],
    ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  ]) {
    if (Boolean(env[id]) !== Boolean(env[secret])) {
      throw new Error(
        `Invalid environment configuration: set both ${id} and ${secret}, or neither`,
      );
    }
  }

  if (env.STORAGE_DRIVER === 's3') {
    const missing = [
      'STORAGE_S3_BUCKET',
      'STORAGE_S3_ACCESS_KEY_ID',
      'STORAGE_S3_SECRET_ACCESS_KEY',
      'STORAGE_PUBLIC_BASE_URL',
    ].filter((name) => !env[name]);
    if (missing.length) {
      throw new Error(
        `Invalid environment configuration: STORAGE_DRIVER=s3 also needs ${missing.join(', ')}`,
      );
    }
    if (isProduction && !env.STORAGE_PUBLIC_BASE_URL.startsWith('https://')) {
      throw new Error(
        'Invalid environment configuration: STORAGE_PUBLIC_BASE_URL must be an https:// URL in production',
      );
    }
  }

  if (isProduction && env.PUBLISHING_MODE === 'simulated') {
    throw new Error(
      'Invalid environment configuration: PUBLISHING_MODE=simulated is for development only and cannot be used in production',
    );
  }

  const appUrl = (env.APP_URL ?? env.CLIENT_ORIGIN[0]).replace(/\/+$/, '');
  const publicApiUrl = (env.API_PUBLIC_URL ?? appUrl).replace(/\/+$/, '');

  let trustProxy = false;
  if (env.TRUST_PROXY !== undefined) {
    if (/^\d+$/.test(env.TRUST_PROXY)) trustProxy = Number(env.TRUST_PROXY);
    else if (env.TRUST_PROXY === 'true') trustProxy = true;
    else if (env.TRUST_PROXY !== 'false') trustProxy = env.TRUST_PROXY;
  }

  return Object.freeze({
    env: env.NODE_ENV,
    isProduction,
    isTest,
    port: env.PORT,
    logLevel: env.LOG_LEVEL ?? (isTest ? 'silent' : isProduction ? 'info' : 'debug'),
    trustProxy,
    mongo: {
      uri: env.MONGODB_URI,
      autoIndex: env.MONGODB_AUTO_INDEX ?? !isProduction,
    },
    clientOrigins: env.CLIENT_ORIGIN,
    appUrl,
    publicApiUrl,
    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      refreshReuseGraceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
      bcryptRounds: env.BCRYPT_ROUNDS,
      passwordResetTtlMinutes: env.PASSWORD_RESET_TTL_MINUTES,
      cookie: {
        secure: env.COOKIE_SECURE ?? isProduction,
        sameSite: env.COOKIE_SAMESITE,
        domain: env.COOKIE_DOMAIN,
      },
    },
    tokenEncryptionKey: Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64'),
    invitationTtlDays: env.INVITATION_TTL_DAYS,
    rateLimit: {
      authWindowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000,
      authMax: env.AUTH_RATE_LIMIT_MAX,
      apiPerMinute: env.API_RATE_LIMIT_PER_MINUTE,
    },
    mail: {
      from: env.MAIL_FROM,
      smtp: env.SMTP_HOST
        ? {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT ?? 587,
            secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
          }
        : null,
    },
    serveWebDist: env.SERVE_WEB_DIST ?? null,
    storage: {
      driver: env.STORAGE_DRIVER ?? null,
      uploadTtlSeconds: env.STORAGE_UPLOAD_TTL_SECONDS,
      local: { directory: env.STORAGE_LOCAL_DIR },
      s3:
        env.STORAGE_DRIVER === 's3'
          ? {
              bucket: env.STORAGE_S3_BUCKET,
              region: env.STORAGE_S3_REGION,
              endpoint: env.STORAGE_S3_ENDPOINT ?? null,
              accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID,
              secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY,
              forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
              publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
            }
          : null,
    },
    healthDetailsToken: env.HEALTH_DETAILS_TOKEN ?? null,
    publishing: {
      mode: env.PUBLISHING_MODE === 'simulated' ? 'SIMULATED' : 'DISABLED',
      redisUrl: env.REDIS_URL ?? null,
      inlineWorker: env.PUBLISHING_WORKER_INLINE ?? true,
      concurrency: env.PUBLISHING_CONCURRENCY,
      maxAttempts: env.PUBLISHING_MAX_ATTEMPTS,
      retryBaseMs: env.PUBLISHING_RETRY_BASE_SECONDS * 1000,
      retryMaxMs: 15 * 60 * 1000,
      claimMs: env.PUBLISHING_CLAIM_SECONDS * 1000,
      requeueAfterMs: env.PUBLISHING_REQUEUE_SECONDS * 1000,
      recoveryIntervalMs: env.PUBLISHING_RECOVERY_INTERVAL_SECONDS * 1000,
    },
    meta: {
      graphVersion: env.META_GRAPH_API_VERSION,
      stateTtlMinutes: env.META_OAUTH_STATE_TTL_MINUTES,
      requestTimeoutMs: env.META_REQUEST_TIMEOUT_MS,
      facebook: env.META_APP_ID
        ? {
            appId: env.META_APP_ID,
            appSecret: env.META_APP_SECRET,
            loginConfigId: env.META_FACEBOOK_LOGIN_CONFIG_ID ?? null,
            scopes: env.META_FACEBOOK_SCOPES,
            redirectUri: `${publicApiUrl}/api/v1/oauth/facebook/callback`,
          }
        : null,
      instagram: env.INSTAGRAM_APP_ID
        ? {
            appId: env.INSTAGRAM_APP_ID,
            appSecret: env.INSTAGRAM_APP_SECRET,
            scopes: env.INSTAGRAM_SCOPES,
            redirectUri: `${publicApiUrl}/api/v1/oauth/instagram/callback`,
          }
        : null,
    },
  });
}

export const config = loadConfig();
