import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ACCOUNT_RECORDS_CASCADE } from '../account/account.constants.js';
import { AccountModule } from '../account/account.module.js';
import { BUDGET_EXPENSES_UNLINK } from '../budget/budget.constants.js';
import { BudgetModule } from '../budget/budget.module.js';
import { CategoryModule } from '../category/category.module.js';
import { ExpenseController } from './controllers/expense.controller.js';
import { IncomeController } from './controllers/income.controller.js';
import { Expense, ExpenseSchema } from './entities/expense.entity.js';
import { Income, IncomeSchema } from './entities/income.entity.js';
import { ExpenseService } from './services/expense.service.js';
import { IncomeService } from './services/income.service.js';
import { RecordPortsService } from './services/record-ports.service.js';
import { RecordService } from './services/record.service.js';
import { RecordController } from './controllers/record.controller.js';

// Global so AccountModule and BudgetModule resolve their ports without importing this module (E7.Q2; this module
// imports both).
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Expense.name, schema: ExpenseSchema },
      { name: Income.name, schema: IncomeSchema },
    ]),
    AccountModule,
    BudgetModule,
    CategoryModule,
  ],
  providers: [
    ExpenseService,
    IncomeService,
    RecordPortsService,
    { provide: BUDGET_EXPENSES_UNLINK, useExisting: RecordPortsService },
    { provide: ACCOUNT_RECORDS_CASCADE, useExisting: RecordPortsService },
    RecordService,
  ],
  exports: [BUDGET_EXPENSES_UNLINK, ACCOUNT_RECORDS_CASCADE],
  controllers: [ExpenseController, IncomeController, RecordController],
})
export class RecordModule {}
