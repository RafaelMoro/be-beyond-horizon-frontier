// E8.Q6. Constants on purpose: no env keys.
export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  forgotPasswordEmail: { limit: 3, windowMs: 3_600_000 },
  forgotPasswordIp: { limit: 10, windowMs: 3_600_000 },
} as const;

export type RateLimitScope = keyof typeof RATE_LIMITS;

export const TOO_MANY_REQUESTS = 'Too Many Requests';
