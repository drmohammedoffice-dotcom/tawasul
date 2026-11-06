import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Inject, Logger, UsePipes, ValidationPipe, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuditLogService } from '../audit/audit-log.service';
import { CacheService } from '../cache/cache.service';
import { ChannelsService } from '../channels/channels.service';
import { AppConfigService } from '../config/app-config.service';
import { GroupsService } from '../groups/groups.service';
import { SecurityRateLimitService } from '../security/security-rate-limit.service';
import { AuthSessionService } from '../auth/auth-session.service';
import { JwtKeysService } from '../auth/jwt-keys.service';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { MessagingService } from './messaging.service';
import { SendPrivateMessageDto } from './dto/send-private-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { MessageReactionDto } from './dto/message-reaction.dto';
import { TypingIndicatorDto } from './dto/typing-indicator.dto';
import { MessageReadDto } from './dto/message-read.dto';
import { ChannelMessageSendDto, ChannelRoomDto } from './dto/channel-room.dto';
import { GroupMessageSendDto, GroupRoomDto } from './dto/group-room.dto';
import { ChannelTypingDto, GroupTypingDto } from './dto/space-typing.dto';
import { MESSAGING_CHANNELS } from './messaging.constants';
import { MessagingPubSubService } from './messaging-pubsub.service';
import { PresenceService } from './presence.service';
import { CallService } from './call.service';
import { CallKind } from '@prisma/client';

type SocketWithUser = Socket & {
  data: { userId: string; accessToken?: string; sessionId?: string };
};

function resolveWsCorsOrigins(): string[] {
  const raw = process.env.WS_ALLOWED_ORIGINS ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

@WebSocketGateway({
  cors: {
    origin: resolveWsCorsOrigins(),
    credentials: true
  },
  namespace: '/realtime',
  transports: ['websocket'],
  perMessageDeflate: false
})
export class MessagingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MessagingGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly socketsByUserId = new Map<string, Set<string>>();
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: AppConfigService,
    private readonly messagingService: MessagingService,
    private readonly pubsubService: MessagingPubSubService,
    private readonly presenceService: PresenceService,
    private readonly securityRateLimitService: SecurityRateLimitService,
    private readonly auditLogService: AuditLogService,
    private readonly cacheService: CacheService,
    private readonly authSessionService: AuthSessionService,
    private readonly jwtKeys: JwtKeysService,
    @Inject(forwardRef(() => GroupsService))
    private readonly groupsService: GroupsService,
    @Inject(forwardRef(() => ChannelsService))
    private readonly channelsService: ChannelsService,
    private readonly callService: CallService
  ) {
    this.allowedOrigins = new Set(configService.wsAllowedOrigins);
  }

  afterInit() {
    this.pubsubService.onMessage((channel, payload) => {
      const data = JSON.parse(payload) as Record<string, unknown>;
      if (channel === MESSAGING_CHANNELS.MESSAGE_CREATED) {
        this.emitToUser(data.senderId as string, 'message:new', data);
        this.emitToUser(data.receiverId as string, 'message:new', data);
      }
      if (channel === MESSAGING_CHANNELS.MESSAGE_UPDATED) {
        this.emitToUser(data.senderId as string, 'message:update', data);
        this.emitToUser(data.receiverId as string, 'message:update', data);
      }
      if (channel === MESSAGING_CHANNELS.MESSAGE_DELETED) {
        this.emitToUser(data.senderId as string, 'message:delete', data);
        this.emitToUser(data.receiverId as string, 'message:delete', data);
      }
      if (channel === MESSAGING_CHANNELS.MESSAGE_REACTION) {
        this.emitToUser(data.senderId as string, 'message:reaction', data);
        this.emitToUser(data.receiverId as string, 'message:reaction', data);
      }
      if (channel === MESSAGING_CHANNELS.GIFT_SENT) {
        this.emitToUser(data.senderId as string, 'gift:sent', data);
        this.emitToUser(data.receiverId as string, 'gift:received', data);
      }
      if (channel === MESSAGING_CHANNELS.USER_TYPING) {
        this.emitToUser(data.receiverId as string, 'user:typing', data);
      }
      if (channel === MESSAGING_CHANNELS.PRESENCE_UPDATED) {
        this.server.emit('presence:updated', data);
      }
      if (channel === MESSAGING_CHANNELS.GROUP_MESSAGE_CREATED) {
        const room = (data.room as string) || this.groupRoom(String(data.groupId));
        this.server.to(room).emit('group:message:new', data);
      }
      if (channel === MESSAGING_CHANNELS.CHANNEL_MESSAGE_CREATED) {
        const room = (data.room as string) || this.channelRoom(String(data.channelId));
        this.server.to(room).emit('channel:message:new', data);
      }
    });
  }

  async handleConnection(socket: Socket) {
    try {
      const token = this.extractToken(socket);
      if (!token) {
        throw new WsException('missing access token');
      }
      const origin = socket.handshake.headers.origin;
      if (
        typeof origin === 'string' &&
        this.allowedOrigins.size > 0 &&
        !this.allowedOrigins.has(origin)
      ) {
        throw new WsException('origin not allowed');
      }

      const payload = await this.verifyAccessToken(token);
      if (payload.type !== 'access') {
        throw new WsException('invalid token type');
      }
      const session = await this.authSessionService.getSession(payload.sid);
      if (
        !session ||
        session.userId !== payload.sub ||
        session.tokenId !== payload.jti ||
        session.deviceId !== payload.deviceId
      ) {
        throw new WsException('session expired');
      }

      const client = socket as SocketWithUser;
      client.data.userId = payload.sub;
      client.data.accessToken = token;
      client.data.sessionId = payload.sid;
      socket.join(this.userRoom(payload.sub));

      this.trackSocketConnection(payload.sub, socket.id);
      await this.presenceService.markOnline(payload.sub);
      await this.pubsubService.publish(MESSAGING_CHANNELS.PRESENCE_UPDATED, {
        userId: payload.sub,
        status: 'online',
        timestamp: new Date().toISOString()
      });
      this.logger.debug(`User connected ${payload.sub} via socket ${socket.id}`);
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'auth_failed';
      this.logger.warn(`Socket auth failed for ${socket.id}: ${reason}`);
      // Do not rethrow — an unhandled Jwt error here crashes the Nest process.
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket) {
    const client = socket as SocketWithUser;
    const userId = client.data.userId;
    if (!userId) {
      return;
    }

    this.trackSocketDisconnection(userId, socket.id);
    const stillOnline = this.isUserConnectedLocally(userId);
    if (!stillOnline) {
      await this.presenceService.markOffline(userId);
      await this.pubsubService.publish(MESSAGING_CHANNELS.PRESENCE_UPDATED, {
        userId,
        status: 'offline',
        timestamp: new Date().toISOString()
      });
    }
  }

  @SubscribeMessage('message:send')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleSendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: SendPrivateMessageDto
  ) {
    const senderId = await this.requireUserId(socket);
    await this.enforceSocketRate(socket, 'message.send');

    const receiverOnline = await this.presenceService.isOnline(dto.receiverId);
    const message = await this.messagingService.createPrivateMessage(senderId, dto, {
      receiverOnline
    });

    await this.pubsubService.publish(MESSAGING_CHANNELS.MESSAGE_CREATED, {
      ...message,
      status: message.status
    });
    await this.auditLogService.record({
      actorUserId: senderId,
      actorIp: socket.handshake.address ?? 'unknown',
      action: 'message.send',
      resourceType: 'message',
      resourceId: message.id,
      outcome: 'success',
      metadata: { receiverId: dto.receiverId, status: message.status }
    });

    return { success: true, message: 'message processed', data: message };
  }

  @SubscribeMessage('message:edit')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleEditMessage(@ConnectedSocket() socket: Socket, @MessageBody() dto: EditMessageDto) {
    const senderId = await this.requireUserId(socket);
    await this.enforceSocketRate(socket, 'message.edit');
    const updated = await this.messagingService.editMessage(senderId, dto);
    await this.pubsubService.publish(MESSAGING_CHANNELS.MESSAGE_UPDATED, {
      ...updated,
      updateType: 'edit'
    });
    return { success: true, message: 'message edited', data: updated };
  }

  @SubscribeMessage('message:delete')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleDeleteMessage(@ConnectedSocket() socket: Socket, @MessageBody() dto: DeleteMessageDto) {
    const senderId = (socket as SocketWithUser).data.userId;
    if (!senderId) {
      throw new WsException('unauthorized socket');
    }
    await this.enforceSocketRate(socket, 'message.delete');
    const deleted = await this.messagingService.deleteMessage(senderId, dto.messageId);
    await this.pubsubService.publish(MESSAGING_CHANNELS.MESSAGE_DELETED, deleted);
    return { success: true, message: 'message deleted', data: deleted };
  }

  @SubscribeMessage('message:reaction')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleReaction(@ConnectedSocket() socket: Socket, @MessageBody() dto: MessageReactionDto) {
    const userId = (socket as SocketWithUser).data.userId;
    if (!userId) {
      throw new WsException('unauthorized socket');
    }
    await this.enforceSocketRate(socket, 'message.reaction');
    const result = await this.messagingService.addOrToggleReaction(userId, dto.messageId, dto.emoji);
    const message = await this.messagingService.getMessageById(dto.messageId);
    await this.pubsubService.publish(MESSAGING_CHANNELS.MESSAGE_REACTION, {
      action: result.action,
      reaction: result.reaction,
      senderId: message.senderId,
      receiverId: message.receiverId,
      messageId: dto.messageId
    });
    return { success: true, message: 'reaction updated', data: result };
  }

  @SubscribeMessage('message:read')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleMessageRead(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: MessageReadDto
  ) {
    const userId = (socket as SocketWithUser).data.userId;
    if (!userId) {
      throw new WsException('unauthorized socket');
    }
    await this.enforceSocketRate(socket, 'message.read');
    const updated = await this.messagingService.updateStatus(dto.messageId, userId, 'read');
    await this.pubsubService.publish(MESSAGING_CHANNELS.MESSAGE_UPDATED, {
      ...updated,
      updateType: 'status'
    });
    return { success: true, message: 'read receipt recorded', data: updated };
  }

  @SubscribeMessage('user:typing')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleTyping(@ConnectedSocket() socket: Socket, @MessageBody() dto: TypingIndicatorDto) {
    const userId = (socket as SocketWithUser).data.userId;
    if (!userId) {
      throw new WsException('unauthorized socket');
    }
    await this.enforceSocketRate(socket, 'typing');
    await this.pubsubService.publish(MESSAGING_CHANNELS.USER_TYPING, {
      senderId: userId,
      receiverId: dto.receiverId,
      isTyping: dto.isTyping,
      timestamp: new Date().toISOString()
    });
    return { success: true };
  }

  @SubscribeMessage('group:typing')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleGroupTyping(@ConnectedSocket() socket: Socket, @MessageBody() dto: GroupTypingDto) {
    const userId = await this.requireUserId(socket);
    await this.enforceSocketRate(socket, 'typing');
    const allowed = await this.groupsService.isMember(userId, dto.groupId);
    if (!allowed) throw new WsException('not a group member');
    this.server.to(this.groupRoom(dto.groupId)).emit('group:typing', {
      groupId: dto.groupId,
      senderId: userId,
      isTyping: dto.isTyping
    });
    return { success: true };
  }

  @SubscribeMessage('channel:typing')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleChannelTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: ChannelTypingDto
  ) {
    const userId = await this.requireUserId(socket);
    await this.enforceSocketRate(socket, 'typing');
    const allowed = await this.channelsService.isSubscriber(userId, dto.channelId);
    if (!allowed) throw new WsException('not a channel subscriber');
    this.server.to(this.channelRoom(dto.channelId)).emit('channel:typing', {
      channelId: dto.channelId,
      senderId: userId,
      isTyping: dto.isTyping
    });
    return { success: true };
  }

  @SubscribeMessage('presence:heartbeat')
  async handleHeartbeat(@ConnectedSocket() socket: Socket) {
    const userId = await this.requireUserId(socket);
    await this.presenceService.refreshOnline(userId);
    return { success: true };
  }

  @SubscribeMessage('group:join')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleGroupJoin(@ConnectedSocket() socket: Socket, @MessageBody() dto: GroupRoomDto) {
    const userId = await this.requireUserId(socket);
    await this.enforceSocketRate(socket, 'group.join');
    const allowed = await this.groupsService.isMember(userId, dto.groupId);
    if (!allowed) {
      throw new WsException('not a group member');
    }
    await socket.join(this.groupRoom(dto.groupId));
    return { success: true, room: this.groupRoom(dto.groupId) };
  }

  @SubscribeMessage('group:leave')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleGroupLeave(@ConnectedSocket() socket: Socket, @MessageBody() dto: GroupRoomDto) {
    await this.requireUserId(socket);
    await socket.leave(this.groupRoom(dto.groupId));
    return { success: true, room: this.groupRoom(dto.groupId) };
  }

  @SubscribeMessage('group:message:send')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleGroupMessageSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: GroupMessageSendDto
  ) {
    const userId = await this.requireUserId(socket);
    await this.enforceSocketRate(socket, 'group.message');
    const deduped = await this.consumeClientRequestId(userId, 'group', dto.clientRequestId);
    if (deduped) {
      return { success: true, message: 'duplicate suppressed', data: deduped, duplicate: true };
    }
    const message = await this.groupsService.sendGroupMessage(
      userId,
      dto.groupId,
      dto.encryptedContent
    );
    await this.rememberClientRequestId(userId, 'group', dto.clientRequestId, message);
    return { success: true, message: 'group message processed', data: message };
  }

  @SubscribeMessage('channel:join')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleChannelJoin(@ConnectedSocket() socket: Socket, @MessageBody() dto: ChannelRoomDto) {
    const userId = await this.requireUserId(socket);
    await this.enforceSocketRate(socket, 'channel.join');
    const allowed = await this.channelsService.isSubscriber(userId, dto.channelId);
    if (!allowed) {
      throw new WsException('not a channel subscriber');
    }
    await socket.join(this.channelRoom(dto.channelId));
    return { success: true, room: this.channelRoom(dto.channelId) };
  }

  @SubscribeMessage('channel:leave')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleChannelLeave(@ConnectedSocket() socket: Socket, @MessageBody() dto: ChannelRoomDto) {
    await this.requireUserId(socket);
    await socket.leave(this.channelRoom(dto.channelId));
    return { success: true, room: this.channelRoom(dto.channelId) };
  }

  @SubscribeMessage('channel:message:send')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async handleChannelMessageSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: ChannelMessageSendDto
  ) {
    const userId = await this.requireUserId(socket);
    await this.enforceSocketRate(socket, 'channel.message');
    const deduped = await this.consumeClientRequestId(userId, 'channel', dto.clientRequestId);
    if (deduped) {
      return { success: true, message: 'duplicate suppressed', data: deduped, duplicate: true };
    }
    const message = await this.channelsService.postChannelMessage(
      userId,
      dto.channelId,
      dto.encryptedContent
    );
    await this.rememberClientRequestId(userId, 'channel', dto.clientRequestId, message);
    return { success: true, message: 'channel message processed', data: message };
  }

  private async requireUserId(socket: Socket): Promise<string> {
    const client = socket as SocketWithUser;
    const token = client.data.accessToken ?? this.extractToken(socket);
    if (!token) {
      socket.disconnect(true);
      throw new WsException('missing access token');
    }
    try {
      const payload = await this.verifyAccessToken(token);
      if (payload.type !== 'access' || payload.sub !== client.data.userId) {
        throw new WsException('invalid token');
      }
      const session = await this.authSessionService.getSession(payload.sid);
      if (
        !session ||
        session.userId !== payload.sub ||
        session.tokenId !== payload.jti ||
        session.deviceId !== payload.deviceId
      ) {
        throw new WsException('session expired');
      }
      return payload.sub;
    } catch {
      socket.disconnect(true);
      throw new WsException('jwt expired or invalid');
    }
  }

  private async consumeClientRequestId(
    userId: string,
    scope: string,
    clientRequestId: string | undefined
  ): Promise<unknown | null> {
    if (!clientRequestId) return null;
    const key = `ws:idem:${scope}:${userId}:${clientRequestId}`;
    return this.cacheService.getJson(key);
  }

  private async rememberClientRequestId(
    userId: string,
    scope: string,
    clientRequestId: string | undefined,
    payload: unknown
  ): Promise<void> {
    if (!clientRequestId) return;
    const key = `ws:idem:${scope}:${userId}:${clientRequestId}`;
    await this.cacheService.setJson(key, payload, 120);
  }

  private groupRoom(groupId: string): string {
    return `group:${groupId}`;
  }

  private channelRoom(channelId: string): string {
    return `channel:${channelId}`;
  }

  private async verifyAccessToken(token: string): Promise<JwtPayload> {
    let kid: string | undefined;
    try {
      const headerPart = String(token).split('.')[0];
      if (headerPart) {
        const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as {
          kid?: string;
          alg?: string;
        };
        if (header.alg && header.alg !== 'HS256') {
          throw new WsException('unsupported jwt alg');
        }
        kid = typeof header.kid === 'string' ? header.kid : undefined;
      }
    } catch (error) {
      if (error instanceof WsException) throw error;
    }
    const secret =
      this.jwtKeys.getAccessSecret(kid) ??
      (!kid ? this.jwtKeys.getAccessSecret(this.jwtKeys.currentAccessKid) : undefined);
    if (!secret) throw new WsException('unknown jwt kid');
    return this.jwtService.verifyAsync<JwtPayload>(token, this.jwtKeys.accessVerifyOptions(secret));
  }

  private extractToken(socket: Socket): string | null {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim() !== '') {
      return authToken;
    }
    const header = socket.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }
    return null;
  }

  @SubscribeMessage('call:invite')
  async handleCallInvite(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    body: {
      peerUserId?: string;
      scope?: 'dm' | 'group' | 'channel';
      spaceId?: string;
      kind: 'audio' | 'video';
    }
  ) {
    const userId = (socket as SocketWithUser).data.userId;
    if (!userId) throw new WsException('unauthorized socket');
    await this.enforceSocketRate(socket, 'call.invite');
    const kind = body.kind === 'video' ? CallKind.video : CallKind.audio;
    if (body.scope === 'group' || body.scope === 'channel') {
      if (!body.spaceId) throw new WsException('spaceId required');
      const { call, inviteeIds } = await this.callService.startSpaceCall(
        userId,
        body.scope,
        body.spaceId,
        kind
      );
      for (const id of inviteeIds) {
        this.emitToUser(id, 'call:incoming', {
          callId: call.id,
          kind: call.kind,
          scope: call.scope,
          spaceId: body.spaceId,
          from: call.createdBy
        });
      }
      return { success: true, data: call };
    }
    if (!body.peerUserId) throw new WsException('peerUserId required');
    const { call, peer } = await this.callService.startDmCall(userId, body.peerUserId, kind);
    this.emitToUser(body.peerUserId, 'call:incoming', {
      callId: call.id,
      kind: call.kind,
      scope: 'dm',
      from: call.createdBy,
      peer
    });
    return { success: true, data: call };
  }

  @SubscribeMessage('call:accept')
  async handleCallAccept(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { callId: string }
  ) {
    const userId = (socket as SocketWithUser).data.userId;
    if (!userId) throw new WsException('unauthorized socket');
    await this.enforceSocketRate(socket, 'call.accept');
    const call = await this.callService.accept(userId, body.callId);
    for (const p of call.participants) {
      this.emitToUser(p.userId, 'call:accepted', { callId: call.id, by: userId, status: call.status });
    }
    return { success: true, data: call };
  }

  @SubscribeMessage('call:reject')
  async handleCallReject(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { callId: string }
  ) {
    const userId = (socket as SocketWithUser).data.userId;
    if (!userId) throw new WsException('unauthorized socket');
    const call = await this.callService.reject(userId, body.callId);
    for (const p of call.participants) {
      this.emitToUser(p.userId, 'call:ended', { callId: call.id, status: call.status, by: userId });
    }
    return { success: true, data: call };
  }

  @SubscribeMessage('call:end')
  async handleCallEnd(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { callId: string; reason?: string }
  ) {
    const userId = (socket as SocketWithUser).data.userId;
    if (!userId) throw new WsException('unauthorized socket');
    const call = await this.callService.end(userId, body.callId, body.reason || 'ended');
    for (const p of call.participants) {
      this.emitToUser(p.userId, 'call:ended', {
        callId: call.id,
        status: call.status,
        by: userId,
        reason: body.reason || 'ended'
      });
    }
    return { success: true, data: call };
  }

  @SubscribeMessage('call:signal')
  async handleCallSignal(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { callId: string; toUserId: string; signal: unknown }
  ) {
    const userId = (socket as SocketWithUser).data.userId;
    if (!userId) throw new WsException('unauthorized socket');
    await this.callService.assertCanSignal(userId, body.callId);
    // Target must also be a participant — assert via join-time membership on accept/invite.
    this.emitToUser(body.toUserId, 'call:signal', {
      callId: body.callId,
      fromUserId: userId,
      signal: body.signal
    });
    return { success: true };
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  private emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(this.userRoom(userId)).emit(event, payload);
  }

  private trackSocketConnection(userId: string, socketId: string): void {
    if (!this.socketsByUserId.has(userId)) {
      this.socketsByUserId.set(userId, new Set<string>());
    }
    this.socketsByUserId.get(userId)?.add(socketId);
  }

  private trackSocketDisconnection(userId: string, socketId: string): void {
    const sockets = this.socketsByUserId.get(userId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.socketsByUserId.delete(userId);
    }
  }

  private isUserConnectedLocally(userId: string): boolean {
    return (this.socketsByUserId.get(userId)?.size ?? 0) > 0;
  }

  private async enforceSocketRate(socket: Socket, event: string): Promise<void> {
    await this.securityRateLimitService.consumeLimit({
      ip: socket.handshake.address ?? 'unknown',
      scope: `ws:${event}`,
      windowSeconds: this.configService.rateLimitWindowSeconds,
      maxRequests: this.configService.rateLimitWsMaxEvents,
      blockSeconds: this.configService.rateLimitIpBlockSeconds
    });
  }
}
