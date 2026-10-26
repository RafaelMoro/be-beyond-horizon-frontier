# hardening-code (S8a) planning notes (2026-10-25, approved, implemented)

- User-delete cascade: `UserModule` registers the six owned schemas with `forFeature` (entity imports only). `@nestjs/mongoose` reuses a compiled model (`connection.models[name]`), so it's the same model other modules use; no module import, no cycle. Chosen over a `RecordModule` port.
- Rate limit: own `RateLimitService` on mongoose, no `@nestjs/throttler` (in-memory store, `X-RateLimit-*` headers, pre-pipe body). Fixed window in `_id` = `scope:sha256(trim+lowercase value):bucket`, `$inc` + `$setOnInsert` upsert: needs no unique index beyond `_id`, so it's correct in prod before S8b; the TTL index on `expiresAt` only cleans up.
- Per-IP forgot-password uses `req.ip`, the socket address until S9 sets `trust proxy`; X-Forwarded-For is ignored until then.
- helmet 8.3.0: zero deps, ESM `import helmet from 'helmet'`, types bundled; plain middleware, Express-5-agnostic. First `app.use` in `configureApp`.
