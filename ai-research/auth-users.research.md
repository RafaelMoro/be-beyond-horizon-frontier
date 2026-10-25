# Research: S2 — auth-users (users schema, signup, login, global guard, PUT/DELETE users, forgot/reset password)

**Branch:** `feat/auth-users` (stacked on `feat/foundation`, PR #3) · **Date:** 2026-10-25 · **Type:** single story, full research

Sources: `~/projects/notes/budget-master/be-refactor.md` (S2, ground rules, D0/D1/D3/D6/D7/D12/D14/D16, E1 plan-gate
hand-off, Security findings), `be-refactor-survey.md` §2.1/§2.2/§3.2/§4/§5, `be-refactor-survey-develop.md` §3,
`be-refactor-next-clients.md`, `be-refactor-frontend-usage.md`, `be-refactor-db-checks.md` §4–§6,
`~/security-audit-skill/be-budgt-master/run-1/findings.json`. Legacy contract = `be-budgt-master` **`origin/develop`**
(auth/users identical to main). Live client = `old-next-budget-master@main` (clone read only).

## Story

Port the `users` collection, signup, `POST /auth` login (httpOnly `accessToken` cookie, 5d JWT `{sub}`),
delete user, `PUT /users` (fixed, D3) and forgot/reset password. Replace per-controller `JwtAuthGuard` +
`LoggedMiddleware` with one global guard, a `@Public()` opt-out keyed by a constant, and a cookie-or-Bearer
extractor. Harden per the audit: `Secure` cookie always, no query-string credentials, dummy-hash compare,
forgot-password always 201, hashed one-time token, revocable access tokens, user-exists check. The mail send
itself is S3: S2 defines the port S3 implements.

## Acceptance criteria (from the plan, made testable)

1. Every `/auth` and `/users` route returns the legacy status, envelope and message in the table below
   (incl. `POST /auth/` with a trailing slash → 201).
2. Any non-`@Public` route without a valid token (none, bad, expired, deleted user, revoked) → 401
   `error:{message:'Unauthorized',statusCode:401}`; a valid token works as `Authorization: Bearer` **or** the
   `accessToken` cookie. `GET /`, `POST /auth`, `POST /users`, forgot and reset stay public.
3. `PUT /users` works per D3 (same DTO and messages); `DELETE /users` deletes the user (cascade per D7 → S8, see below).
4. Error parity: E11000 on signup → 400 `'Try with other email.'`; every jsonwebtoken error on reset → 400 with
   `err.message`.
5. Security: `accessToken` is the **first** `Set-Cookie`, bare JWT, `Secure` always; credentials read only from
   the JSON body; unknown email pays a bcrypt compare; forgot-password → 201 `'Email Sent'` for any valid email;
   a password reset invalidates earlier access tokens; the one-time token is stored hashed.
6. Unit tests (auth service, users service, guard/extractor); e2e signup → login → protected route → delete → 401.

## Legacy contract (origin/develop)

| Route | Auth | Request | Success | Errors |
|---|---|---|---|---|
| `POST /auth` | P (passport-local) | raw body `{email, password}`, **no DTO** (extra fields ignored, not 400) | **201** `message:null, data:{user:{_id,email,firstName,lastName,middleName}}`; cookie `accessToken=<jwt>`; `httpOnly, secure: NODE_ENV==='production', sameSite:'strict', maxAge 5d`, no domain/path | wrong email/password: 401 `{message:'Email or Password incorrect.', error:'Unauthorized', statusCode:401}`, **no Set-Cookie**; missing field: 401 `{message:'Unauthorized', statusCode:401}` |
| `POST /users` | P | `CreateUserDto`: email (IsString, IsNotEmpty, IsEmail), password (IsString, IsNotEmpty), firstName, lastName (IsString, IsNotEmpty), middleName (IsString, required, `''` ok) | 201 `message:'User created', data:{userCreated:{email, sub}}` (`sub` = `_id` string) | 400 `'Try with other email.'` (pre-check `findOne({email})`, exact-case); validation 400s |
| `DELETE /users` | G | – | 200 `message:'User deleted.', data:{userDeleted:{email,firstName,lastName}}` | 400 `'User not found.'` |
| `PUT /users` | G | `UpdateProfilerDto` = `PartialType(CreateUserDto)` + email **required** | 200 `message:'Profile updated', data:{userUpdated:{email,firstName,middleName,lastName}}` | always 400 `'User not found.'` today (`findOne({uid})`, users.service.ts:70). Then, in order: `'You cannot change your email'` (any email present), `'You cannot change your password directly. Try changing it using forgot password'` |
| `POST /users/forgot-password` | P | `{email}` IsString, IsNotEmpty, IsEmail | 201 `message:'Email Sent', data:null` | 400 `'User not found.'` (404 rewrapped) |
| `POST /users/reset-password/:oneTimeToken` | P | `{password}` IsString, IsNotEmpty | 201 `message:'Reset Password Successfully', data:null` | 400, in order: jsonwebtoken `err.message` (`'jwt expired'`, `'jwt malformed'`, `'invalid signature'`, …), `'User not found.'`, `'JWT not found.'` (no stored token), `'Wrong JWT'` (≠ stored). `'Invalid JWT.'` is unreachable (verify throws) |

Mechanics (`src/auth/**`, `src/users/**`, `src/middleware/Logged.middleware.ts`, `src/utils/generateJwt.ts`):
- JWT `{sub: _id.toString()}`, HS256 via `@nestjs/jwt`, secret `JWT_KEY`, `expiresIn '5d'`. Guard validates and sets
  `req.user = {sub, iat, exp}`; no DB check. Cookie name constant `ACCESS_TOKEN_COOKIE_NAME = 'accessToken'`.
- `LoggedMiddleware` (`forRoutes('*')`): if `req.cookies.accessToken` exists it **overwrites** `Authorization`
  → cookie wins over a client Bearer header.
- `@Public()` = `SetMetadata(process.env.PUBLIC_KEY, …)`; guard reads it with `reflector.get` on the handler only.
- bcryptjs, cost 10, on signup and reset. Login: `findByEmail` → if null return early (timing oracle) → compare.
- One-time token: a JWT `{sub}` signed with `ONE_TIME_JWT_KEY`, `1d` (UsersModule's own JwtModule), stored
  **plaintext** in `users.oneTimeToken`, overwritten on every forgot request; reset `$unset`s it, then sets the
  hash in a second write (non-atomic). Mail payload: `{email, hostname, firstName, lastName, oneTimeToken}`; link
  `${PROD_URI}/reset-password/<token>`.
- Every service method is wrapped in `catch (e) { throw new BadRequestException(e.message) }` — this is how the
  legacy statuses above come out (all 400). Don't port the wrapper (IMPLEMENTATION_GUIDELINES: Error Handling).

Prod data (db-checks §4–§5): `users` 14 docs, keys exactly `_id, email, password, firstName, lastName, middleName,
oneTimeToken, __v` (no timestamps); 7 have a plaintext `oneTimeToken`; index `email_1` unique exists in prod.
Other collections' owner field is a **string** in prod (`accounts.sub`, `categories.sub`, budgets `sub`,
records `userId`) — relevant to the S8 cascade.

## Client contract (D0: old-next wins)

old-next `main` (src/app/api/route.ts:9-35, LoginCard.utils.ts, Register.tsx): BFF posts the browser body
`{email,password}` to `${BACKEND}/auth/`, takes `set-cookie[0]`, splits at the first `=` and `;`, ignores the name,
wraps the value in its own `session` cookie, sends `Authorization: Bearer` (also straight from the browser). No
`credentials`, never reads `data.accessToken`, never decodes the backend JWT. Signup/forgot/reset are called from
the browser; signup always sends `middleName` (`''` default). Compares only `'Email or Password incorrect.'` (via the
BFF's `{message}`) and `'Try with other email.'` (`response.data.error.message`, a **string**). Never calls
`PUT`/`DELETE /users`.

FE_Budget_Master (to be refactored) conflicts — old-next wins each:

| FE_Budget_Master needs | Decision |
|---|---|
| `data.accessToken` in the login body | Not returned (D14/F6) |
| forgot-password 400 `'User not found.'` (specific toast) | Always 201 `'Email Sent'` (AC5) — FE_BM will show success |
| `data.userCreated.sub`, login `data.user._id/firstName/lastName`, reset `'jwt expired'`/`'invalid signature'` | Kept (no conflict) |

## Target repo today (feat/foundation tree)

- No auth, no users, no guards. `src/config.ts` envSchema lacks `JWT_KEY`, `ONE_TIME_JWT_KEY` (needed now; legacy
  names). `PUBLIC_KEY` is dropped (constant key). `test/setup-env.ts` must also set the JWT keys.
- `configureApp` already has cookie-parser, `ValidationPipe({whitelist, forbidNonWhitelisted, transform})`,
  filters, CORS with `credentials:true` and mirrored headers (Authorization passes).
- `GeneralAppExceptionFilter` returns `getResponse()` — Nest 12 verified: `new UnauthorizedException()` →
  `{message:'Unauthorized',statusCode:401}`; with a message → `{message, error:'Unauthorized', statusCode:401}`;
  `new BadRequestException('jwt expired')` → `{message:'jwt expired', error:'Bad Request', statusCode:400}`.
- `CatchAllExceptionFilter` maps E11000 → 409 `'Duplicate value'`, so signup must catch E11000 itself (hand-off).
- `test/app.e2e-spec.ts` `ProbeController` (`POST /probe`, `GET /boom`, `GET /cookies`) and `AppController GET /`
  will 401 once a global guard exists — they need `@Public()`.
- `@nestjs/mapped-types` (`PartialType`) is **not installed** (legacy took it from `@nestjs/swagger`).
- `autoIndex` only under test; prod already has the unique email index. e2e duplicate-email tests can race the
  async index build — the pre-check covers the deterministic case.

## Affected files and modules

New: `src/users/**` (schema pinned `collection: 'users'`, DTOs, service, controller), `src/auth/**` (login
controller/service, guard, `@Public`, extractor, constants), a mail port token + stub, unit specs, `test/*.e2e-spec.ts`.
Edited: `src/app.module.ts` (imports, global guard), `src/config.ts` + `.env.example` + `test/setup-env.ts`
(JWT keys), `src/app.controller.ts` + `test/app.e2e-spec.ts` (`@Public`), `package.json`/lockfile (deps),
`ai-skills/REPO_CONTEXT.md` + `IMPLEMENTATION_GUIDELINES.md` (Auth section, route table). Module names
(legacy `auth`/`users` vs guideline "singular") are confirmed in planning.

## Dependencies (registry, 2026-10-25)

| Package | Version | ESM / Nest 12 |
|---|---|---|
| `@nestjs/jwt` | 12.0.3 | `"type":"module"`, peer `@nestjs/common ^12`; still wraps **jsonwebtoken 9.0.3**, so `'jwt expired'` / `'invalid signature'` texts are unchanged |
| `bcryptjs` | 3.0.3 | ESM with `import` export, ships its own types (no `@types/bcryptjs`); compares legacy `$2a$` hashes (legacy also bcryptjs 3) |
| `@nestjs/passport` | 12.0.0 | ESM, peer common ^11/^12; needs `passport` 0.7 + `passport-jwt` 4.0.1 + `passport-local` 1.0.0 (CJS) + 3 `@types` |

Passport vs plain guard: a plain `CanActivate` guard using `JwtService.verifyAsync` + reading `req.body` covers both
strategies with 2 packages instead of 6 and removes the passport-local query-string fallback
(`lookup(req.body) || lookup(req.query)`) by construction. Recommended (see open questions).

## Edge cases and constraints

- **Login without a DTO:** a validating DTO would turn "missing field" into 400 with a message array and reject
  extra fields; legacy is 401 `'Unauthorized'` and ignores extras. Non-string `email`/`password` (e.g.
  `{$gt:''}`) must also end in 401, never reach `findOne`.
- **First Set-Cookie:** nothing (session, CSRF, clear-cookie) may be set before `accessToken`; the value must be the
  bare JWT (no `s:` signed-cookie prefix). Express `res.cookie` URI-encodes; JWT chars are unaffected. `Secure`
  always: browsers accept it on `http://localhost`; the old-next BFF reads it server-side anyway. No cookie on 401.
- **Extractor precedence:** legacy = cookie over Bearer. Neither client sends the cookie, so precedence only
  matters for a stale cookie + valid header. Keep legacy (cookie first).
- **Guard user check:** one `findById` per guarded request. Deleted user → 401. `sub` not a valid ObjectId (forged
  with the leaked key) → must be 401, not the catch-all CastError 400.
- **Revocation must accept existing tokens and users:** prod users have no new field and live 5d tokens carry only
  `{sub, iat, exp}`. A `passwordChangedAt` vs `iat` check keeps the payload `{sub}` (D14 / plan wording); compare in
  whole seconds (`iat` is floored), or a login in the same second as the reset gets rejected. A `tokenVersion` would
  need a new claim (absent = 0). No logout route exists, so reset (and delete) are the only revoke triggers.
- **Rotated keys:** the audit's Critical finding (leaked `JWT_KEY`/`ONE_TIME_JWT_KEY`) is the owner's to rotate; a
  rotation simply logs everyone out. The user-exists check alone does not stop forged tokens for real users.
- **Dummy hash:** must be cost 10 like real hashes, precomputed. Signup's `'Try with other email.'` still reveals
  registered emails (contract), so this only closes the login oracle.
- **Forgot-password:** unknown email → 201 with no write and no send, so timing still differs from a known email
  (write + awaited send). Each request rotates the stored token (cancels a pending link) and is unthrottled — rate
  limiting is S8 (login keyed per email: old-next calls from shared Vercel IPs).
- **Reset atomicity/one-time:** verify JWT → load user → compare hash → one conditional update (filter on the stored
  hash) that sets password + `passwordChangedAt` and unsets the token, so two concurrent resets can't both win. Legacy
  plaintext `oneTimeToken`s in prod become unredeemable (they are >1d-old JWTs, so `'jwt expired'` comes first).
  The token sits in the URL path: never log the URL (already the S1 rule).
- **Mail hand-off (S3):** S2 needs an injectable port with `sendForgotPasswordEmail({email, firstName, lastName,
  oneTimeToken}) → Promise<void>` (legacy `hostname` dropped: S3 builds the link from `FRONTEND_URI`, D12). The raw
  token goes only to the port; only its hash is stored. S3 AC2 ("failed send returns the old error shape") vs S2
  AC5 ("always 201") is S3's to reconcile.
- **Delete cascade (D7):** decided to wait for S8: the other collections have no schemas in this repo yet, S2 AC3
  and S8 AC1 allow it, the FE never calls `DELETE /users`, and the guard's user check stops the orphaned token. S8
  must match owners as string **and** ObjectId (`accounts`/`categories`/budgets `sub`, records `userId`).
- **PUT /users DTO** is `PartialType(CreateUserDto)` + required email: present fields keep `IsNotEmpty`
  (`firstName:''` → 400), `middleName:''` ok, unknown fields → 400 (`forbidNonWhitelisted`). `password` must stay in
  the DTO so the `'You cannot change your password directly…'` message is reachable.
- Email matching stays exact-case (legacy `findOne({email})`); lower-casing would lock out mixed-case prod users.
- `POST /auth/` trailing slash: Express 5 router is non-strict by default; cover it in e2e.
- Lambda (S9): API Gateway must keep `Set-Cookie` ordering (multi-value headers).

## Open questions (need owner sign-off)

1. **Revocation mechanism.** Recommend `passwordChangedAt` (set on reset; reject when `iat` < its whole seconds;
   absent = never revoked). Keeps JWT `{sub}`. Alternative: `tokenVersion` claim.
2. **PUT /users semantics (D3 "same DTO/messages").** Legacy rejects any `email`, but the DTO requires it, so a
   literal port still always fails. Recommend: email required, accepted only if it equals the stored email,
   otherwise `'You cannot change your email'`; `password` present → the password message; then update
   `firstName/lastName/middleName`.
3. **Package choice.** Recommend a plain global guard + `@nestjs/jwt` 12.0.3 + `bcryptjs` 3.0.3; no passport.
   Also: add `@nestjs/mapped-types` for `PartialType`, or write the PUT DTO by hand with `@IsOptional` (recommend by hand).
4. **Mail stub until S3.** Recommend S2 binds a no-op implementation of the port (logs "forgot-password mail not
   configured", never the token or email), replaced in S3. Nothing deploys before S9, so the gap isn't user-visible.
5. **`'User not found.'` from forgot-password is gone** (AC5) — confirm FE_Budget_Master losing its specific toast
   is accepted (D0 implies yes).

## Assumptions

- No logout or `/me` endpoint is added (not in the contract or AC).
- No password-strength rule, no email lower-casing, no timestamps on `users` (no owner decision for them).
- The stored hash reuses the `oneTimeToken` field (sha256 hex of the JWT); old and new backends won't serve
  resets on the same DB at the same time.
- Reset also revokes tokens (sets the revocation field); delete revokes via the user-exists check.
- `req.user` keeps the legacy shape `{sub, iat, exp}` so later stories read `req.user.sub`.
- Login rate limiting, helmet and the cascade are S8; Resend and the link URL are S3.
