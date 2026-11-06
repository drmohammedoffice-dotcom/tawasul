import {
  BadRequestException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import { hashPassword } from '../auth/password-hasher';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingProvider } from './messaging-provider';
import {
  generateOtpCode,
  hashOtp,
  normalizePhoneE164,
  safeEqualHash
} from './otp.util';
import { countryFromIp } from '../../common/geo-ip';

@Injectable()
export class PhoneAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingProvider,
    private readonly config: AppConfigService,
    private readonly auth: AuthService
  ) {}

  async requestOtp(input: {
    phone: string;
    dialPrefix?: string;
    purpose: 'register' | 'login' | 'link';
    channel?: 'sms' | 'whatsapp';
    userId?: string;
  }) {
    const phoneE164 = normalizePhoneE164(
      input.dialPrefix && !input.phone.startsWith('+')
        ? `${input.dialPrefix}${input.phone}`
        : input.phone
    );
    if (!phoneE164) throw new BadRequestException('invalid phone number');

    const recent = await this.prisma.phoneOtpChallenge.count({
      where: {
        phoneE164,
        purpose: input.purpose,
        createdAt: { gt: new Date(Date.now() - 60_000) }
      }
    });
    if (recent >= 1) throw new BadRequestException('wait before resending');

    const hourCount = await this.prisma.phoneOtpChallenge.count({
      where: {
        phoneE164,
        createdAt: { gt: new Date(Date.now() - 60 * 60_000) }
      }
    });
    if (hourCount >= 8) throw new BadRequestException('rate limit exceeded');

    // Anti-enumeration: same response whether user exists or not for login/register.
    const code = generateOtpCode(6);
    const codeHash = hashOtp(code, this.pepper());
    await this.prisma.phoneOtpChallenge.create({
      data: {
        phoneE164,
        purpose: input.purpose,
        codeHash,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        channel: input.channel || 'sms',
        userId: input.userId ?? null
      }
    });

    const send = await this.messaging.sendOtp({
      channel: input.channel || 'sms',
      to: phoneE164,
      code,
      purpose: input.purpose
    });

    return {
      ok: true,
      // Do not reveal whether phone is registered.
      delivery: send.ok
        ? { accepted: true, mocked: send.mocked, provider: send.provider }
        : { accepted: false, mocked: send.mocked, provider: send.provider, detail: send.detail },
      ...(this.allowDebugOtp(send.mocked) ? { debugCode: code } : {})
    };
  }

  async verifyAndAuthenticate(
    input: {
      phone: string;
      dialPrefix?: string;
      code: string;
      purpose: 'register' | 'login';
      username?: string;
      deviceId: string;
      countryCode?: string;
      interestKeys?: string[];
      email2faCode?: string;
    },
    context: { ip: string; userAgent: string }
  ) {
    const phoneE164 = normalizePhoneE164(
      input.dialPrefix && !input.phone.startsWith('+')
        ? `${input.dialPrefix}${input.phone}`
        : input.phone
    );
    if (!phoneE164) throw new BadRequestException('invalid phone number');
    // Validate phone OTP without consuming yet — needed when email 2FA is a second step.
    const phoneChallengeId = await this.assertPhoneOtp(phoneE164, input.purpose, input.code);

    let user = await this.prisma.user.findUnique({ where: { phoneE164 } });

    if (input.purpose === 'register') {
      if (user) {
        // Same opaque path as login for existing phone — avoid account enumeration.
      } else {
        const username = await this.allocateUsername(input.username, phoneE164);
        const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
        const countryCode =
          input.countryCode?.toUpperCase()?.slice(0, 2) || (await countryFromIp(context.ip));
        user = await this.prisma.user.create({
          data: {
            username,
            passwordHash,
            phoneE164,
            phoneVerifiedAt: new Date(),
            countryCode,
            passwordSetAt: null
          }
        });
        await this.prisma.wallet.create({ data: { userId: user.id } });
        if (input.interestKeys?.length) {
          const keys = [...new Set(input.interestKeys)].slice(0, 12);
          await this.prisma.userInterest.createMany({
            data: keys.map((interestKey) => ({ userId: user!.id, interestKey })),
            skipDuplicates: true
          });
        }
      }
    } else if (!user) {
      // Uniform error — do not say "phone not registered".
      throw new UnauthorizedException('invalid credentials');
    }

    if (!user) throw new UnauthorizedException('invalid credentials');

    if (user.twoFactorEmailEnabled) {
      if (!user.email) throw new BadRequestException('2fa email missing');
      if (!input.email2faCode) {
        const emailSend = await this.requestEmail2fa(user.id);
        return {
          requiresEmail2fa: true,
          userId: user.id,
          phoneChallengeId,
          maskedEmail: this.maskEmail(user.email),
          ...(emailSend.debugCode ? { debugCode: emailSend.debugCode } : {})
        };
      }
      await this.consumeEmail2fa(user.email, input.email2faCode, user.id);
    }

    await this.prisma.phoneOtpChallenge.update({
      where: { id: phoneChallengeId },
      data: { consumedAt: new Date() }
    });

    if (!user.phoneVerifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date() }
      });
    }

    const tokens = await this.auth.issueTokenPairPublic({
      userId: user.id,
      email: user.email,
      username: user.username,
      deviceId: input.deviceId,
      ip: context.ip,
      userAgent: context.userAgent
    });

    return {
      requiresEmail2fa: false,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phoneE164: user.phoneE164,
        accountType: user.accountType,
        isVerified: user.isVerified
      },
      ...tokens
    };
  }

  async requestEmail2fa(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email || !user.twoFactorEmailEnabled) {
      throw new BadRequestException('email 2fa not enabled');
    }
    const code = generateOtpCode(6);
    const codeHash = hashOtp(code, this.pepper());
    await this.prisma.emailOtpChallenge.create({
      data: {
        email: user.email,
        purpose: 'login_2fa',
        codeHash,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        userId: user.id
      }
    });
    const send = await this.messaging.sendEmailOtp({
      to: user.email,
      code,
      purpose: 'login_2fa'
    });
    return {
      sent: send.ok,
      mocked: send.mocked,
      ...(this.allowDebugOtp(send.mocked) ? { debugCode: code } : {})
    };
  }

  /**
   * Resend email 2FA only after a still-valid (unconsumed) phone OTP challenge for that user.
   * Prevents unauthenticated OTP spam via raw userId.
   */
  async requestEmail2faAfterPhoneChallenge(input: {
    userId: string;
    phoneChallengeId: string;
    phone: string;
    dialPrefix?: string;
    purpose: 'register' | 'login';
    code: string;
  }) {
    const phoneE164 = normalizePhoneE164(
      input.dialPrefix && !input.phone.startsWith('+')
        ? `${input.dialPrefix}${input.phone}`
        : input.phone
    );
    if (!phoneE164) throw new BadRequestException('invalid phone number');
    await this.assertPhoneOtp(phoneE164, input.purpose, input.code);
    const challenge = await this.prisma.phoneOtpChallenge.findFirst({
      where: {
        id: input.phoneChallengeId,
        phoneE164,
        purpose: input.purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      }
    });
    if (!challenge) throw new UnauthorizedException('invalid credentials');
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user || user.phoneE164 !== phoneE164) throw new UnauthorizedException('invalid credentials');
    return this.requestEmail2fa(user.id);
  }

  private allowDebugOtp(mocked: boolean): boolean {
    return (
      mocked &&
      this.messaging.mode === 'mock' &&
      process.env.NODE_ENV !== 'production'
    );
  }

  private async consumeEmail2fa(email: string, code: string, userId: string) {
    const challenge = await this.prisma.emailOtpChallenge.findFirst({
      where: {
        email,
        purpose: 'login_2fa',
        userId,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });
    if (!challenge) throw new UnauthorizedException('invalid credentials');
    const ok = safeEqualHash(challenge.codeHash, hashOtp(code, this.pepper()));
    await this.prisma.emailOtpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 }, ...(ok ? { consumedAt: new Date() } : {}) }
    });
    if (!ok) throw new UnauthorizedException('invalid credentials');
  }

  /** Validates OTP; returns challenge id. Caller must mark consumed after full auth (incl. 2FA). */
  private async assertPhoneOtp(phoneE164: string, purpose: string, code: string) {
    const challenge = await this.prisma.phoneOtpChallenge.findFirst({
      where: {
        phoneE164,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });
    if (!challenge) throw new UnauthorizedException('invalid credentials');
    if (challenge.attempts >= challenge.maxAttempts) {
      throw new BadRequestException('too many attempts');
    }
    const ok = safeEqualHash(challenge.codeHash, hashOtp(code, this.pepper()));
    await this.prisma.phoneOtpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } }
    });
    if (!ok) throw new UnauthorizedException('invalid credentials');
    return challenge.id;
  }

  private async allocateUsername(preferred: string | undefined, phoneE164: string) {
    const base =
      preferred?.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) ||
      `u${phoneE164.replace(/\D/g, '').slice(-8)}`;
    let candidate = base.length >= 1 ? base : `user${base}`;
    for (let i = 0; i < 20; i++) {
      const exists = await this.prisma.user.findUnique({ where: { username: candidate } });
      if (!exists) return candidate;
      candidate = `${base}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 32);
    }
    return `u${Date.now().toString(36)}`;
  }

  private pepper() {
    return this.config.otpPepper;
  }

  private maskEmail(email: string) {
    const [u, d] = email.split('@');
    return `${(u || '').slice(0, 2)}***@${d || ''}`;
  }
}
