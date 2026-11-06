import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { INTEREST_KEYS } from './business-categories';
import { MessagingProvider } from './messaging-provider';
import { generateOtpCode, hashOtp, normalizePhoneE164, safeEqualHash } from './otp.util';
import { AuthService } from '../auth/auth.service';
import { AuthSessionService } from '../auth/auth-session.service';
import { assertPasswordPolicy } from '../auth/password-policy';
import { hashPassword, verifyPassword } from '../auth/password-hasher';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class AccountSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingProvider,
    private readonly config: AppConfigService,
    private readonly authService: AuthService,
    private readonly authSessionService: AuthSessionService
  ) {}

  async accountInfo(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        email: true,
        phoneE164: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        countryCode: true,
        accountType: true,
        isPrivate: true,
        isVerified: true,
        twoFactorEmailEnabled: true,
        totpEnabledAt: true,
        passwordSetAt: true,
        createdAt: true,
        interests: { select: { interestKey: true } }
      }
    });
    if (!user) throw new NotFoundException('user not found');
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        deviceId: true,
        createdAt: true,
        expiresAt: true,
        tokenId: true
      }
    });
    const { totpEnabledAt, ...safeUser } = user;
    return {
      ...safeUser,
      totpEnabled: Boolean(totpEnabledAt),
      phoneE164: user.phoneE164,
      interests: user.interests.map((i) => i.interestKey),
      interestCatalog: INTEREST_KEYS,
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceId: s.deviceId,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt
      })),
      otpMessagingMode: this.messaging.mode
    };
  }

  async updateCountry(userId: string, countryCode: string) {
    const code = String(countryCode || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) throw new BadRequestException('invalid country code');
    return this.prisma.user.update({
      where: { id: userId },
      data: { countryCode: code },
      select: { countryCode: true }
    });
  }

  async setInterests(userId: string, keys: string[]) {
    const allowed = new Set<string>(INTEREST_KEYS as unknown as string[]);
    const unique = [...new Set(keys.map((k) => String(k).toLowerCase()))].filter((k) =>
      allowed.has(k)
    );
    if (unique.length < 1) throw new BadRequestException('select at least one interest');
    if (unique.length > 12) throw new BadRequestException('too many interests');
    await this.prisma.$transaction([
      this.prisma.userInterest.deleteMany({ where: { userId } }),
      this.prisma.userInterest.createMany({
        data: unique.map((interestKey) => ({ userId, interestKey }))
      })
    ]);
    return { interests: unique };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('user not found');
    assertPasswordPolicy(newPassword, { username: user.username, email: user.email });
    const verified = await verifyPassword(currentPassword, user.passwordHash);
    if (!verified.ok) throw new UnauthorizedException('current password incorrect');
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordSetAt: new Date() }
    });
    // Password change ⇒ kill every session (attacker with stolen refresh loses access).
    await this.authService.revokeAllSessionsForUser(userId);
    return { changed: true, sessionsRevoked: true };
  }

  async setTwoFactorEmail(userId: string, enabled: boolean, emailCode?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('user not found');
    if (!user.email) throw new BadRequestException('link an email first');
    if (enabled) {
      if (!emailCode) throw new BadRequestException('email verification code required');
      await this.consumeEmailOtp(user.email, 'enable_2fa', emailCode, userId);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEmailEnabled: enabled, emailVerifiedAt: user.emailVerifiedAt ?? new Date() }
    });
    return { twoFactorEmailEnabled: enabled };
  }

  async requestEmailOtp(userId: string, purpose: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email) throw new BadRequestException('email not linked');
    return this.createEmailOtp(user.email, purpose, userId);
  }

  async linkEmail(userId: string, email: string, code: string) {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BadRequestException('invalid email');
    }
    const taken = await this.prisma.user.findFirst({
      where: { email: normalized, id: { not: userId } }
    });
    if (taken) throw new BadRequestException('email in use');
    await this.consumeEmailOtp(normalized, 'link_email', code, userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { email: normalized, emailVerifiedAt: new Date() }
    });
    return { email: normalized };
  }

  async requestLinkEmailOtp(userId: string, email: string) {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BadRequestException('invalid email');
    }
    return this.createEmailOtp(normalized, 'link_email', userId);
  }

  async revokeSession(userId: string, sessionRowId: string) {
    const row = await this.prisma.refreshToken.findFirst({
      where: { id: sessionRowId, userId }
    });
    if (!row) throw new NotFoundException('session not found');
    await this.prisma.refreshToken.update({
      where: { id: sessionRowId },
      data: { revokedAt: new Date() }
    });
    await this.authSessionService.deleteSession(row.sessionId);
    return { revoked: true };
  }

  async listBlocked(userId: string) {
    const rows = await this.prisma.userBlock.findMany({
      where: { blockerId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        blocked: {
          select: { id: true, username: true, displayName: true, avatarUrl: true }
        }
      }
    });
    return rows.map((r) => ({ ...r.blocked, blockedAt: r.createdAt }));
  }

  private pepper() {
    return this.config.otpPepper;
  }

  private async createEmailOtp(email: string, purpose: string, userId?: string) {
    const recent = await this.prisma.emailOtpChallenge.count({
      where: {
        email,
        purpose,
        createdAt: { gt: new Date(Date.now() - 60_000) }
      }
    });
    if (recent >= 1) throw new BadRequestException('wait before resending');
    const code = generateOtpCode(6);
    const codeHash = hashOtp(code, this.pepper());
    await this.prisma.emailOtpChallenge.create({
      data: {
        email,
        purpose,
        codeHash,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        userId: userId ?? null
      }
    });
    const send = await this.messaging.sendEmailOtp({ to: email, code, purpose });
    return {
      sent: send.ok,
      mocked: send.mocked,
      provider: send.provider,
      // Dev-only hint when mocked — never in production responses ideally; gated by mode.
      ...(send.mocked &&
      this.messaging.mode === 'mock' &&
      process.env.NODE_ENV !== 'production'
        ? { debugCode: code }
        : {})
    };
  }

  private async consumeEmailOtp(email: string, purpose: string, code: string, userId?: string) {
    const challenge = await this.prisma.emailOtpChallenge.findFirst({
      where: {
        email,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });
    if (!challenge) throw new BadRequestException('code expired or missing');
    if (challenge.attempts >= challenge.maxAttempts) {
      throw new BadRequestException('too many attempts');
    }
    const ok = safeEqualHash(challenge.codeHash, hashOtp(code, this.pepper()));
    await this.prisma.emailOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts: { increment: 1 },
        ...(ok ? { consumedAt: new Date() } : {})
      }
    });
    if (!ok) throw new UnauthorizedException('invalid code');
    if (userId && challenge.userId && challenge.userId !== userId) {
      throw new UnauthorizedException('invalid code');
    }
  }

  normalizePhone(raw: string, dialPrefix?: string) {
    const combined = dialPrefix && !String(raw).startsWith('+') ? `${dialPrefix}${raw}` : raw;
    return normalizePhoneE164(combined);
  }
}
