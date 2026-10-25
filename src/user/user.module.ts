import { Logger, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import config from '../config.js';
import { UserController } from './controllers/user.controller.js';
import { User, UserSchema } from './entities/user.entity.js';
import { UserService } from './services/user.service.js';
import {
  FORGOT_PASSWORD_MAILER,
  JWT_ONE_TIME_EXPIRE_TIME,
} from './user.constants.js';
import type { ForgotPasswordMailer } from './user.interface.js';

const logger = new Logger('ForgotPasswordMailer');

// No-op until S3 adds the real mail send. Never log the email or the token.
const noopMailer: ForgotPasswordMailer = {
  sendForgotPasswordEmail: async () => {
    logger.warn('forgot-password mail not configured');
  },
};

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    // One-time reset key (legacy: UsersModule owns it). Never global, or it mixes with AuthModule's access key.
    JwtModule.registerAsync({
      inject: [config.KEY],
      useFactory: (c: ConfigType<typeof config>) => ({
        secret: c.jwtOneTimeKey,
        signOptions: { expiresIn: JWT_ONE_TIME_EXPIRE_TIME },
      }),
    }),
  ],
  providers: [
    UserService,
    { provide: FORGOT_PASSWORD_MAILER, useValue: noopMailer },
  ],
  exports: [UserService],
  controllers: [UserController],
})
export class UserModule {}
