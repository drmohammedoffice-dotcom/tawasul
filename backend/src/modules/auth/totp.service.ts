import {
  BadRequestException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { openSecret, sealSecret } from './crypto-seal';
import {
  buildOtpAuthUrl,
  generateRecoveryCodes,
  generateTotpSecret,
  verifyTotp
} from './totp.util';
import { AuthSessionService } from './auth-session.service';
import { hashPassword, verifyPassword } from './password-hasher';
import { compare as bcryptCompare } from 'bcryptjs';

@Injectable()
export class TotpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly sessions: AuthSessionService
  ) {}

  private keyMaterial(): string {
    return this.config.otpPepper;
  }

  async beginSetup(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('user not found');
    const verified = await verifyPassword(password, user.passwordHash);
    if (!verified.ok) throw new UnauthorizedException('password required to change MFA');
    if (verified.needsRehash) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(password) }
      });
    }
    if (user.totpEnabledAt) {
      throw new BadRequestException('TOTP already enabled; disable first');
    }

    const { secret, base32 } = generateTotpSecret();
    const sealed = sealSecret(secret.toString('base64url'), this.keyMaterial());
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: sealed, totpEnabledAt: null, totpRecoveryHashes: [] }
    });

    const accountName = user.email || user.username;
    const otpauthUrl = buildOtpAuthUrl({
      issuer: 'Tawasul',
      accountName,
      secretBase32: base32
    });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240
    });
    return {
      secretBase32: base32,
      otpauthUrl,
      qrDataUrl
    };
  }

  async confirmSetup(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecretEnc) throw new BadRequestException('TOTP setup not started');
    if (user.totpEnabledAt) throw new BadRequestException('TOTP already enabled');
    const secret = Buffer.from(openSecret(user.totpSecretEnc, this.keyMaterial()), 'base64url');
    if (!verifyTotp(secret, code)) {
      throw new UnauthorizedException('invalid authenticator code');
    }
    const recovery = generateRecoveryCodes(10);
    const recoveryHashes = await Promise.all(recovery.map((c) => hash(c, 12)));
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabledAt: new Date(),
        totpRecoveryHashes: recoveryHashes
      }
    });
    return {
      enabled: true,
      recoveryCodes: recovery
    };
  }

  async disable(userId: string, password: string, codeOrRecovery: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('user not found');
    const verified = await verifyPassword(password, user.passwordHash);
    if (!verified.ok) throw new UnauthorizedException('password required to change MFA');
    if (!user.totpEnabledAt || !user.totpSecretEnc) {
      throw new BadRequestException('TOTP not enabled');
    }
    const validTotp = verifyTotp(
      Buffer.from(openSecret(user.totpSecretEnc, this.keyMaterial()), 'base64url'),
      codeOrRecovery
    );
    const validRecovery = validTotp
      ? false
      : await this.consumeRecoveryCode(userId, user.totpRecoveryHashes, codeOrRecovery);
    if (!validTotp && !validRecovery) {
      throw new UnauthorizedException('invalid authenticator or recovery code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecretEnc: null,
        totpEnabledAt: null,
        totpRecoveryHashes: []
      }
    });
    await this.sessions.deleteAllForUser(userId);
    return { enabled: false };
  }

  async assertLoginFactor(userId: string, codeOrRecovery: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpEnabledAt || !user.totpSecretEnc) return;
    const secret = Buffer.from(openSecret(user.totpSecretEnc, this.keyMaterial()), 'base64url');
    if (verifyTotp(secret, codeOrRecovery)) return;
    const used = await this.consumeRecoveryCode(userId, user.totpRecoveryHashes, codeOrRecovery);
    if (!used) throw new UnauthorizedException('invalid authenticator code');
  }

  private async consumeRecoveryCode(
    userId: string,
    hashes: string[],
    code: string
  ): Promise<boolean> {
    const normalized = String(code || '').trim().toLowerCase();
    if (!normalized) return false;
    for (let i = 0; i < hashes.length; i++) {
      const entry = hashes[i];
      if (!entry) continue;
      if (await bcryptCompare(normalized, entry)) {
        const next = hashes.filter((_, idx) => idx !== i);
        await this.prisma.user.update({
          where: { id: userId },
          data: { totpRecoveryHashes: next }
        });
        return true;
      }
    }
    return false;
  }
}
