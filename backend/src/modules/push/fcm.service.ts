import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

const CHANNEL_ID = 'tawasul';

type ServiceAccountShape = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

export type FcmPayload = {
  title: string;
  body: string;
  data: Record<string, string>;
  urgent?: boolean;
};

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private messaging: Messaging | null = null;
  private projectId: string | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const loaded = this.loadCredential();
    if (!loaded) {
      this.logger.warn(
        'FCM is off. Add backend/firebase-service-account.json or FIREBASE_SERVICE_ACCOUNT_JSON.'
      );
      return;
    }
    try {
      const app: App =
        getApps()[0] ??
        initializeApp({
          credential: cert({
            projectId: loaded.projectId,
            clientEmail: loaded.clientEmail,
            privateKey: loaded.privateKey
          }),
          projectId: loaded.projectId
        });
      this.messaging = getMessaging(app);
      this.projectId = loaded.projectId;
      this.logger.log(`FCM ready for ${loaded.projectId}`);
    } catch (err) {
      this.logger.warn(`FCM init failed: ${err instanceof Error ? err.message : err}`);
      this.messaging = null;
    }
  }

  get enabled(): boolean {
    return this.messaging !== null;
  }

  get activeProjectId(): string | null {
    return this.projectId;
  }

  /** Returns registration tokens Firebase rejected so the caller can delete them. */
  async send(tokens: string[], payload: FcmPayload): Promise<string[]> {
    if (!this.messaging || tokens.length === 0) return [];
    const invalid: string[] = [];
    const data = stringifyData(payload.data);
    const title = payload.title.trim() || 'تواصل';
    const body = payload.body.trim() || 'إشعار جديد';

    for (let offset = 0; offset < tokens.length; offset += 500) {
      const chunk = tokens.slice(offset, offset + 500);
      try {
        const result = await this.messaging.sendEachForMulticast({
          tokens: chunk,
          notification: { title, body },
          data,
          android: {
            priority: 'high',
            ...(data.tag ? { collapseKey: data.tag } : {}),
            notification: {
              channelId: CHANNEL_ID,
              sound: 'default',
              clickAction: 'FCM_PLUGIN_ACTIVITY',
              ...(data.tag ? { tag: data.tag } : {})
            }
          },
          webpush: {
            ...(payload.urgent ? { headers: { Urgency: 'high' } } : {}),
            notification: {
              title,
              body,
              tag: data.tag || 'tawasul'
            }
          },
          apns: {
            headers: { 'apns-priority': payload.urgent ? '10' : '5' },
            payload: { aps: { sound: 'default', threadId: data.tag || 'tawasul' } }
          }
        });
        result.responses.forEach((row, index) => {
          if (row.success) return;
          const code = row.error?.code ?? '';
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            const token = chunk[index];
            if (token) invalid.push(token);
          } else if (row.error) {
            this.logger.warn(`FCM send failed: ${row.error.code} ${row.error.message}`);
          }
        });
      } catch (err) {
        this.logger.warn(`FCM batch failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return invalid;
  }

  private loadCredential(): { projectId: string; clientEmail: string; privateKey: string } | null {
    const fromJson = this.parseAccount(this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON'));
    if (fromJson) return fromJson;

    const configuredPath = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH')?.trim();
    const candidates = [
      configuredPath,
      join(process.cwd(), 'firebase-service-account.json'),
      join(process.cwd(), 'backend', 'firebase-service-account.json'),
      ...adminSdkFiles(process.cwd()),
      ...adminSdkFiles(join(process.cwd(), 'backend'))
    ].filter((item): item is string => Boolean(item));

    for (const path of candidates) {
      if (!existsSync(path)) continue;
      try {
        const parsed = this.parseAccount(readFileSync(path, 'utf8'));
        if (parsed) return parsed;
      } catch (err) {
        this.logger.warn(`Could not read ${path}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID')?.trim();
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL')?.trim();
    const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n').trim();
    if (projectId && clientEmail && privateKey) {
      return { projectId, clientEmail, privateKey };
    }
    return null;
  }

  private parseAccount(raw: string | undefined): { projectId: string; clientEmail: string; privateKey: string } | null {
    const text = raw?.trim();
    if (!text || !text.startsWith('{')) return null;
    try {
      const json = JSON.parse(text) as ServiceAccountShape;
      const projectId = json.project_id?.trim();
      const clientEmail = json.client_email?.trim();
      const privateKey = json.private_key?.replace(/\\n/g, '\n').trim();
      if (!projectId || !clientEmail || !privateKey) return null;
      return { projectId, clientEmail, privateKey };
    } catch {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
      return null;
    }
  }
}

function adminSdkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json') && name.includes('firebase-adminsdk'))
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function stringifyData(data: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!value) continue;
    out[key] = String(value).slice(0, 500);
  }
  return out;
}
