// Legacy texts (develop: src/budgets/budgets.constants.ts, src/budget-history/budget-history.constants.ts).
export const BUDGET_CREATED_MESSAGE = 'New budget created';
export const BUDGET_NOT_FOUND_ERROR = 'Budget not found';
export const BUDGETS_NOT_FOUND_ERROR = 'Budgets not found';
export const BUDGET_DELETED_MESSAGE = 'Budget deleted';
export const BUDGET_HISTORY_CREATED = 'New budget history created';
export const BUDGET_HISTORY_NOT_FOUND_ERROR = 'Budget history not found';
export const BUDGET_HISTORY_DELETED_MESSAGE = 'Budget history deleted';

// Inline texts in develop's services. Both PUTs answer this (sic, develop, also for PUT /budgets).
export const BUDGET_UPDATED_MESSAGE = 'Budget history updated';
export const RECORD_ADDED_MESSAGE = 'Record added to budget history';
export const RECORD_REMOVED_MESSAGE = 'Record removed from budget history';

// Injection token for the BudgetExpensesUnlink port (budget.interface.ts).
export const BUDGET_EXPENSES_UNLINK = Symbol('BUDGET_EXPENSES_UNLINK');
