# auth-users planning notes (2026-10-25, draft)

- `pnpm nest g s user/services/user` nests an extra folder (`services/user/user.service.ts`). Pass `--flat` to get the guideline layout; generate the module first so the CLI registers into it, not `AppModule`.
- Login takes `@Body() body: LoginBody` where `LoginBody` is an interface: metatype `Object` makes the global ValidationPipe skip it, keeping legacy 401 on missing fields and ignoring extras. A class would turn it into 400s.
- Two non-global `JwtModule`s: `AuthModule` (JWT_KEY, 5d) and `UserModule` (ONE_TIME_JWT_KEY, 1d). Making either global mixes the keys.
- E2E gets the raw one-time token by spying on the no-op `FORGOT_PASSWORD_MAILER` useValue (`app.get(..., { strict: false })`); no harness change.
- Revocation compares `iat` with `floor(passwordChangedAt/1000)`; e2e back-dates `iat` to avoid same-second flakiness.
- mongoose 9 deprecates `{ new: true }`: use `returnDocument: 'after'`.
