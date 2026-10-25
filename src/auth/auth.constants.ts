export const ACCESS_TOKEN_COOKIE_NAME = 'accessToken';
export const JWT_EXPIRE_TIME = '5d';
export const ACCESS_TOKEN_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
export const IS_PUBLIC_KEY = 'isPublic';
export const LOGIN_ERROR = 'Email or Password incorrect.';

// Cost-10 bcrypt hash of a random throwaway string, never stored on a user. Login compares against it when the
// email is unknown, so unknown and known emails take the same bcrypt time (no user-enumeration timing oracle).
export const DUMMY_PASSWORD_HASH =
  '$2b$10$X69XCKnbRyLxY1PbfvWo4.7xoRkZ3XcB7ShWM0ySCd8XlwAqfg3Dm';
