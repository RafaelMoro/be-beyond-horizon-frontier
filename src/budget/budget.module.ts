import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BUDGET_EXPENSES_UNLINK } from './budget.constants.js';
import type { BudgetExpensesUnlink } from './budget.interface.js';
import { BudgetHistoryController } from './controllers/budget-history.controller.js';
import { BudgetController } from './controllers/budget.controller.js';
import {
  BudgetHistory,
  BudgetHistorySchema,
} from './entities/budget-history.entity.js';
import { Budget, BudgetSchema } from './entities/budget.entity.js';
import { BudgetHistoryService } from './services/budget-history.service.js';
import { BudgetService } from './services/budget.service.js';

// S7 replaces this default. It must not make BudgetModule import RecordModule (RecordModule imports this module).
const noExpensesUnlink: BudgetExpensesUnlink = {
  unlinkBudget: () => Promise.resolve(),
};

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Budget.name, schema: BudgetSchema },
      { name: BudgetHistory.name, schema: BudgetHistorySchema },
    ]),
  ],
  providers: [
    BudgetService,
    BudgetHistoryService,
    { provide: BUDGET_EXPENSES_UNLINK, useValue: noExpensesUnlink },
  ],
  // S7 (records): incrementBudgetAmount, addHistoryRecord, removeHistoryRecord; it also provides BUDGET_EXPENSES_UNLINK.
  exports: [BudgetService, BudgetHistoryService],
  controllers: [BudgetController, BudgetHistoryController],
})
export class BudgetModule {}
