import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountModule } from '../account/account.module.js';
import { BUDGET_EXPENSES_UNLINK } from '../budget/budget.constants.js';
import { BudgetModule } from '../budget/budget.module.js';
import { CategoryModule } from '../category/category.module.js';
import { ExpenseController } from './controllers/expense.controller.js';
import { Expense, ExpenseSchema } from './entities/expense.entity.js';
import { ExpenseService } from './services/expense.service.js';
import { RecordPortsService } from './services/record-ports.service.js';

// Global so BudgetModule resolves the port without importing this module (E7.Q2; this module imports BudgetModule).
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Expense.name, schema: ExpenseSchema }]),
    AccountModule,
    BudgetModule,
    CategoryModule,
  ],
  providers: [
    ExpenseService,
    RecordPortsService,
    { provide: BUDGET_EXPENSES_UNLINK, useExisting: RecordPortsService },
  ],
  exports: [BUDGET_EXPENSES_UNLINK],
  controllers: [ExpenseController],
})
export class RecordModule {}
