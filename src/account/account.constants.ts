// Legacy texts (develop: src/repositories/accounts/constants/index.ts).
export const ACCOUNT_CREATED_MESSAGE = 'Account created';
export const ACCOUNT_UPDATED_MESSAGE = 'Account Updated';
export const ACCOUNT_DELETED_MESSAGE = 'Account Deleted';
export const ACCOUNT_NOT_FOUND = 'Account not found';
export const ACCOUNT_UNAUTHORIZED_ERROR = 'Account does not belong to the user';

// Inline texts in develop's AccountsService.
export const TERMINATION_DIGITS_ERROR =
  'Termination digits must be a 4-digit number (digits only).';
export const INVALID_PROVIDER_ERROR = 'Invalid account provider';

export const CARD_PROVIDERS = [
  'visa',
  'mastercard',
  'american-express',
] as const;
export const TERMINATION_DIGITS_REGEX = /^[0-9]{4}$/;

// Injection token for the AccountRecordsCascade port (account.interface.ts).
export const ACCOUNT_RECORDS_CASCADE = Symbol('ACCOUNT_RECORDS_CASCADE');
