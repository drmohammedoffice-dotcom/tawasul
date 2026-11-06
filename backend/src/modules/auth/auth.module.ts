import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigService } from '../config/app-config.service';
import { UsersModule } from '../users/users.module';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthSessionService } from './auth-session.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { JwtKeysService } from './jwt-keys.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (configService: AppConfigService) => ({
        secret: configService.jwtAccessSecret,
        signOptions: {
          expiresIn: configService.jwtAccessExpiresIn as never,
          issuer: configService.jwtIssuer,
          audience: configService.jwtAudience,
          keyid: configService.jwtAccessKid
        }
      })
    })
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRateLimitService,
    AuthSessionService,
    TotpService,
    JwtKeysService,
    JwtStrategy
  ],
  exports: [AuthService, AuthSessionService, TotpService, JwtKeysService, JwtModule]
})
export class AuthModule {}
