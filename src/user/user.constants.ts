// Legacy texts (be-budgt-master src/users/constants/index.ts): the client matches on them.
export const USER_CREATED_MESSAGE = 'User created';
export const PROFILE_UPDATE = 'Profile updated';
export const FORGOT_PASSWORD_MESSAGE = 'Email Sent';
export const RESET_PASSWORD_MESSAGE = 'Reset Password Successfully';
export const DELETE_USER_MESSAGE = 'User deleted.';

export const USER_EXISTS_ERROR = 'Try with other email.';
export const EMAIL_CHANGE_ERROR = 'You cannot change your email';
export const USER_NOT_FOUND_ERROR = 'User not found.';
export const PASSWORD_DIRECT_CHANGE_ERROR =
  'You cannot change your password directly. Try changing it using forgot password';
export const JWT_NOT_FOUND = 'JWT not found.';
export const WRONG_JWT_ERROR = 'Wrong JWT';

export const BCRYPT_COST = 10;
export const JWT_ONE_TIME_EXPIRE_TIME = '1d';

export const FORGOT_PASSWORD_MAILER = Symbol('FORGOT_PASSWORD_MAILER');
