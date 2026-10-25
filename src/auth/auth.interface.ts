import type { Request } from 'express';

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

export type AuthenticatedRequest = Request & { user: JwtPayload };

// An interface on purpose: its runtime metatype is Object, so the global ValidationPipe skips it and missing
// fields stay a 401 (legacy passport-local), extra fields are ignored. A class would turn them into 400s.
export interface LoginBody {
  email?: unknown;
  password?: unknown;
}
