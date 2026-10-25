import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ACCOUNT_RECORDS_CASCADE } from './account.constants.js';
import type { AccountRecordsCascade } from './account.interface.js';
import { AccountController } from './controllers/account.controller.js';
import { Account, AccountSchema } from './entities/account.entity.js';
import { AccountService } from './services/account.service.js';

// S7 replaces this default. It must not make AccountModule import RecordModule (RecordModule imports this module).
const noRecordsCascade: AccountRecordsCascade = {
  deleteAccountRecords: () =>
    Promise.resolve({ numberExpensesDeleted: 0, numberIncomesDeleted: 0 }),
};

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Account.name, schema: AccountSchema }]),
  ],
  providers: [
    AccountService,
    { provide: ACCOUNT_RECORDS_CASCADE, useValue: noRecordsCascade },
  ],
  // S7 (records): assertAccountOwned, incrementBalance.
  exports: [AccountService],
  controllers: [AccountController],
})
export class AccountModule {}
