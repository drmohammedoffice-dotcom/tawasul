import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { FollowStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from './presence.service';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService
  ) {}

  async suggested(userId: string, q?: string) {
    const needle = (q || '').trim();
    const select = {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true
    } as const;

    if (needle) {
      const users = await this.prisma.user.findMany({
        where: {
          id: { not: userId },
          isAutomatedTest: false,
          OR: [
            { username: { contains: needle, mode: 'insensitive' } },
            { displayName: { contains: needle, mode: 'insensitive' } }
          ]
        },
        take: 40,
        select
      });
      return this.withPresence(
        users.map((u) => ({ ...u, source: 'search' as const }))
      );
    }

    const [following, followers, recentMsgs] = await Promise.all([
      this.prisma.follow.findMany({
        where: { followerId: userId, status: FollowStatus.accepted },
        take: 80,
        include: { following: { select } }
      }),
      this.prisma.follow.findMany({
        where: { followingId: userId, status: FollowStatus.accepted },
        take: 80,
        include: { follower: { select } }
      }),
      this.prisma.message.findMany({
        where: { OR: [{ senderId: userId }, { receiverId: userId }] },
        orderBy: { timestamp: 'desc' },
        take: 200,
        select: { senderId: true, receiverId: true }
      })
    ]);

    const map = new Map<
      string,
      {
        id: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
        source: 'following' | 'follower' | 'peer' | 'search';
      }
    >();

    for (const f of following) {
      if (f.following.id === userId) continue;
      map.set(f.following.id, { ...f.following, source: 'following' });
    }
    for (const f of followers) {
      if (f.follower.id === userId) continue;
      if (!map.has(f.follower.id)) {
        map.set(f.follower.id, { ...f.follower, source: 'follower' });
      }
    }

    const peerIds = new Set<string>();
    for (const m of recentMsgs) {
      const peer = m.senderId === userId ? m.receiverId : m.senderId;
      if (peer !== userId) peerIds.add(peer);
    }
    const missingPeers = [...peerIds].filter((id) => !map.has(id)).slice(0, 40);
    if (missingPeers.length) {
      const peers = await this.prisma.user.findMany({
        where: { id: { in: missingPeers }, isAutomatedTest: false },
        select
      });
      for (const p of peers) {
        map.set(p.id, { ...p, source: 'peer' });
      }
    }

    return this.withPresence([...map.values()]);
  }

  async matchPhoneHashes(userId: string, hashes: string[]) {
    const cleaned = [...new Set(hashes.map((h) => h.trim().toLowerCase()).filter(Boolean))].slice(
      0,
      500
    );
    if (!cleaned.length) return [];

    const candidates = await this.prisma.user.findMany({
      where: {
        id: { not: userId },
        phoneE164: { not: null },
        isAutomatedTest: false
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        phoneE164: true
      }
    });

    const hashSet = new Set(cleaned);
    const matched = candidates.filter((u) => {
      if (!u.phoneE164) return false;
      const h1 = createHash('sha256').update(u.phoneE164).digest('hex');
      const digits = u.phoneE164.replace(/[^\d]/g, '');
      const h2 = createHash('sha256').update(digits).digest('hex');
      return hashSet.has(h1) || hashSet.has(h2);
    });

    return this.withPresence(
      matched.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        source: 'phone' as const,
        onSecureChat: true
      }))
    );
  }

  private async withPresence<
    T extends { id: string; username: string; displayName: string | null; avatarUrl: string | null }
  >(rows: T[]) {
    const out = [];
    for (const row of rows) {
      let online = false;
      try {
        online = await this.presence.isOnline(row.id);
      } catch {
        online = false;
      }
      out.push({ ...row, online, onSecureChat: true });
    }
    out.sort((a, b) => Number(b.online) - Number(a.online));
    return out;
  }
}
