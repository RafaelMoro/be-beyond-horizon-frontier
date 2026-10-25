# mail research notes (2026-10-25)

- `@react-email/tailwind` 2.x throws on render if hover:/focus: (non-inlinable) classes are used and no `<head>` is inside `<Tailwind>`. Legacy `ResetPassword.tsx` has `<Head>` outside — it can't be ported byte-for-byte.
- `resend` v6 returns `{ error }` for HTTP and network failures (never throws for them), has no default timeout (pass `signal`), throws on construct without a key, and `console.error`s the full API error whenever `NODE_ENV !== 'production'` (can include addresses).
- With `react:`, resend dynamic-imports `@react-email/render` from its own location; under pnpm that needs `@react-email/render` as a direct dependency.
- `@nestjs/config` won't override keys already in `process.env`; `test/setup-env.ts` must set/blank any key tests must not take from `.env`.
