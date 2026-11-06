import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { CallKind, CallScope, CallStatus, GroupRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

const MAX_GROUP_CALL_PARTICIPANTS = 8;

@Injectable()
export class CallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService
  ) {}

  async startDmCall(callerId: string, peerUserId: string, kind: CallKind) {
    if (callerId === peerUserId) throw new BadRequestException('cannot call yourself');
    await this.assertNotBlocked(callerId, peerUserId);
    await this.endStaleForUsers([callerId, peerUserId]);

    const peer = await this.prisma.user.findUnique({
      where: { id: peerUserId },
      select: { id: true, username: true, displayName: true, avatarUrl: true }
    });
    if (!peer) throw new NotFoundException('user not found');

    const call = await this.prisma.callSession.create({
      data: {
        kind,
        scope: CallScope.dm,
        status: CallStatus.ringing,
        createdById: callerId,
        peerUserId,
        participants: {
          create: [
            { userId: callerId, role: 'caller' },
            { userId: peerUserId, role: 'callee' }
          ]
        }
      },
      include: {
        participants: true,
        createdBy: {
          select: { id: true, username: true, displayName: true, avatarUrl: true }
        }
      }
    });

    this.pushIncoming(call.createdBy, [peerUserId], call, '/messages', `call-${call.id}`);
    return { call, peer };
  }

  async startSpaceCall(
    actorId: string,
    scope: 'group' | 'channel',
    spaceId: string,
    kind: CallKind
  ) {
    if (scope === 'group') {
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: spaceId, userId: actorId } }
      });
      if (!member) throw new ForbiddenException('not a group member');
      if (member.role !== GroupRole.owner && member.role !== GroupRole.admin) {
        throw new ForbiddenException('only owner/admin can start group calls');
      }
      await this.endStaleSpace('group', spaceId);
      const members = await this.prisma.groupMember.findMany({
        where: { groupId: spaceId },
        take: MAX_GROUP_CALL_PARTICIPANTS,
        select: { userId: true }
      });
      const call = await this.prisma.callSession.create({
        data: {
          kind,
          scope: CallScope.group,
          status: CallStatus.ringing,
          createdById: actorId,
          groupId: spaceId,
          participants: {
            create: members.map((m) => ({
              userId: m.userId,
              role: m.userId === actorId ? 'caller' : 'member'
            }))
          }
        },
        include: {
          participants: true,
          createdBy: {
            select: { id: true, username: true, displayName: true, avatarUrl: true }
          }
        }
      });
      const inviteeIds = members.map((m) => m.userId).filter((id) => id !== actorId);
      this.pushIncoming(call.createdBy, inviteeIds, call, '/messages', `call-${call.id}`);
      return { call, inviteeIds };
    }

    const sub = await this.prisma.subscription.findUnique({
      where: { channelId_userId: { channelId: spaceId, userId: actorId } }
    });
    if (!sub) throw new ForbiddenException('not a channel subscriber');
    if (sub.role !== GroupRole.owner && sub.role !== GroupRole.admin) {
      throw new ForbiddenException('only owner/admin can start channel calls');
    }
    await this.endStaleSpace('channel', spaceId);
    const subs = await this.prisma.subscription.findMany({
      where: { channelId: spaceId },
      take: MAX_GROUP_CALL_PARTICIPANTS,
      select: { userId: true }
    });
    const call = await this.prisma.callSession.create({
      data: {
        kind,
        scope: CallScope.channel,
        status: CallStatus.ringing,
        createdById: actorId,
        channelId: spaceId,
        participants: {
          create: subs.map((m) => ({
            userId: m.userId,
            role: m.userId === actorId ? 'caller' : 'member'
          }))
        }
      },
      include: {
        participants: true,
        createdBy: {
          select: { id: true, username: true, displayName: true, avatarUrl: true }
        }
      }
    });
    const inviteeIds = subs.map((m) => m.userId).filter((id) => id !== actorId);
    this.pushIncoming(call.createdBy, inviteeIds, call, '/messages', `call-${call.id}`);
    return { call, inviteeIds };
  }

  private pushIncoming(
    caller: { displayName: string | null; username: string },
    userIds: string[],
    call: { id: string; kind: CallKind },
    route: string,
    tag: string
  ) {
    const name = caller.displayName?.trim() || caller.username || 'مكالمة';
    void this.push.dispatch({
      userIds,
      category: 'calls',
      title: name,
      body: call.kind === CallKind.video ? 'مكالمة فيديو واردة' : 'مكالمة صوتية واردة',
      sensitive: false,
      urgent: true,
      data: { kind: 'call', callId: call.id, route, tag }
    });
  }

  async accept(userId: string, callId: string) {
    const call = await this.requireParticipant(callId, userId);
    if (call.status !== CallStatus.ringing && call.status !== CallStatus.connecting) {
      throw new BadRequestException('call not ringable');
    }
    const updated = await this.prisma.callSession.update({
      where: { id: callId },
      data: {
        status: CallStatus.connected,
        connectedAt: call.connectedAt ?? new Date()
      },
      include: { participants: true }
    });
    await this.prisma.callParticipant.update({
      where: { callId_userId: { callId, userId } },
      data: { joinedAt: new Date() }
    });
    return updated;
  }

  async reject(userId: string, callId: string) {
    await this.requireParticipant(callId, userId);
    return this.prisma.callSession.update({
      where: { id: callId },
      data: { status: CallStatus.rejected, endedAt: new Date(), endReason: 'rejected' },
      include: { participants: true }
    });
  }

  async end(userId: string, callId: string, reason = 'ended') {
    await this.requireParticipant(callId, userId);
    const updated = await this.prisma.callSession.update({
      where: { id: callId },
      data: {
        status: reason === 'failed' ? CallStatus.failed : CallStatus.ended,
        endedAt: new Date(),
        endReason: reason
      },
      include: { participants: true }
    });
    await this.prisma.callParticipant.updateMany({
      where: { callId, leftAt: null },
      data: { leftAt: new Date() }
    });
    return updated;
  }

  async join(userId: string, callId: string) {
    const call = await this.prisma.callSession.findUnique({
      where: { id: callId },
      include: { participants: true }
    });
    if (!call) throw new NotFoundException('call not found');
    if (call.status === CallStatus.ended || call.status === CallStatus.failed || call.status === CallStatus.rejected) {
      throw new BadRequestException('call already finished');
    }
    if (call.scope === CallScope.dm) {
      await this.requireParticipant(callId, userId);
    } else if (call.scope === CallScope.group && call.groupId) {
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: call.groupId, userId } }
      });
      if (!member) throw new ForbiddenException('not a group member');
    } else if (call.scope === CallScope.channel && call.channelId) {
      const sub = await this.prisma.subscription.findUnique({
        where: { channelId_userId: { channelId: call.channelId, userId } }
      });
      if (!sub) throw new ForbiddenException('not a channel subscriber');
    }
    if (call.participants.length >= MAX_GROUP_CALL_PARTICIPANTS) {
      throw new ForbiddenException('call is full');
    }
    await this.prisma.callParticipant.upsert({
      where: { callId_userId: { callId, userId } },
      create: { callId, userId, role: 'member', joinedAt: new Date() },
      update: { joinedAt: new Date(), leftAt: null }
    });
    if (call.status === CallStatus.ringing) {
      await this.prisma.callSession.update({
        where: { id: callId },
        data: { status: CallStatus.connected, connectedAt: new Date() }
      });
    }
    return this.prisma.callSession.findUnique({
      where: { id: callId },
      include: { participants: true }
    });
  }

  async listHistory(userId: string, filter: 'all' | 'missed' = 'all') {
    const participations = await this.prisma.callParticipant.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: {
        call: {
          include: {
            createdBy: {
              select: { id: true, username: true, displayName: true, avatarUrl: true }
            },
            participants: {
              include: {
                user: {
                  select: { id: true, username: true, displayName: true, avatarUrl: true }
                }
              }
            }
          }
        }
      }
    });

    const groupIds = [
      ...new Set(participations.map((p) => p.call.groupId).filter(Boolean) as string[])
    ];
    const channelIds = [
      ...new Set(participations.map((p) => p.call.channelId).filter(Boolean) as string[])
    ];
    const [groups, channels] = await Promise.all([
      groupIds.length
        ? this.prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      channelIds.length
        ? this.prisma.channel.findMany({
            where: { id: { in: channelIds } },
            select: { id: true, name: true }
          })
        : Promise.resolve([])
    ]);
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const channelName = new Map(channels.map((c) => [c.id, c.name]));

    const rows = participations.map((p) => {
      const call = p.call;
      const missed =
        call.status === CallStatus.rejected ||
        (call.status === CallStatus.ended &&
          !call.connectedAt &&
          call.createdById !== userId);
      const peerParticipant = call.participants.find((x) => x.userId !== userId);
      const peer =
        call.scope === CallScope.dm
          ? peerParticipant?.user ||
            (call.peerUserId === userId ? call.createdBy : null) ||
            call.createdBy
          : null;
      return {
        id: call.id,
        kind: call.kind,
        scope: call.scope,
        status: call.status,
        createdAt: call.createdAt.toISOString(),
        endedAt: call.endedAt?.toISOString() ?? null,
        missed,
        peer: peer
          ? {
              id: peer.id,
              username: peer.username,
              displayName: peer.displayName,
              avatarUrl: peer.avatarUrl
            }
          : null,
        spaceName:
          call.scope === CallScope.group && call.groupId
            ? groupName.get(call.groupId) || null
            : call.scope === CallScope.channel && call.channelId
              ? channelName.get(call.channelId) || null
              : null,
        direction: call.createdById === userId ? ('outgoing' as const) : ('incoming' as const)
      };
    });

    return filter === 'missed' ? rows.filter((r) => r.missed) : rows;
  }

  async getIceServers() {
    const stun = process.env.WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302';
    const turnUrlsRaw = (process.env.WEBRTC_TURN_URLS || process.env.WEBRTC_TURN_URL || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    const turnUser = process.env.WEBRTC_TURN_USERNAME?.trim();
    const turnPass = process.env.WEBRTC_TURN_CREDENTIAL?.trim();
    const iceServers: Array<RTCIceServerLike> = stun
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => ({ urls: url }));
    const turnConfigured = turnUrlsRaw.length > 0 && Boolean(turnUser && turnPass);
    if (turnConfigured && turnUser && turnPass) {
      for (const urls of turnUrlsRaw) {
        iceServers.push({ urls, username: turnUser, credential: turnPass });
      }
    }
    return {
      iceServers,
      turnConfigured,
      // Credentials are returned only inside ICE objects for authenticated clients — never log them.
      maxMeshParticipants: MAX_GROUP_CALL_PARTICIPANTS,
      note: turnConfigured
        ? 'STUN+TURN configured. Dual-device NAT traversal still requires a successful peer connection test.'
        : 'STUN-only mesh. Set WEBRTC_TURN_URL (or WEBRTC_TURN_URLS), WEBRTC_TURN_USERNAME, WEBRTC_TURN_CREDENTIAL for NAT traversal; SFU needed for large rooms.'
    };
  }

  async assertCanSignal(userId: string, callId: string) {
    await this.requireParticipant(callId, userId);
  }

  private async requireParticipant(callId: string, userId: string) {
    const call = await this.prisma.callSession.findUnique({
      where: { id: callId },
      include: { participants: true }
    });
    if (!call) throw new NotFoundException('call not found');
    if (!call.participants.some((p) => p.userId === userId)) {
      throw new ForbiddenException('not a call participant');
    }
    return call;
  }

  private async assertNotBlocked(a: string, b: string) {
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a }
        ]
      }
    });
    if (blocked) throw new ForbiddenException('calling not allowed between these users');
  }

  private async endStaleForUsers(userIds: string[]) {
    const open = await this.prisma.callSession.findMany({
      where: {
        status: { in: [CallStatus.ringing, CallStatus.connecting, CallStatus.connected] },
        OR: [
          { createdById: { in: userIds } },
          { peerUserId: { in: userIds } },
          { participants: { some: { userId: { in: userIds }, leftAt: null } } }
        ],
        scope: CallScope.dm
      }
    });
    for (const c of open) {
      await this.prisma.callSession.update({
        where: { id: c.id },
        data: { status: CallStatus.ended, endedAt: new Date(), endReason: 'superseded' }
      });
    }
  }

  private async endStaleSpace(scope: 'group' | 'channel', spaceId: string) {
    await this.prisma.callSession.updateMany({
      where: {
        status: { in: [CallStatus.ringing, CallStatus.connecting, CallStatus.connected] },
        ...(scope === 'group' ? { groupId: spaceId } : { channelId: spaceId })
      },
      data: { status: CallStatus.ended, endedAt: new Date(), endReason: 'superseded' }
    });
  }
}

type RTCIceServerLike = {
  urls: string | string[];
  username?: string;
  credential?: string;
};
