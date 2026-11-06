import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from '../users/dto/login.dto';
import { RegisterDto } from '../users/dto/register.dto';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { JwtPayload } from './types/jwt-payload.type';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthSessionService } from './auth-session.service';
import { assertPasswordPolicy } from './password-policy';
import { TotpService } from './totp.service';
import { JwtKeysService } from './jwt-keys.service';
import {
  hashOpaqueToken,
  hashPassword,
  verifyOpaqueToken,
  verifyPassword
} from './password-hasher';
import { countryFromIp } from '../../common/geo-ip';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: AppConfigService,
    private readonly authRateLimitService: AuthRateLimitService,
    private readonly authSessionService: AuthSessionService,
    private readonly totpService: TotpService,
    private readonly jwtKeys: JwtKeysService
  ) {}

  async register(dto: RegisterDto, context: { ip: string; userAgent: string }) {
    assertPasswordPolicy(dto.password, { username: dto.username });
    const passwordHash = await hashPassword(dto.password);
    const countryCode = await countryFromIp(context.ip);
    const user = await this.usersService.create({
      username: dto.username,
      passwordHash,
      countryCode
    });
    const tokens = await this.issueTokenPair({
      userId: user.id,
      email: user.email,
      username: user.username,
      deviceId: dto.deviceId,
      ip: context.ip,
      userAgent: context.userAgent
    });
    return { user, ...tokens };
  }

  async login(dto: LoginDto, context: { ip: string; userAgent: string }) {
    const normalizedIdentifier = dto.identifier.toLowerCase();
    await this.authRateLimitService.assertAllowed(normalizedIdentifier, context.ip);

    const user =
      (normalizedIdentifier.includes('@')
        ? await this.usersService.findByEmail(normalizedIdentifier)
        : null) ?? (await this.usersService.findByUsername(dto.identifier));
    if (!user) {
      await this.authRateLimitService.recordFailure(normalizedIdentifier, context.ip);
      throw new UnauthorizedException('invalid credentials');
    }
    const verified = await verifyPassword(dto.password, user.passwordHash);
    if (!verified.ok) {
      await this.authRateLimitService.recordFailure(normalizedIdentifier, context.ip);
      throw new UnauthorizedException('invalid credentials');
    }
    if (verified.needsRehash) {
      const upgraded = await hashPassword(dto.password);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: upgraded }
      });
    }
    await this.authRateLimitService.clearFailures(normalizedIdentifier, context.ip);

    if (user.totpEnabledAt) {
      if (!dto.totpCode) {
        const mfaToken = await this.jwtService.signAsync(
          { sub: user.id, type: 'mfa_pending', deviceId: dto.deviceId },
          {
            ...this.jwtKeys.accessSignOptions(),
            expiresIn: '5m'
          }
        );
        return { requiresMfa: true as const, mfaToken };
      }
      await this.totpService.assertLoginFactor(user.id, dto.totpCode);
    }

    const tokens = await this.issueTokenPair({
      userId: user.id,
      email: user.email,
      username: user.username,
      deviceId: dto.deviceId,
      ip: context.ip,
      userAgent: context.userAgent
    });
    return {
      requiresMfa: false as const,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      ...tokens
    };
  }

  async completeMfaLogin(
    mfaToken: string,
    code: string,
    deviceId: string,
    context: { ip: string; userAgent: string }
  ) {
    let pending: { sub: string; type?: string; deviceId?: string };
    try {
      pending = await this.verifyAccessLikeToken(mfaToken);
    } catch {
      throw new UnauthorizedException('invalid MFA token');
    }
    if (pending.type !== 'mfa_pending' || !pending.sub) {
      throw new UnauthorizedException('invalid MFA token');
    }
    await this.totpService.assertLoginFactor(pending.sub, code);
    const user = await this.usersService.findById(pending.sub);
    const tokens = await this.issueTokenPair({
      userId: user.id,
      email: user.email,
      username: user.username,
      deviceId: deviceId || pending.deviceId || 'unknown',
      ip: context.ip,
      userAgent: context.userAgent
    });
    return {
      requiresMfa: false as const,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      ...tokens
    };
  }

  /**
   * Logout current device/session only: revoke the refresh token + Redis session
   * for this sid/jti. Other devices keep their sessions.
   */
  async logout(input: {
    refreshToken?: string;
    accessSid?: string;
    accessUserId?: string;
  }): Promise<{ loggedOut: true; scope: 'session' }> {
    if (input.refreshToken) {
      try {
        const payload = await this.verifyRefreshToken(input.refreshToken);
        const record = await this.prisma.refreshToken.findUnique({
          where: { tokenId: payload.jti }
        });
        if (record && !record.revokedAt) {
          const validHash = await verifyOpaqueToken(input.refreshToken, record.tokenHash);
          if (validHash) {
            await this.prisma.refreshToken.update({
              where: { id: record.id },
              data: { revokedAt: new Date() }
            });
            await this.authSessionService.deleteSession(payload.sid);
            return { loggedOut: true, scope: 'session' };
          }
        }
      } catch {
        // Fall through to access-sid based logout if refresh is already invalid.
      }
    }

    if (input.accessSid && input.accessUserId) {
      await this.prisma.refreshToken.updateMany({
        where: {
          sessionId: input.accessSid,
          userId: input.accessUserId,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });
      await this.authSessionService.deleteSession(input.accessSid);
      return { loggedOut: true, scope: 'session' };
    }

    throw new UnauthorizedException('refresh token or valid access session is required to logout');
  }

  async refreshToken(rawRefreshToken: string, context: { ip: string; userAgent: string }) {
    const payload = await this.verifyRefreshToken(rawRefreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: {
        tokenId: payload.jti
      }
    });
    if (!record || record.expiresAt <= new Date()) {
      throw new UnauthorizedException('invalid refresh token');
    }

    const validHash = await verifyOpaqueToken(rawRefreshToken, record.tokenHash);
    if (!validHash) {
      throw new UnauthorizedException('invalid refresh token');
    }

    // Reuse of a rotated refresh token ⇒ treat as theft and kill the whole session family.
    if (record.revokedAt) {
      await this.revokeAllSessionsForUser(record.userId);
      throw new UnauthorizedException('invalid refresh token');
    }

    const session = await this.authSessionService.getSession(payload.sid);
    if (
      !session ||
      session.userId !== payload.sub ||
      session.deviceId !== payload.deviceId ||
      session.tokenId !== payload.jti
    ) {
      throw new UnauthorizedException('session expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() }
    });
    await this.authSessionService.deleteSession(payload.sid);

    const user = await this.usersService.findById(payload.sub);
    const tokens = await this.issueTokenPair({
      userId: user.id,
      email: user.email,
      username: user.username,
      deviceId: record.deviceId,
      ip: context.ip,
      userAgent: context.userAgent
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      ...tokens
    };
  }

  /** Revoke every refresh row + Redis session for a user (compromise / password change). */
  async revokeAllSessionsForUser(userId: string): Promise<void> {
    const open = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
      select: { sessionId: true }
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    await this.authSessionService.deleteAllForUser(userId);
    await Promise.all(open.map((row) => this.authSessionService.deleteSession(row.sessionId)));
  }

  /** Used by phone-auth and other alternate login paths. */
  async issueTokenPairPublic(input: {
    userId: string;
    email: string | null;
    username: string;
    deviceId: string;
    ip: string;
    userAgent: string;
  }): Promise<AuthTokens> {
    return this.issueTokenPair(input);
  }

  async getTotpStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabledAt: true }
    });
    return { totpEnabled: Boolean(user?.totpEnabledAt) };
  }

  private async issueTokenPair(input: {
    userId: string;
    email: string | null;
    username: string;
    deviceId: string;
    ip: string;
    userAgent: string;
  }): Promise<AuthTokens> {
    const tokenId = randomUUID();
    const sessionId = randomUUID();
    const accessPayload: JwtPayload = {
      sub: input.userId,
      email: input.email,
      username: input.username,
      deviceId: input.deviceId,
      jti: tokenId,
      sid: sessionId,
      type: 'access'
    };

    const accessToken = await this.jwtService.signAsync(
      accessPayload,
      this.jwtKeys.accessSignOptions()
    );
    const refreshPayload: JwtPayload = { ...accessPayload, type: 'refresh' };
    const refreshToken = await this.jwtService.signAsync(
      refreshPayload,
      this.jwtKeys.refreshSignOptions()
    );

    const refreshTokenHash = await hashOpaqueToken(refreshToken);
    const refreshExpiry = this.parseExpiry(this.configService.jwtRefreshExpiresIn);
    await this.prisma.refreshToken.create({
      data: {
        tokenId,
        sessionId,
        userId: input.userId,
        tokenHash: refreshTokenHash,
        deviceId: input.deviceId,
        expiresAt: refreshExpiry
      }
    });
    const refreshTtlSeconds = Math.max(
      60,
      Math.floor((refreshExpiry.getTime() - Date.now()) / 1000)
    );
    await this.authSessionService.storeSession(
      {
        sessionId,
        userId: input.userId,
        tokenId,
        deviceId: input.deviceId,
        ip: input.ip,
        userAgent: input.userAgent,
        createdAt: new Date().toISOString()
      },
      refreshTtlSeconds
    );

    return { accessToken, refreshToken };
  }

  private async verifyRefreshToken(token: string): Promise<JwtPayload> {
    try {
      const kid = this.readKid(token);
      const secret =
        this.jwtKeys.getRefreshSecret(kid) ??
        (!kid ? this.jwtKeys.getRefreshSecret(this.jwtKeys.currentRefreshKid) : undefined);
      if (!secret) throw new UnauthorizedException('invalid refresh token');
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        token,
        this.jwtKeys.refreshVerifyOptions(secret)
      );
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('invalid token type');
      }
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('invalid refresh token');
    }
  }

  private async verifyAccessLikeToken(token: string): Promise<{
    sub: string;
    type?: string;
    deviceId?: string;
  }> {
    const kid = this.readKid(token);
    const secret =
      this.jwtKeys.getAccessSecret(kid) ??
      (!kid ? this.jwtKeys.getAccessSecret(this.jwtKeys.currentAccessKid) : undefined);
    if (!secret) throw new UnauthorizedException('invalid MFA token');
    return this.jwtService.verifyAsync(token, this.jwtKeys.accessVerifyOptions(secret));
  }

  private readKid(token: string): string | undefined {
    try {
      const headerPart = String(token).split('.')[0];
      if (!headerPart) return undefined;
      const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as {
        kid?: string;
      };
      return typeof header.kid === 'string' ? header.kid : undefined;
    } catch {
      return undefined;
    }
  }

  private parseExpiry(value: string): Date {
    const now = Date.now();
    if (value.endsWith('d')) {
      return new Date(now + Number(value.replace('d', '')) * 24 * 60 * 60 * 1000);
    }
    if (value.endsWith('h')) {
      return new Date(now + Number(value.replace('h', '')) * 60 * 60 * 1000);
    }
    if (value.endsWith('m')) {
      return new Date(now + Number(value.replace('m', '')) * 60 * 1000);
    }
    if (value.endsWith('s')) {
      return new Date(now + Number(value.replace('s', '')) * 1000);
    }
    return new Date(now + 7 * 24 * 60 * 60 * 1000);
  }
}
