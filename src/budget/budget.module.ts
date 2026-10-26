import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BudgetHistoryController } from './controllers/budget-history.controller.js';
import { BudgetController } from './controllers/budget.controller.js';
import {
  BudgetHistory,
  BudgetHistorySchema,
} from './entities/budget-history.entity.js';
import { Budget, BudgetSchema } from './entities/budget.entity.js';
import { BudgetHistoryService } from './services/budget-history.service.js';
import { BudgetService } from './services/budget.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Budget.name, schema: BudgetSchema },
      { name: BudgetHistory.name, schema: BudgetHistorySchema },
    ]),
  ],
  providers: [BudgetService, BudgetHistoryService],
  // S7 (records): incrementBudgetAmount, addHistoryRecord, removeHistoryRecord. BUDGET_EXPENSES_UNLINK comes from the
  // global RecordModule (it must not import RecordModule: RecordModule imports this module).
  exports: [BudgetService, BudgetHistoryService],
  controllers: [BudgetController, BudgetHistoryController],
})
export class BudgetModule {}
