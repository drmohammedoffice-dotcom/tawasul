import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from './fcm.service';

export type PushCategory =
  | 'privateChats'
  | 'groups'
  | 'channels'
  | 'stories'
  | 'reactions'
  | 'newContacts'
  | 'social'
  | 'calls';

export type PushDispatch = {
  userIds: string[];
  category: PushCategory;
  title: string;
  body: string;
  /** When false, hiding message preview still keeps the body (likes, calls). */
  sensitive?: boolean;
  urgent?: boolean;
  data: Record<string, string>;
  mute?: { targetType: 'dm' | 'group' | 'channel'; targetId: string };
};

type PrefRow = {
  userId: string;
  privateChats: boolean;
  groups: boolean;
  channels: boolean;
  stories: boolean;
  reactions: boolean;
  newContacts: boolean;
  social: boolean;
  calls: boolean;
  inAppPreview: boolean;
  namesOnLockScreen: boolean;
};

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmService
  ) {}

  status() {
    return { enabled: this.fcm.enabled, projectId: this.fcm.activeProjectId };
  }

  async registerDevice(userId: string, token: string, platform: string) {
    const row = await this.prisma.pushDevice.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform }
    });
    return { id: row.id, platform: row.platform };
  }

  async removeDevice(userId: string, token: string) {
    await this.prisma.pushDevice.deleteMany({ where: { userId, token } });
    return { removed: true };
  }

  async getPrefs(userId: string) {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return toPrefsResponse(userId, row);
  }

  async savePrefs(userId: string, patch: Partial<Omit<PrefRow, 'userId'>>) {
    const row = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        privateChats: patch.privateChats ?? true,
        groups: patch.groups ?? true,
        channels: patch.channels ?? true,
        stories: patch.stories ?? true,
        reactions: patch.reactions ?? true,
        newContacts: patch.newContacts ?? true,
        social: patch.social ?? true,
        calls: patch.calls ?? true,
        inAppPreview: patch.inAppPreview ?? true,
        namesOnLockScreen: patch.namesOnLockScreen ?? true
      },
      update: stripUndefined(patch)
    });
    return toPrefsResponse(userId, row);
  }

  async fromInbox(input: {
    recipientId: string;
    actorId?: string | null;
    type: string;
    entityType?: string | null;
    entityId?: string | null;
    notificationId: string;
    payload?: Record<string, unknown> | null;
  }) {
    const actorName = await this.actorName(input.actorId);
    const copy = inboxCopy(input.type, input.payload);
    const postId = typeof input.payload?.postId === 'string' ? input.payload.postId : '';
    const route =
      (input.type === 'follow' || input.type === 'follow_request') && input.actorId
        ? `/u/${input.actorId}`
        : input.entityType === 'post' && input.entityId
          ? `/p/${input.entityId}`
          : postId
            ? `/p/${postId}`
            : input.entityType === 'story'
              ? '/feed'
              : '/notifications';
    await this.dispatch({
      userIds: [input.recipientId],
      category: categoryFor(input.type),
      title: actorName || copy.title,
      body: copy.body,
      sensitive: copy.sensitive,
      data: {
        kind: 'inbox',
        type: input.type,
        notificationId: input.notificationId,
        route,
        tag: `inbox-${input.notificationId}`
      }
    });
  }

  async dispatch(input: PushDispatch): Promise<void> {
    try {
      if (!this.fcm.enabled) return;
      const userIds = [...new Set(input.userIds.filter(Boolean))];
      if (userIds.length === 0) return;

      const prefs = await this.prisma.notificationPreference.findMany({
        where: { userId: { in: userIds } }
      });
      const prefByUser = new Map(prefs.map((row) => [row.userId, row]));
      let allowed = userIds.filter((id) => allows(prefByUser.get(id), input.category));
      if (allowed.length === 0) return;

      if (input.mute) {
        const muted = await this.prisma.chatMute.findMany({
          where: {
            userId: { in: allowed },
            targetType: input.mute.targetType,
            targetId: input.mute.targetId
          },
          select: { userId: true }
        });
        const mutedIds = new Set(muted.map((row) => row.userId));
        allowed = allowed.filter((id) => !mutedIds.has(id));
      }
      if (allowed.length === 0) return;

      const devices = await this.prisma.pushDevice.findMany({
        where: { userId: { in: allowed } },
        select: { userId: true, token: true }
      });
      if (devices.length === 0) return;

      const buckets = new Map<string, { title: string; body: string; tokens: string[] }>();
      for (const device of devices) {
        const rendered = render(input, prefByUser.get(device.userId));
        const key = `${rendered.title}\n${rendered.body}`;
        const bucket = buckets.get(key) ?? { ...rendered, tokens: [] };
        bucket.tokens.push(device.token);
        buckets.set(key, bucket);
      }

      const invalid = new Set<string>();
      for (const bucket of buckets.values()) {
        const rejected = await this.fcm.send(bucket.tokens, {
          title: bucket.title,
          body: bucket.body,
          data: input.data,
          urgent: input.urgent || input.category === 'calls'
        });
        rejected.forEach((token) => invalid.add(token));
      }
      if (invalid.size > 0) {
        await this.prisma.pushDevice.deleteMany({ where: { token: { in: [...invalid] } } });
      }
    } catch (err) {
      this.logger.warn(`push dispatch failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async actorName(actorId?: string | null): Promise<string> {
    if (!actorId) return '';
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { displayName: true, username: true }
    });
    return actor?.displayName?.trim() || actor?.username || '';
  }
}

function allows(pref: PrefRow | undefined, category: PushCategory): boolean {
  if (!pref) return true;
  return pref[category] !== false;
}

function render(input: PushDispatch, pref: PrefRow | undefined): { title: string; body: string } {
  const names = pref?.namesOnLockScreen !== false;
  const preview = pref?.inAppPreview !== false;
  if (!names) {
    return {
      title: 'تواصل',
      body: input.category === 'calls' ? 'مكالمة واردة' : 'إشعار جديد'
    };
  }
  if (!preview && input.sensitive !== false) {
    return { title: input.title, body: input.category === 'calls' ? input.body : 'إشعار جديد' };
  }
  return { title: input.title, body: input.body };
}

function categoryFor(type: string): PushCategory {
  if (type.startsWith('story')) return 'stories';
  if (type.includes('reaction')) return 'reactions';
  return 'social';
}

function inboxCopy(
  type: string,
  payload?: Record<string, unknown> | null
): { title: string; body: string; sensitive: boolean } {
  const reply = typeof payload?.body === 'string' ? payload.body.trim().slice(0, 140) : '';
  const emoji = typeof payload?.emoji === 'string' ? payload.emoji.trim().slice(0, 16) : '';
  switch (type) {
    case 'post_like':
      return { title: 'إعجاب جديد', body: 'أعجب بمنشورك', sensitive: false };
    case 'post_comment':
      return { title: 'تعليق جديد', body: reply || 'علّق على منشورك', sensitive: Boolean(reply) };
    case 'follow':
      return { title: 'متابع جديد', body: 'بدأ بمتابعتك', sensitive: false };
    case 'follow_request':
      return { title: 'طلب متابعة', body: 'أرسل طلب متابعة', sensitive: false };
    case 'story_reaction':
      return { title: 'تفاعل على القصة', body: emoji ? `تفاعل ${emoji}` : 'تفاعل مع قصتك', sensitive: false };
    case 'story_reply':
      return { title: 'رد على القصة', body: reply || 'رد على قصتك', sensitive: Boolean(reply) };
    default:
      return { title: 'إشعار جديد', body: 'لديك إشعار جديد', sensitive: false };
  }
}

function toPrefsResponse(userId: string, row: PrefRow | null) {
  return {
    saved: Boolean(row),
    userId,
    privateChats: row?.privateChats ?? true,
    groups: row?.groups ?? true,
    channels: row?.channels ?? true,
    stories: row?.stories ?? true,
    reactions: row?.reactions ?? true,
    newContacts: row?.newContacts ?? true,
    social: row?.social ?? true,
    calls: row?.calls ?? true,
    inAppPreview: row?.inAppPreview ?? true,
    namesOnLockScreen: row?.namesOnLockScreen ?? true
  };
}

function stripUndefined(patch: Partial<Omit<PrefRow, 'userId'>>): Partial<Omit<PrefRow, 'userId'>> {
  const data: Partial<Omit<PrefRow, 'userId'>> = {};
  (Object.keys(patch) as (keyof typeof patch)[]).forEach((key) => {
    const value = patch[key];
    if (typeof value === 'boolean') {
      data[key] = value;
    }
  });
  return data;
}
