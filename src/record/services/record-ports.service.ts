import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import type { AccountRecordsCascade } from '../../account/account.interface.js';
import type { BudgetExpensesUnlink } from '../../budget/budget.interface.js';
import { Expense } from '../entities/expense.entity.js';
import { Income } from '../entities/income.entity.js';

// The ports other modules call (BUDGET_EXPENSES_UNLINK, ACCOUNT_RECORDS_CASCADE). Depends only on record models:
// BudgetService and AccountService inject this, so injecting them (directly or via a record service) here would be a
// provider cycle.
@Injectable()
export class RecordPortsService
  implements BudgetExpensesUnlink, AccountRecordsCascade
{
  constructor(
    @InjectModel(Expense.name) private readonly expenseModel: Model<Expense>,
    @InjectModel(Income.name) private readonly incomeModel: Model<Income>,
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

  // Only the owner's records on that account string, in the account-delete transaction. Narrow legacy scope (research
  // §8): no budget, history, paid-flag or transfer-counterpart effects. Sequential: one session, no parallel ops.
  async deleteAccountRecords({
    accountId,
    sub,
    session,
  }: {
    accountId: string;
    sub: string;
    session: ClientSession;
  }): Promise<{ numberExpensesDeleted: number; numberIncomesDeleted: number }> {
    const filter = { userId: sub, account: accountId };
    const e = await this.expenseModel.deleteMany(filter, { session }).exec();
    const i = await this.incomeModel.deleteMany(filter, { session }).exec();
    return {
      numberExpensesDeleted: e.deletedCount,
      numberIncomesDeleted: i.deletedCount,
    };
  }
}
