import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from '../account/entities/account.entity.js';
import {
  BudgetHistory,
  BudgetHistorySchema,
} from '../budget/entities/budget-history.entity.js';
import { Budget, BudgetSchema } from '../budget/entities/budget.entity.js';
import {
  Category,
  CategorySchema,
} from '../category/entities/category.entity.js';
import config from '../config.js';
import { Expense, ExpenseSchema } from '../record/entities/expense.entity.js';
import { Income, IncomeSchema } from '../record/entities/income.entity.js';
import { MailModule } from '../mail/mail.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { UserController } from './controllers/user.controller.js';
import { User, UserSchema } from './entities/user.entity.js';
import { UserService } from './services/user.service.js';
import { JWT_ONE_TIME_EXPIRE_TIME } from './user.constants.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      // Only for the delete cascade: importing their modules would be a cycle (CategoryModule imports UserModule).
      { name: Category.name, schema: CategorySchema },
      { name: Account.name, schema: AccountSchema },
      { name: Budget.name, schema: BudgetSchema },
      { name: BudgetHistory.name, schema: BudgetHistorySchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: Income.name, schema: IncomeSchema },
    ]),
    MailModule, // provides FORGOT_PASSWORD_MAILER
    RateLimitModule,
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
