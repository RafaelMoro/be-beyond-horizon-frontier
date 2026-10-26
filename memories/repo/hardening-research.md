# S8 hardening — research notes

- Index script: never `Model.syncIndexes()` on prod: it drops indexes not in the schema (`createexpenses` `date_1`, `userId_1`). `diffIndexes()` = dry run, `createIndexes()` = create only.
- Node here is 22.16: no default TS stripping, and `.js`-suffixed relative imports don't resolve under `--experimental-strip-types`; no tsx. Scripts that reuse app code must live under `src/` (compiled by `nest build`).
- Login reaches the backend from old-next's Vercel server (no client IP forwarded): rate-limit login per email, never per IP. forgot-password is called from the browser, so per IP works there (needs `trust proxy` in S9).
- Guards run before pipes: a limiter on `POST /auth`/forgot-password sees an unvalidated body (`email` may be any type).
- `@nestjs/throttler` sets `X-RateLimit-*` headers on every limited response unless disabled (AC2 of S8).
