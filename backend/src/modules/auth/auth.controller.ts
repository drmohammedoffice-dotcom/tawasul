import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { ok } from '../../common/http/api-response';
import { AuditLogService } from '../audit/audit-log.service';
import { AppConfigService } from '../config/app-config.service';
import { LoginDto } from '../users/dto/login.dto';
import { RegisterDto } from '../users/dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { TotpBeginDto, TotpConfirmDto, TotpDisableDto } from './dto/totp-setup.dto';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtPayload } from './types/jwt-payload.type';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly totpService: TotpService,
    private readonly configService: AppConfigService,
    private readonly auditLogService: AuditLogService,
    private readonly jwtService: JwtService
  ) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.authService.register(dto, {
      ip: req.ip ?? 'unknown',
      userAgent: this.getUserAgent(req)
    });
    await this.auditLogService.record({
      actorUserId: result.user.id,
      actorIp: req.ip ?? 'unknown',
      action: 'auth.register',
      resourceType: 'user',
      resourceId: result.user.id,
      outcome: 'success',
      metadata: { username: result.user.username }
    });
    this.setAuthCookies(res, result);
    return ok('User registered successfully', result);
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.authService.login(dto, {
      ip: req.ip ?? 'unknown',
      userAgent: this.getUserAgent(req)
    });
    if ('requiresMfa' in result && result.requiresMfa) {
      await this.auditLogService.record({
        actorIp: req.ip ?? 'unknown',
        action: 'auth.login.mfa_challenge',
        resourceType: 'user',
        outcome: 'success',
        metadata: { deviceId: dto.deviceId }
      });
      return ok('MFA required', result);
    }
    await this.auditLogService.record({
      actorUserId: result.user.id,
      actorIp: req.ip ?? 'unknown',
      action: 'auth.login',
      resourceType: 'user',
      resourceId: result.user.id,
      outcome: 'success',
      metadata: { username: result.user.username, deviceId: dto.deviceId }
    });
    this.setAuthCookies(res, result);
    return ok('Login successful', result);
  }

  @Post('mfa/verify')
  async verifyMfa(
    @Body() dto: MfaVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.authService.completeMfaLogin(dto.mfaToken, dto.code, dto.deviceId, {
      ip: req.ip ?? 'unknown',
      userAgent: this.getUserAgent(req)
    });
    await this.auditLogService.record({
      actorUserId: result.user.id,
      actorIp: req.ip ?? 'unknown',
      action: 'auth.login.mfa_verified',
      resourceType: 'user',
      resourceId: result.user.id,
      outcome: 'success',
      metadata: { deviceId: dto.deviceId }
    });
    this.setAuthCookies(res, result);
    return ok('Login successful', result);
  }

  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const refreshToken = dto.refreshToken ?? req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('refresh token is required');
    }

    const result = await this.authService.refreshToken(refreshToken, {
      ip: req.ip ?? 'unknown',
      userAgent: this.getUserAgent(req)
    });
    await this.auditLogService.record({
      actorIp: req.ip ?? 'unknown',
      action: 'auth.refresh',
      resourceType: 'token',
      outcome: 'success',
      metadata: { viaCookie: !dto.refreshToken }
    });
    this.setAuthCookies(res, result);
    return ok('Token refreshed successfully', result);
  }

  @Get('mfa/totp/status')
  @UseGuards(JwtAuthGuard)
  async totpStatus(@Req() req: Request & { user: JwtPayload }) {
    const user = await this.authService.getTotpStatus(req.user.sub);
    return ok('TOTP status', user);
  }

  @Post('mfa/totp/begin')
  @UseGuards(JwtAuthGuard)
  async totpBegin(
    @Req() req: Request & { user: JwtPayload },
    @Body() dto: TotpBeginDto
  ) {
    const data = await this.totpService.beginSetup(req.user.sub, dto.password);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'auth.totp.begin',
      resourceType: 'user',
      resourceId: req.user.sub,
      outcome: 'success'
    });
    return ok('TOTP setup started', data);
  }

  @Post('mfa/totp/confirm')
  @UseGuards(JwtAuthGuard)
  async totpConfirm(
    @Req() req: Request & { user: JwtPayload },
    @Body() dto: TotpConfirmDto
  ) {
    const data = await this.totpService.confirmSetup(req.user.sub, dto.code);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'auth.totp.enable',
      resourceType: 'user',
      resourceId: req.user.sub,
      outcome: 'success'
    });
    return ok('TOTP enabled', data);
  }

  @Post('mfa/totp/disable')
  @UseGuards(JwtAuthGuard)
  async totpDisable(
    @Req() req: Request & { user: JwtPayload },
    @Body() dto: TotpDisableDto
  ) {
    const data = await this.totpService.disable(req.user.sub, dto.password, dto.code);
    await this.auditLogService.record({
      actorUserId: req.user.sub,
      actorIp: req.ip ?? 'unknown',
      action: 'auth.totp.disable',
      resourceType: 'user',
      resourceId: req.user.sub,
      outcome: 'success'
    });
    return ok('TOTP disabled', data);
  }

  @Post('logout')
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const refreshToken = dto.refreshToken ?? req.cookies?.refreshToken;
    const access = this.tryReadAccessPayload(req);
    const result = await this.authService.logout({
      ...(refreshToken ? { refreshToken } : {}),
      ...(access?.sid ? { accessSid: access.sid } : {}),
      ...(access?.sub ? { accessUserId: access.sub } : {})
    });
    await this.auditLogService.record({
      ...(access?.sub ? { actorUserId: access.sub } : {}),
      actorIp: req.ip ?? 'unknown',
      action: 'auth.logout',
      resourceType: 'session',
      ...(access?.sid ? { resourceId: access.sid } : {}),
      outcome: 'success',
      metadata: { scope: result.scope }
    });
    this.clearAuthCookies(res);
    return ok('Logged out', result);
  }

  private tryReadAccessPayload(req: Request): JwtPayload | undefined {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return undefined;
    }
    try {
      const payload = this.jwtService.verify(header.slice(7), {
        secret: this.configService.jwtAccessSecret
      }) as JwtPayload;
      if (payload.type !== 'access') return undefined;
      return payload;
    } catch {
      return undefined;
    }
  }

  private clearAuthCookies(res: Response): void {
    if (!this.configService.authCookieEnabled) return;
    const common = {
      httpOnly: true,
      secure: this.configService.authCookieSecure,
      sameSite: this.configService.authCookieSameSite,
      domain: this.configService.authCookieDomain,
      path: '/'
    } as const;
    res.clearCookie('accessToken', common);
    res.clearCookie('refreshToken', common);
  }

  private setAuthCookies(
    res: Response,
    payload: { accessToken: string; refreshToken: string }
  ): void {
    if (!this.configService.authCookieEnabled) {
      return;
    }

    const common = {
      httpOnly: true,
      secure: this.configService.authCookieSecure,
      sameSite: this.configService.authCookieSameSite,
      domain: this.configService.authCookieDomain,
      path: '/'
    } as const;

    res.cookie('accessToken', payload.accessToken, {
      ...common
    });
    res.cookie('refreshToken', payload.refreshToken, {
      ...common
    });
  }

  private getUserAgent(req: Request): string {
    const ua = req.headers['user-agent'];
    if (!ua) return 'unknown';
    return Array.isArray(ua) ? ua.join(', ') : ua;
  }
}
