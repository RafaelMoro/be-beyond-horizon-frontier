import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountController } from './controllers/account.controller.js';
import { Account, AccountSchema } from './entities/account.entity.js';
import { AccountService } from './services/account.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Account.name, schema: AccountSchema }]),
  ],
  // ACCOUNT_RECORDS_CASCADE comes from the global RecordModule (which imports this module).
  providers: [AccountService],
  // S7 (records): assertAccountOwned, incrementBalance.
  exports: [AccountService],
  controllers: [AccountController],
})
export class AccountModule {}
