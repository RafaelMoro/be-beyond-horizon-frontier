import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import config from '../config.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { UserModule } from '../user/user.module.js';
import { JWT_EXPIRE_TIME } from './auth.constants.js';
import { AuthController } from './controllers/auth.controller.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AuthService } from './services/auth.service.js';

@Module({
  imports: [
    UserModule,
    RateLimitModule,
    // Access-token key. Never make this (or UserModule's one-time JwtModule) global, or the keys mix.
    JwtModule.registerAsync({
      inject: [config.KEY],
      useFactory: (c: ConfigType<typeof config>) => ({
        secret: c.jwtKey,
        signOptions: { expiresIn: JWT_EXPIRE_TIME },
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }, AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
