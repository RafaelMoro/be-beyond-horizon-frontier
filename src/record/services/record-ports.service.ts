import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import type { BudgetExpensesUnlink } from '../../budget/budget.interface.js';
import { Expense } from '../entities/expense.entity.js';

// The ports other modules call. Depends only on record models: BudgetService injects this, so injecting BudgetService
// (directly or via ExpenseService) here would be a provider cycle.
@Injectable()
export class RecordPortsService implements BudgetExpensesUnlink {
  constructor(
    @InjectModel(Expense.name) private readonly expenseModel: Model<Expense>,
  ) {}

  // Only the owner's expenses (AC4), in the budget-delete transaction.
  async unlinkBudget({
    budgetId,
    sub,
    session,
  }: {
    budgetId: string;
    sub: string;
    session: ClientSession;
  }): Promise<void> {
    await this.expenseModel
      .updateMany(
        { userId: sub, linkedBudgets: budgetId },
        { $pull: { linkedBudgets: budgetId } },
        { session },
      )
      .exec();
  }
}
