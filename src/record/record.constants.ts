// Legacy texts (develop: src/domain/records/constants/index.ts, src/repositories/expenses/expenses.constants.ts).
// The records' type text, not expenses' 'Invalid type of record for expense' (develop's expenses route threw this one).
export const TYPE_OF_RECORD_INVALID = 'Invalid type of record';
export const TRANSFER_RECORD_LINKED_BUDGET_ERROR =
  'Transfer record cannot be linked to budget';
export const MAXIMUM_BUDGETS_LIMIT_ERROR =
  'The maximum number of budgets are 3';
export const EXPENSE_NOT_FOUND = 'Expense not found.';
export const EXPENSES_NOT_FOUND = 'Expenses not found.';
export const EXPENSE_UNAUTHORIZED_ERROR =
  'This expense does not belongs to the user';
export const MISSING_DATE = 'date prop is missing.';
export const MISSING_CATEGORY = 'category prop is missing.';
export const MISSING_AMOUNT = 'amount prop is missing.';
export const MISSING_LINKED_BUDGETS = 'linkedBudgets prop is missing.';
export const EXPENSE_CREATED_MESSAGE = 'Expense created';
export const EXPENSE_DELETED_MESSAGE = 'Expense deleted';

export const MAX_LINKED_BUDGETS = 3;
export const MEXICO_CITY_TZ = 'America/Mexico_City';

// Route param months (old-next's ABBREVIATED_MONTHS), exact case (D11).
export const ABBREVIATED_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
// Legacy fullDate parts (Spanish, 'Sept' sic).
export const FULL_DATE_WEEKDAYS = [
  'Dom',
  'Lun',
  'Mar',
  'Mie',
  'Jue',
  'Vie',
  'Sab',
] as const;
export const FULL_DATE_MONTHS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sept',
  'Oct',
  'Nov',
  'Dic',
] as const;

export const CATEGORY_POPULATE = {
  path: 'category',
  select: '_id categoryName icon',
};
