import type { ExpenseDoc } from './entities/expense.entity.js';

// What an expense mutation's transaction returns; the response is built after the commit.
export interface ExpenseMutationResult {
  expense: ExpenseDoc;
  messages: string[];
}
