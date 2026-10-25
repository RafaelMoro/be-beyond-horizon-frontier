import { createHash } from 'node:crypto';

// The one-time token is stored hashed, so a DB read can't be replayed as a reset link.
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
