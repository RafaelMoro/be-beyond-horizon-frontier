# auth-users research notes (2026-10-25)

- `@nestjs/jwt` 12.0.3 is ESM but still wraps jsonwebtoken 9 — the reset-password error texts (`'jwt expired'`, `'invalid signature'`) survive.
- passport-local reads `req.body[field] || req.query[field]`: credentials from the query string. A plain guard reading only `req.body` avoids it.
- Legacy login has no DTO: missing field → 401 `{message:'Unauthorized',statusCode:401}`, extra fields ignored. A class-validator DTO would change both.
- A global guard 401s S1's e2e `ProbeController` and `GET /` unless they get `@Public()`.
- `@nestjs/mapped-types` is not installed (legacy got `PartialType` from `@nestjs/swagger`).
- Prod owner fields are strings everywhere (`accounts.sub`, `categories.sub`, budgets `sub`, records `userId`) — S8 cascade must match string and ObjectId.
- old-next takes `set-cookie[0]` as the raw JWT regardless of name: never set another cookie before `accessToken`.
