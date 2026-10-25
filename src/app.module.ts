import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import config, { envSchema } from './config.js';
import { mongooseOptions } from './mongoose-options.js';
import { UserModule } from './user/user.module.js';
import { AuthModule } from './auth/auth.module.js';
import { MailModule } from './mail/mail.module.js';
import { CategoryModule } from './category/category.module.js';
import { AccountModule } from './account/account.module.js';
import { BudgetModule } from './budget/budget.module.js';
import { RecordModule } from './record/record.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env',
      load: [config],
      isGlobal: true,
      validationSchema: envSchema,
    }),
    MongooseModule.forRootAsync({
      inject: [config.KEY],
      useFactory: mongooseOptions,
    }),
    UserModule,
    AuthModule,
    MailModule,
    CategoryModule,
    AccountModule,
    BudgetModule,
    RecordModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
