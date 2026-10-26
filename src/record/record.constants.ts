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
// develop: src/repositories/incomes/incomes.constants.ts.
export const INCOME_NOT_FOUND = 'Income not found.';
export const INCOME_UNAUTHORIZED_ERROR =
  'This income does not belongs to the user';
export const UNAUTHORIZED_INCOMES_ERROR =
  "You're unauthorized to see these incomes.";
export const INCOME_CREATED_MESSAGE = 'Income created';
export const INCOME_DELETED_MESSAGE = 'Income deleted';
// New (Q1): an `expensesPaid` element that is neither an id nor `{ _id: id }`.
export const INVALID_EXPENSES_PAID =
  'expensesPaid must contain expense ids or expenses.';

export const MAX_LINKED_BUDGETS = 3;

// The fields a record PUT may $set, shared by expenses and incomes. Never recordId or userId.
export const RECORD_UPDATABLE_FIELDS = [
  'shortName',
  'typeOfRecord',
  'description',
  'amount',
  'date',
  'category',
  'subCategory',
  'tag',
  'indebtedPeople',
  'transferRecord',
  'account',
  'budgets',
] as const;
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

export const EXPENSES_PAID_POPULATE = {
  path: 'expensesPaid',
  select: '_id shortName amountFormatted fullDate formattedTime',
};

// develop: src/domain/records/constants/index.ts (the /records listing and transfer texts).
export const NO_EXPENSES_INCOMES_FOUND = 'No incomes or expenses found.';
export const NO_EXPENSES_FOUND = 'No expenses found.';
export const NO_INCOMES_FOUND = 'No incomes found.';
export const TRANSFER_ACCOUNT_ERROR =
  'Income account and expense account must be different';
export const TRANSFER_EXPENSE_NOT_PAID =
  'The expense transfer record must have value isPaid as true';
export const TRANSFER_EXPENSE_BUDGETS =
  'The expense transfer record cannot have linked budgets';
export const transferMismatch = (
  field: 'short name' | 'amounts' | 'dates' | 'category' | 'subCategory',
) => `Transfer records has different ${field}. Both must have the same value`;
