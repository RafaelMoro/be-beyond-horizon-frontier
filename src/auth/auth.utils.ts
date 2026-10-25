import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE_NAME } from './auth.constants.js';

// Cookie wins over the header (legacy LoggedMiddleware); a bad cookie does not fall back to the header.
export function extractToken(req: Request): string | undefined {
  const cookie: unknown = req.cookies?.[ACCESS_TOKEN_COOKIE_NAME];
  if (typeof cookie === 'string' && cookie !== '') return cookie;
  // Case-insensitive scheme, like passport's fromAuthHeaderAsBearerToken.
  return /^bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
}
