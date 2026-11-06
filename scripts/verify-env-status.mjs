import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, 'backend', '.env');

function loadEnv(filePath) {
  const map = {};
  if (!existsSync(filePath)) return map;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    map[t.slice(0, i)] = t.slice(i + 1).trim();
  }
  return map;
}

function probePort(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

const env = loadEnv(envPath);
const postgresUrl = env.POSTGRES_URL || '';
const redisUrl = env.REDIS_URL || '';
const mediaDriver = env.MEDIA_STORAGE_DRIVER || '(unset)';

let pgHost = 'localhost';
let pgPort = 5432;
try {
  const u = new URL(postgresUrl);
  pgHost = u.hostname || 'localhost';
  pgPort = Number(u.port || 5432);
} catch {
  // ignore
}

let redisHost = 'localhost';
let redisPort = 6379;
try {
  const u = new URL(redisUrl);
  redisHost = u.hostname || 'localhost';
  redisPort = Number(u.port || 6379);
} catch {
  // ignore
}

const pgUp = await probePort(pgHost, pgPort);
const redisUp = await probePort(redisHost, redisPort);
const apiUp = await probePort('127.0.0.1', 3000);
const webUp = await probePort('127.0.0.1', 5173);

console.log(
  JSON.stringify(
    {
      envFile: existsSync(envPath),
      mediaStorageDriver: mediaDriver,
      postgresReachable: pgUp,
      redisReachable: redisUp,
      apiPort3000: apiUp,
      frontendPort5173: webUp,
      r2BucketConfigured: Boolean(env.CLOUDFLARE_R2_BUCKET),
      r2KeysConfigured: Boolean(env.CLOUDFLARE_R2_ACCESS_KEY_ID && env.CLOUDFLARE_R2_SECRET_ACCESS_KEY),
      hasMigrationsFolder: existsSync(path.join(root, 'backend', 'prisma', 'migrations'))
    },
    null,
    2
  )
);
