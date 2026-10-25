import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import config from '../config.js';
import { MailModule } from '../mail/mail.module.js';
import { UserController } from './controllers/user.controller.js';
import { User, UserSchema } from './entities/user.entity.js';
import { UserService } from './services/user.service.js';
import { JWT_ONE_TIME_EXPIRE_TIME } from './user.constants.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    MailModule, // provides FORGOT_PASSWORD_MAILER
    // One-time reset key (legacy: UsersModule owns it). Never global, or it mixes with AuthModule's access key.
    JwtModule.registerAsync({
      inject: [config.KEY],
      useFactory: (c: ConfigType<typeof config>) => ({
        secret: c.jwtOneTimeKey,
        signOptions: { expiresIn: JWT_ONE_TIME_EXPIRE_TIME },
      }),
    }),
  ],
  providers: [UserService],
  exports: [UserService],
  controllers: [UserController],
})
export class UserModule {}
