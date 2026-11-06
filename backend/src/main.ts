import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './modules/config/app-config.service';
import { PrismaService } from './modules/prisma/prisma.service';

async function bootstrap() {
  // rawBody required so Cloudflare Stream webhook HMAC can verify the exact payload bytes
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(AppConfigService);
  const prisma = app.get(PrismaService);
  // Rate-limit Redis keys are intentionally NOT cleared on boot (preserves lockouts).

  app.setGlobalPrefix(config.apiPrefix, { exclude: ['health'] });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );
  const allowedOrigins = new Set(config.clientOrigins);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Non-browser clients (curl, health probes) may omit Origin.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });
  // Frontend runs on a different origin (e.g. :5173) than the API (:3000).
  // Default Helmet CORP=same-origin blocks <img>/<video> embedding of signed media URLs.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );
  app.use(cookieParser());

  await prisma.enableShutdownHooks(app);
  await app.listen(config.port);
}

void bootstrap();
