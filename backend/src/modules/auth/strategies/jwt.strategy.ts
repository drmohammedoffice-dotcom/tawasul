import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthSessionService } from '../auth-session.service';
import { JwtKeysService } from '../jwt-keys.service';
import { JwtPayload } from '../types/jwt-payload.type';

function decodeJwtHeader(rawJwt: string): { kid?: string; alg?: string } {
  const headerPart = String(rawJwt).split('.')[0];
  if (!headerPart) return {};
  try {
    return JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as {
      kid?: string;
      alg?: string;
    };
  } catch {
    return {};
  }
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly authSessionService: AuthSessionService;

  constructor(jwtKeys: JwtKeysService, authSessionService: AuthSessionService) {
    // Capture before super() — Passport binds secretOrKeyProvider without `this`.
    const keys = jwtKeys;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['HS256'],
      issuer: keys.issuer,
      audience: keys.audience,
      secretOrKeyProvider: (
        _request: unknown,
        rawJwtToken: string,
        done: (err: Error | null, secret?: string | Buffer) => void
      ) => {
        try {
          const header = decodeJwtHeader(rawJwtToken);
          if (header.alg && header.alg !== 'HS256') {
            done(new Error('unsupported jwt alg'));
            return;
          }
          const secret =
            keys.getAccessSecret(header.kid) ??
            (!header.kid ? keys.getAccessSecret(keys.currentAccessKid) : undefined);
          if (!secret) {
            done(new Error('unknown jwt kid'));
            return;
          }
          done(null, secret);
        } catch (error) {
          done(error instanceof Error ? error : new Error('jwt key resolution failed'));
        }
      }
    });
    this.authSessionService = authSessionService;
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('invalid access token type');
    }
    if (!payload.sid || !payload.sub || !payload.jti) {
      throw new UnauthorizedException('invalid access token claims');
    }
    const session = await this.authSessionService.getSession(payload.sid);
    if (
      !session ||
      session.userId !== payload.sub ||
      session.tokenId !== payload.jti ||
      session.deviceId !== payload.deviceId
    ) {
      throw new UnauthorizedException('session expired');
    }
    return payload;
  }
}
