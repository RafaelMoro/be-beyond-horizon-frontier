import type { ExpenseDoc } from './entities/expense.entity.js';
import type { IncomeDoc } from './entities/income.entity.js';

// What an expense mutation's transaction returns; the response is built after the commit.
export interface ExpenseMutationResult {
  expense: ExpenseDoc;
  messages: string[];
}

export interface IncomeMutationResult {
  income: IncomeDoc;
  messages: string[];
}
