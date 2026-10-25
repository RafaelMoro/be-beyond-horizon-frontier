import type { ClientSession } from 'mongoose';

// Port for pulling a deleted budget from expenses' `linkedBudgets`; S7 (records) provides the real implementation.
export interface BudgetExpensesUnlink {
  unlinkBudget(args: {
    budgetId: string;
    sub: string;
    session: ClientSession;
  }): Promise<void>;
}
