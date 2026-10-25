# Plan: S2 — auth-users (users schema, signup, login, global guard, PUT/DELETE users, forgot/reset password)

**Status:** APPROVED (owner, 2026-10-25: as written, module names `user` + `auth`; run-all).

**Branch:** `feat/auth-users` (from `main` v0.3.0) · **Date:** 2026-10-25 · **Research:** [`ai-research/auth-users.research.md`](../ai-research/auth-users.research.md)
· Memory: [`memories/repo/auth-users-research.md`](../memories/repo/auth-users-research.md), [`memories/repo/auth-users-planning.md`](../memories/repo/auth-users-planning.md)

Owner decisions applied (`~/projects/notes/budget-master/be-refactor.md`):
- **E2.A1–A5** (all as the research recommended): A1 revocation by `passwordChangedAt`; A2 `PUT /users` needs `email`
  equal to the stored one; A3 no passport, a plain global guard + `@nestjs/jwt` + `bcryptjs`; A4 a mail port with a
  no-op that never logs the token or email; A5 forgot-password always 201 `'Email Sent'`. Delete cascade waits for S8.
- D0 (old-next `main` is the client that must not break), D3 (fix `PUT /users`), D6 (exact texts), D7 (cascade → S8),
  D14 (`accessToken` is the first `Set-Cookie`, a bare JWT; no token in the body; Bearer accepted), D16 (tests never
  touch prod; local dev **is** prod, so manual steps clean up).
- E1 plan-gate hand-off: signup E11000 → 400 `'Try with other email.'`; reset jsonwebtoken errors → 400 + `err.message`.
- Security findings for S2: `Secure` always, no query-string credentials, dummy-hash compare, forgot always 201,
  revocable tokens. The leaked-keys Critical finding is the owner's (rotation); this plan only reads the keys from env.

AC numbers below are the **research's AC1–AC6** (owner's S2 AC1→1, AC2→2, AC3→3, AC4→6, AC5→4, AC6→5).
The legacy contract table is in the research ("Legacy contract"); this plan does not repeat it.

## Scope guard

**In:** the research's "Affected files" list; `@Public()` on `GET /` and the S1 probe routes; `JWT_KEY` /
`ONE_TIME_JWT_KEY` in config, `.env.example`, `test/setup-env.ts`; docs (story rule: `REPO_CONTEXT.md` updated).

**Out (don't add):** passport, `@nestjs/mapped-types`, logout or `/me`, a `tokenVersion` claim, the delete cascade
(S8), rate limiting / helmet (S8), the real mail send and reset link (S3), password-strength rules, email
lower-casing, timestamps on `users`, an index script (S8), a body `accessToken` (D14/F6), a `PUBLIC_KEY` env key.

## Module names (approved)

Planned as **`user`** (guideline: singular) and **`auth`**. Routes stay `/users` and `/auth` (controller paths),
the collection is pinned to `users`, so the module name changes nothing outside `src/`.

## CLI note (verified with `--dry-run`, 2026-10-25)

`pnpm nest g s user/services/user` creates `src/user/services/user/user.service.ts` (an extra folder). Every
service/controller/guard generation below passes **`--flat`** to get the guideline layout. Generate the module first
so the CLI registers services/controllers in it, not in `AppModule`. After each generation, check the relative
imports end in `.js`.

---

## Phase 1 — Dependencies, config keys, `users` schema and module

**Changes**

1. `package.json` / `pnpm-lock.yaml` — `pnpm add @nestjs/jwt bcryptjs` (12.0.3 / 3.0.3 per research; bcryptjs ships
   its own types, no `@types/bcryptjs`).
2. `src/config.ts` — modify.
   - `envSchema`: add `JWT_KEY: Joi.string().required()`, `ONE_TIME_JWT_KEY: Joi.string().required()` (legacy names).
     No length rule (the owner's current keys must still boot). No `PUBLIC_KEY`.
   - `registerAs`: add `jwtKey: process.env.JWT_KEY`, `jwtOneTimeKey: process.env.ONE_TIME_JWT_KEY`.
   - Update the "Only the keys S1 consumes" comment.
3. `src/config.spec.ts` — modify: add both keys to `base`; add a case "missing `JWT_KEY` fails" and one for
   `ONE_TIME_JWT_KEY`. Drop the now-redundant `JWT_KEY: 'k'` from the unknown-keys case (keep `CLUSTER`).
4. `.env.example` — modify: add `JWT_KEY=` / `ONE_TIME_JWT_KEY=` placeholders with a comment: access-token key (5d)
   and one-time reset key (1d); the old values are leaked (audit Critical), use rotated ones; `PUBLIC_KEY` is no
   longer read.
5. `test/setup-env.ts` — modify: set `process.env.JWT_KEY` and `process.env.ONE_TIME_JWT_KEY` to two different,
   low-entropy test strings (e.g. `'e2e-jwt-key'`, `'e2e-one-time-key'`) so gitleaks doesn't flag them.
6. `pnpm nest g mo user` — creates `src/user/user.module.ts`, adds `UserModule` to `AppModule` imports (**verify**).
7. `src/user/entities/user.entity.ts` — create (hand-authored).
   - `@Schema({ collection: 'users' })` class `User` (no `timestamps`, no `versionKey` change: prod docs have `__v`).
   - `email` `{ required: true, unique: true }`, `password` `{ required: true }`, `firstName`/`lastName`
     `{ required: true }`, `middleName` `@Prop()`, `oneTimeToken` `@Prop()` (now sha256 hex of the one-time JWT),
     `passwordChangedAt` `@Prop()` `Date`, optional (absent on all 14 prod docs = never revoked, A1).
   - `export const UserSchema = SchemaFactory.createForClass(User)`; `export type UserDoc = HydratedDocument<User>`.
   - `unique` only builds the index under test (`autoIndex`); prod already has `email_1`.
8. `src/user/user.module.ts` — populate: `MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])`.
9. `pnpm nest g s user/services/user --flat` — creates `user.service.ts` + `.spec.ts`, registered in `UserModule`.
   This phase adds only the two lookups the guard and login need; add `exports: [UserService]` to the module.
   - `findByEmail(email: string): Promise<UserDoc | null>` — `findOne({ email }).exec()`, exact case.
   - `findById(id: string): Promise<UserDoc | null>` — returns `null` when `!isValidObjectId(id)` (no CastError
     400), else `findById(id).exec()`.

**Test coverage** (`user.service.spec.ts`, model mocked with `getModelToken(User.name)` + `useValue`)
- `findById` with a non-ObjectId string returns `null` without calling the model.
- `findByEmail` queries `{ email }` with the raw string.
- `envSchema` cases above.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e` (S1 e2e still green: no guard yet; setup-env has the keys).
- Manual: none (no route yet).

---

## Phase 2 — Signup, login, global guard, `@Public()`

**Changes**

1. `src/user/user.constants.ts` — create: legacy texts `USER_CREATED_MESSAGE`, `USER_EXISTS_ERROR`
   (`'Try with other email.'`), `USER_NOT_FOUND_ERROR`, `EMAIL_CHANGE_ERROR`, `PASSWORD_DIRECT_CHANGE_ERROR`,
   `PROFILE_UPDATE`, `DELETE_USER_MESSAGE`, `FORGOT_PASSWORD_MESSAGE`, `RESET_PASSWORD_MESSAGE`, `JWT_NOT_FOUND`,
   `WRONG_JWT_ERROR` (exact strings from legacy `src/users/constants/index.ts`), `BCRYPT_COST = 10`,
   `JWT_ONE_TIME_EXPIRE_TIME = '1d'`. Not `'Invalid JWT.'` (unreachable, research).
2. `src/user/dtos/user.dto.ts` — create `CreateUserDto` exactly as legacy (email `IsString IsNotEmpty IsEmail`;
   password, firstName, lastName `IsString IsNotEmpty`; middleName `IsString` only, so `''` passes and it stays
   required). No property initializers (`transform: true`).
3. `src/user/dtos/user-responses.dto.ts` — create the `data` shapes as classes and type the response literals with
   them: `UserCreatedDto {email, sub}`, later phases add `UserUpdatedDto`, `UserDeletedDto`.
4. `UserService.createUser(dto: CreateUserDto)` — add.
   - `findByEmail(dto.email)` → found → `BadRequestException(USER_EXISTS_ERROR)`.
   - hash with `bcrypt.hash(password, BCRYPT_COST)`; `create({ ...dto, password: hash })`.
   - `catch` **only** `code === 11000` → `BadRequestException(USER_EXISTS_ERROR)`; rethrow anything else (the race
     with a concurrent signup; without this the catch-all answers 409).
   - Returns `{ ...INITIAL_RESPONSE, message: USER_CREATED_MESSAGE, data: { userCreated: { email, sub: _id.toString() } } }`.
5. `pnpm nest g mo auth` — creates `src/auth/auth.module.ts`, adds `AuthModule` to `AppModule` (**verify**).
6. `src/auth/auth.constants.ts` — create: `ACCESS_TOKEN_COOKIE_NAME = 'accessToken'`, `JWT_EXPIRE_TIME = '5d'`,
   `ACCESS_TOKEN_MAX_AGE_MS = 5 days`, `IS_PUBLIC_KEY = 'isPublic'` (constant, replaces `PUBLIC_KEY`),
   `LOGIN_ERROR = 'Email or Password incorrect.'`, `DUMMY_PASSWORD_HASH` — a precomputed **cost-10** bcrypt hash of a
   random throwaway string, never stored on a user (comment why). If the gitleaks CI job flags it, add its fingerprint
   to `.gitleaksignore` with a one-line reason (existing convention).
7. `src/auth/auth.interface.ts` — create: `JwtPayload { sub: string; iat: number; exp: number }`,
   `AuthenticatedRequest = Request & { user: JwtPayload }`, `LoginBody { email?: unknown; password?: unknown }`
   (an **interface**, see login edge case).
8. `src/auth/decorators/public.decorator.ts` — create: `export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)`.
9. `src/auth/auth.utils.ts` — create `extractToken(req: Request): string | undefined`:
   - `req.cookies?.[ACCESS_TOKEN_COOKIE_NAME]` if it is a non-empty string (cookie wins, legacy `LoggedMiddleware`;
     no fallback to the header when the cookie is bad, same as legacy).
   - else `Authorization` matching `/^bearer (.+)$/i` (passport's extractor was case-insensitive on the scheme).
10. `src/auth/auth.module.ts` — populate:
    - `imports: [UserModule, JwtModule.registerAsync({ inject: [config.KEY], useFactory: (c) => ({ secret: c.jwtKey, signOptions: { expiresIn: JWT_EXPIRE_TIME } }) })]`.
    - `providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }, AuthService]` (the CLI adds `AuthService`).
    - Not global: `UserModule` registers its own `JwtModule` with the one-time key (Phase 4). Comment that the two
      must never be made global, or the keys mix.
11. `pnpm nest g gu auth/guards/jwt-auth --flat` — creates `jwt-auth.guard.ts` + `.spec.ts`. `JwtAuthGuard.canActivate`:
    - `reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, class])` → `true` (class-level works for the probe controller).
    - `token = extractToken(req)`; none → `UnauthorizedException()` (body `{message:'Unauthorized',statusCode:401}`).
    - `payload = await jwtService.verifyAsync<JwtPayload>(token)`; any throw → `UnauthorizedException()`.
    - `user = await userService.findById(payload.sub)` (bad ObjectId → null); null → 401.
    - `user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)` → 401 (whole
      seconds: `iat` is floored, a login in the reset's second must pass).
    - `req.user = payload` (legacy shape `{sub, iat, exp}`), return `true`.
    - Every failure is the same message-less `UnauthorizedException()` (AC2 body).
12. `pnpm nest g s auth/services/auth --flat` — `AuthService.login(body: LoginBody)`:
    - `email`/`password` not both non-empty strings → `UnauthorizedException()` (legacy passport "missing
      credentials" → 401 `'Unauthorized'`); never reaches `findOne` (blocks `{ $gt: '' }`).
    - `user = await userService.findByEmail(email)`; `ok = await bcrypt.compare(password, user?.password ?? DUMMY_PASSWORD_HASH)`;
      `!user || !ok` → `UnauthorizedException(LOGIN_ERROR)` (body `{message, error:'Unauthorized', statusCode:401}`).
    - `accessToken = await jwtService.signAsync({ sub: user._id.toString() })`.
    - Returns `{ accessToken, response: { ...INITIAL_RESPONSE, data: { user: { _id, email, firstName, lastName, middleName } } } }`
      (never the password, hash or `oneTimeToken`).
13. `pnpm nest g co auth/controllers/auth --flat --no-spec` — `@Controller('auth')`, `@Public() @Post() login(@Body() body: LoginBody, @Res({ passthrough: true }) res: Response)`:
    - `res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: ACCESS_TOKEN_MAX_AGE_MS })`
      — `secure` **unconditional** (audit), no `domain`/`path`/`signed` (bare JWT). Nothing else may set a cookie or
      call `clearCookie` on this route, so `accessToken` stays `set-cookie[0]`.
    - Returns `response` (201, the POST default). Only reads `body`: credentials never come from the query (passport-local
      fallback gone by construction).
14. `pnpm nest g co user/controllers/user --flat --no-spec` — `@Controller('users')`; this phase only
    `@Public() @Post() createUser(@Body() dto: CreateUserDto)`.
15. `src/app.controller.ts` — modify: `@Public()` on `getHello`.
16. `test/app.e2e-spec.ts` — modify: `@Public()` on the `ProbeController` class (all three probe routes).
17. `test/auth-users.e2e-spec.ts` — create (one spec for the story; `createTestApp()` / `closeTestApp()`; users get
    unique emails per test, the DB is dropped in `afterAll`). Tokens for edge cases are signed in the spec with
    `new JwtService({ secret: process.env.JWT_KEY })`.

**Edge cases**
- **Login has no DTO on purpose:** `LoginBody` must be an interface/type. Its runtime metatype is `Object`, which the
  global `ValidationPipe` skips, so missing fields stay 401 and extra fields are ignored (a class would give 400s).
- Login 401s set no cookie (the cookie is written only after `login()` resolves).
- Express 5's router is non-strict, so `POST /auth/` matches `@Post()`; covered by e2e, not by code.
- Guard runs only on matched routes: unmatched paths stay 404, CORS preflight is answered before guards.

**Test coverage**
- `auth.service.spec.ts` (`UserService` and `JwtService` mocked, **real** bcryptjs): missing / empty / non-string
  email or password → message-less 401 and `findByEmail` not called; unknown email → `bcrypt.compare` still runs
  against `DUMMY_PASSWORD_HASH` (spy) and 401 `LOGIN_ERROR`; wrong password → same 401; a legacy `$2a$` cost-10 hash
  fixture compares true; success signs exactly `{ sub }` and the returned user has exactly the 5 keys.
- `jwt-auth.guard.spec.ts` (+ `extractToken`): public handler and public class pass without `verifyAsync`; no token;
  cookie preferred over Bearer; `bearer` lower-case accepted; `Basic …` ignored; verify throws; bad ObjectId `sub`;
  user missing; `iat` one second before `passwordChangedAt` → 401; `iat` in the same second → pass; no
  `passwordChangedAt` → pass; `req.user` is the payload. Every 401 has no message.
- `user.service.spec.ts`: `createUser` pre-check → `'Try with other email.'`; `create` throwing `{code: 11000}` →
  same 400; another error is rethrown untouched; stored password is a bcrypt hash, not the input; response shape.
- `test/auth-users.e2e-spec.ts`:
  - signup 201 exact body (`userCreated.sub` is a 24-hex string); duplicate → 400 exact `error` body; missing
    `middleName` → 400; `middleName: ''` → 201; unknown field → 400.
  - `POST /auth/` (trailing slash) **and** `POST /auth` → 201, exact body, no `accessToken` key anywhere in the body.
  - `set-cookie[0]` parsed the old-next way (value between the first `=` and the first `;`) is a bare JWT
    (`/^[\w-]+\.[\w-]+\.[\w-]+$/`, no `s:` prefix) whose payload has only `sub`, `iat`, `exp`; the cookie has
    `HttpOnly`, `Secure`, `SameSite=Strict`, `Max-Age=432000`; it is the only `Set-Cookie`.
  - wrong password and unknown email → 401 `{message:'Email or Password incorrect.', error:'Unauthorized', statusCode:401}`
    and no `set-cookie`; missing field → 401 `{message:'Unauthorized', statusCode:401}`; extra field → 201;
    `{ email: { $gt: '' }, password }` → 401; credentials only in the query string → 401.
  - guard: `GET /` stays 200 without a token; a protected route (in this phase: none exists yet → assert in Phase 3).
  - S1 `app.e2e-spec.ts` stays green with `@Public()` (probe, 413, invalid JSON, 500, cookies).

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual (orchestrator, `pnpm run start:dev` on the owner's `.env` = **prod DB**). **Creates no data:**
  1. `curl -i localhost:3000/` → 200 `Hello World!`.
  2. `curl -i -X POST localhost:3000/auth/ -H 'Content-Type: application/json' -d '{"email":"e2e-manual-nobody-<timestamp>@example.invalid","password":"x"}'`
     → 401 `'Email or Password incorrect.'`, no `Set-Cookie`. (Read-only: one `findOne`.)
  3. Same with `-d '{}'` → 401 `{message:'Unauthorized',statusCode:401}`.
  No signup here: `DELETE /users` lands in Phase 3, so the signup round-trip is validated there.

---

## Phase 3 — `PUT /users`, `DELETE /users`, the full flow

**Changes**

1. `src/user/dtos/user.dto.ts` — add `UpdateUserDto` by hand (no `PartialType`): `email` `IsString IsNotEmpty IsEmail`
   (required, legacy `UpdateProfilerDto`); `password`, `firstName`, `lastName` `IsOptional IsString IsNotEmpty`;
   `middleName` `IsOptional IsString`. `password` stays so its message is reachable.
2. `src/user/dtos/user-responses.dto.ts` — add `UserUpdatedDto {email, firstName, middleName, lastName}`,
   `UserDeletedDto {email, firstName, lastName}`.
3. `UserService.updateUser(sub: string, dto: UpdateUserDto)` — add. Order (legacy order, A2):
   - `findById(sub)` → null → 400 `USER_NOT_FOUND_ERROR`.
   - `dto.email !== user.email` → 400 `EMAIL_CHANGE_ERROR` (exact-case compare).
   - `dto.password !== undefined` → 400 `PASSWORD_DIRECT_CHANGE_ERROR`.
   - `$set` only the name fields that are strings (skip `undefined`/`null`; `IsOptional` lets `null` through);
     `findByIdAndUpdate(sub, { $set }, { returnDocument: 'after' })` (`new: true` is deprecated in mongoose 9);
     null (deleted meanwhile) → 400 `USER_NOT_FOUND_ERROR`.
   - 200 `{ ...INITIAL_RESPONSE, message: PROFILE_UPDATE, data: { userUpdated } }`.
4. `UserService.deleteUser(sub: string)` — add: `findByIdAndDelete(sub)`; null → 400 `USER_NOT_FOUND_ERROR`;
   200 `{ ...INITIAL_RESPONSE, message: DELETE_USER_MESSAGE, data: { userDeleted } }`. No cascade (D7 → S8); comment it.
5. `UserController` — add `@Put() modifyUser(@Body() dto: UpdateUserDto, @Req() req: AuthenticatedRequest)` and
   `@Delete() deleteUser(@Req() req: AuthenticatedRequest)`; both pass `req.user.sub` only (thin controller). Not public.

**Test coverage**
- `user.service.spec.ts`: update — not found; email differs (also differs only in case); password present (even with
  the right email); success writes only name fields and returns the 4-key `userUpdated`; `null` name skipped;
  check order (email error wins over password error). Delete — null → 400; shape.
- `test/auth-users.e2e-spec.ts`:
  - AC2: `PUT /users` with no token → 401 exact `{message:'Unauthorized',statusCode:401}` envelope; garbage token;
    expired token (`exp` in the past); token signed with another key; token for a non-ObjectId `sub` → 401 (not 400);
    valid token as `Authorization: Bearer` → 200 **and** as `Cookie: accessToken=` → 200.
  - PUT: wrong email → 400 `'You cannot change your email'`; `password` sent → 400 password message; `firstName: ''`
    → 400; unknown field → 400; success → 200 exact body and a re-read shows the new names.
  - **Flow (AC6):** signup → login (`POST /auth/`, token from `set-cookie[0]`) → `PUT /users` with Bearer 200 →
    `DELETE /users` 200 exact body → same token on `PUT /users` → 401 → login with the same credentials → 401
    `'Email or Password incorrect.'`.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual (prod DB). **Creates one `users` document** — `e2e-manual-<timestamp>@example.invalid`, password a
  throwaway string — and deletes it in step 6 of this phase:
  1. `POST /users` `{email, password, firstName:'Manual', lastName:'Check', middleName:''}` → 201 `'User created'`.
  2. `curl -i -X POST localhost:3000/auth/ …` → 201; the **first** `Set-Cookie` is `accessToken=<jwt>; Max-Age=432000; …; HttpOnly; Secure; SameSite=Strict`;
     body has no token. Take the token the old-next way (between the first `=` and `;` of `set-cookie[0]`).
  3. `PUT /users` without a token → 401; with `Authorization: Bearer <jwt>` and `{email, firstName:'Manual2'}` → 200
     (updates only that throwaway doc).
  4. `PUT /users` with `-H 'Cookie: accessToken=<jwt>'` → 200.
  5. `PUT /users` with `{email:'other@example.invalid'}` → 400 `'You cannot change your email'` (no write).
  6. **Clean-up:** `DELETE /users` with Bearer → 200 `'User deleted.'`; then `PUT /users` with the same token → 401
     and login → 401 (proves the doc is gone).
  - If a step fails after step 1, still run step 6 with whatever token works. If no login works, the throwaway doc
    must be deleted by email by the owner (Atlas) — report it; do not leave it.

---

## Phase 4 — Forgot / reset password, mail port, revocation; docs

**Changes**

1. `src/user/user.interface.ts` — create: `ForgotPasswordMail { email; firstName; lastName; oneTimeToken }`
   (legacy `hostname` dropped, S3 builds the link from `FRONTEND_URI`, D12) and
   `ForgotPasswordMailer { sendForgotPasswordEmail(mail: ForgotPasswordMail): Promise<void> }`.
2. `src/user/user.constants.ts` — add `FORGOT_PASSWORD_MAILER` injection token.
3. `src/user/user.module.ts` — modify:
   - `JwtModule.registerAsync({ inject: [config.KEY], useFactory: (c) => ({ secret: c.jwtOneTimeKey, signOptions: { expiresIn: JWT_ONE_TIME_EXPIRE_TIME } }) })`
     (legacy: `UsersModule` owns its one-time `JwtService`).
   - `{ provide: FORGOT_PASSWORD_MAILER, useValue: <no-op> }` whose method only does
     `logger.warn('forgot-password mail not configured')` — never the email or token (A4). Comment: S3 replaces it.
4. `src/user/dtos/user.dto.ts` — add `ForgotPasswordDto` (`email` `IsString IsNotEmpty IsEmail`) and
   `ResetPasswordDto` (`password` `IsString IsNotEmpty`), as legacy.
5. `src/user/user.utils.ts` — create `hashToken(token: string): string` = sha256 hex (`node:crypto`).
6. `UserService.forgotPassword({ email })` — add (inject `JwtService` and `FORGOT_PASSWORD_MAILER`):
   - `findByEmail` → null → return the 201 response with no write and no send (A5).
   - `oneTimeToken = await jwtService.signAsync({ sub })`; `updateOne({ _id }, { $set: { oneTimeToken: hashToken(oneTimeToken) } })`;
     `await mailer.sendForgotPasswordEmail({ email, firstName, lastName, oneTimeToken })` (raw token only to the port).
   - Returns `{ ...INITIAL_RESPONSE, message: FORGOT_PASSWORD_MESSAGE, data: null }`.
7. `UserService.resetPassword(oneTimeToken: string, password: string)` — add, legacy check order:
   - `verifyAsync(oneTimeToken)`; catch an error whose `name` is `JsonWebTokenError` / `TokenExpiredError` /
     `NotBeforeError` → `BadRequestException(err.message)` (`'jwt expired'`, `'jwt malformed'`, `'invalid signature'`…,
     E1 hand-off, D6); rethrow anything else. The only place a library message is passed through, by design.
   - `findById(sub)` (bad ObjectId → null) → 400 `USER_NOT_FOUND_ERROR`.
   - no `oneTimeToken` → 400 `JWT_NOT_FOUND`; `hashToken(token) !== stored` → 400 `WRONG_JWT_ERROR` (legacy
     plaintext tokens never match; they are expired anyway).
   - one conditional write: `updateOne({ _id, oneTimeToken: stored }, { $set: { password: await bcrypt.hash(password, BCRYPT_COST), passwordChangedAt: new Date() }, $unset: { oneTimeToken: '' } })`;
     `matchedCount === 0` (a concurrent reset won) → 400 `WRONG_JWT_ERROR`.
   - Returns `{ ...INITIAL_RESPONSE, message: RESET_PASSWORD_MESSAGE, data: null }` (201).
8. `UserController` — add `@Public() @Post('forgot-password')` and `@Public() @Post('reset-password/:oneTimeToken')`
   (`@Param('oneTimeToken')`, `@Body() ResetPasswordDto`). Never log the URL (S1 rule already holds).
9. Docs — modify `ai-skills/REPO_CONTEXT.md` (structure, config keys `JWT_KEY`/`ONE_TIME_JWT_KEY`, route table with
   guard column and the public routes, an Auth section: global `JwtAuthGuard`, `@Public()`, cookie-first extractor,
   user-exists + `passwordChangedAt` checks, `req.user = {sub, iat, exp}`, no cascade until S8; remove "auth, guards"
   from "does not exist yet"; flip "Guard Stacking" from planned) and `ai-skills/IMPLEMENTATION_GUIDELINES.md` (flip
   the Auth section: `@Public()` from `src/auth/decorators/public.decorator.ts`, protected handlers read
   `req.user.sub` via `AuthenticatedRequest`, guard ordering, the `--flat` CLI note). `CLAUDE.md` project line:
   drop "auth" from "no … auth yet".

**Edge cases**
- The token is in the URL path: no log line may contain it (filters log the route pattern).
- Forgot rotates the stored hash each time (cancels a pending link), unthrottled until S8.
- Unknown email skips the write and send, so timing still differs (accepted in research; rate limit is S8).

**Test coverage**
- `user.service.spec.ts` (JwtService and mailer mocked): forgot — unknown email → 201, no `updateOne`, no send;
  known → `updateOne` stores `hashToken(raw)` (never `raw`), mailer gets the raw token + `{email, firstName, lastName}`;
  the no-op/logger never receives the token or email. Reset — each jsonwebtoken error name passes its message;
  a non-jwt error is rethrown; bad `sub`; user missing; no stored token; hash mismatch; `matchedCount 0` → `'Wrong JWT'`;
  success writes hash + `passwordChangedAt` + `$unset` in one filtered call.
- `test/auth-users.e2e-spec.ts` (raw token captured by `vi.spyOn(app.get(FORGOT_PASSWORD_MAILER, { strict: false }), 'sendForgotPasswordEmail')`):
  - forgot unknown email → 201 `'Email Sent'`, `data: null`; invalid email → 400; known email → 201 and the stored
    `oneTimeToken` equals `sha256(raw)`, not `raw`.
  - reset: `'jwt malformed'`, `'invalid signature'` (signed with `JWT_KEY`), `'jwt expired'` → 400 with that exact
    message; valid → 201 `'Reset Password Successfully'`; same token again → 400 `'JWT not found.'`; an older token
    after a newer forgot → 400 `'Wrong JWT'`.
  - revocation (AC5): an access token signed with `iat` 60 s before the reset → 401 after the reset (back-dated so the
    test is not same-second flaky); login with the old password → 401, with the new one → 201 and the new token works.
  - unit-level `'User not found.'` is enough for reset (a valid one-time token for a missing user needs a deleted
    user; add it if cheap: forgot → delete → reset → 400 `'User not found.'`).

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual (prod DB). **Creates one `users` document** `e2e-manual-<timestamp>@example.invalid` and, in step 3, writes a
  hashed `oneTimeToken` on that same doc; step 5 deletes the doc:
  1. `POST /users/forgot-password` `{email:'e2e-manual-nobody-<timestamp>@example.invalid'}` → 201 `'Email Sent'`
     (no write).
  2. Sign up the throwaway (as Phase 3 step 1) and log in (token from `set-cookie[0]`).
  3. `POST /users/forgot-password` with the throwaway email → 201 `'Email Sent'`; the dev-server log shows
     `forgot-password mail not configured` and neither the email nor a JWT.
  4. `POST /users/reset-password/not-a-jwt` `{password:'x'}` → 400 `'jwt malformed'` (no write).
  5. **Clean-up:** `DELETE /users` with the Bearer token → 200; login → 401. Same fallback as Phase 3 if it fails.
  - A real reset is not run manually: the raw token only reaches the no-op mailer (covered by e2e).

---

## AC → phase mapping

| AC (research) | Validated in | How |
|---|---|---|
| 1 — legacy status/envelope/message per route, incl. `POST /auth/` | 2 (signup, login), 3 (PUT, DELETE), 4 (forgot, reset) | automatic (e2e exact bodies) + manual (2, 3, 4) |
| 2 — 401 shape for none/bad/expired/deleted/revoked; Bearer or cookie; public routes | 2 (guard unit, public `GET /`), 3 (e2e none/bad/expired/foreign key/deleted, Bearer + cookie), 4 (revoked) | automatic + manual (3) |
| 3 — `PUT /users` per D3/A2; `DELETE /users` | 3 | automatic + manual |
| 4 — E11000 → `'Try with other email.'`; jsonwebtoken errors → 400 + message | 2 (E11000, unit), 4 (reset, unit + e2e) | automatic (+ manual `'jwt malformed'` in 4) |
| 5 — first bare `Set-Cookie`, `Secure`, body-only credentials, dummy hash, forgot 201, reset revokes, hashed one-time token | 2 (cookie, query creds, dummy hash), 4 (forgot, hash, revocation) | automatic + manual (3 cookie, 4 forgot) |
| 6 — unit tests (auth service, users service, guard/extractor); e2e signup → login → protected → delete → 401 | 2, 3, 4 | automatic |

## AC Coverage Summary

| AC | Phase(s) | Automatic / manual | Coverage |
|---|---|---|---|
| AC1 | 2, 3, 4 | both | full |
| AC2 | 2, 3, 4 | both | full |
| AC3 | 3 | both | **partial** by decision: the delete cascade is S8 (D7, E2) |
| AC4 | 2, 4 | automatic (+ manual in 4) | full (E11000 race only at unit level: the deterministic e2e case hits the pre-check) |
| AC5 | 2, 4 | both | full (timing of unknown vs known email on forgot not equalized, accepted in research) |
| AC6 | 2, 3, 4 | automatic | full |

## Decisions (beyond the research)

- Module names `user` + `auth` (guideline singular) — approved by the owner.
- `--flat` on every service/controller/guard generation; controllers `--no-spec` (thin; logic is tested in services
  and e2e).
- No JWT secret length rule in `envSchema` (would refuse the owner's current keys at boot).
- Each module owns its `JwtModule` (auth: `JWT_KEY` 5d; user: `ONE_TIME_JWT_KEY` 1d), as legacy; neither global.
- `DUMMY_PASSWORD_HASH` is a committed literal (no boot-time hashing, Lambda cold start); `.gitleaksignore` entry if flagged.
- Non-string or empty `email`/`password` on login → the message-less 401 (same as "missing").
- Bearer scheme matched case-insensitively; a bad cookie does not fall back to the header (legacy precedence).
- `updateUser` skips `null` name fields; uses `returnDocument: 'after'`.
- Reset: a non-ObjectId `sub` → `'User not found.'`; a lost concurrent reset → `'Wrong JWT'`.
- The no-op mailer is a `useValue` in `UserModule`; e2e captures the raw token by spying on it (no harness change).
- Revocation e2e uses a back-dated `iat` to avoid same-second flakiness.

## Assumptions

- The research's assumptions are accepted (no logout/`/me`, no lower-casing, `oneTimeToken` field reused for the hash,
  `req.user = {sub, iat, exp}`, rate limiting/helmet/cascade in S8, mail in S3).
- The owner's `.env` (not present in this checkout today) exists for manual runs and has `JWT_KEY` and
  `ONE_TIME_JWT_KEY` (legacy names; rotated values per the audit).
- bcryptjs 3 `compare` accepts the prod `$2a$` hashes (unit fixture checks it).

## Implementation checklist (2026-10-25)

- [x] Phase 1 — `@nestjs/jwt` ^12.0.3 + `bcryptjs` ^3.0.3, `JWT_KEY`/`ONE_TIME_JWT_KEY` in `config.ts` + spec, `.env.example`,
  `test/setup-env.ts`, `UserModule` + `User` entity + `UserService.findByEmail/findById` + spec. Build/test/e2e green.
  `pnpm dlx pnpm@10 install --frozen-lockfile --lockfile-only` accepts the lockfile.
- [x] Phase 2 — signup, login, `JwtAuthGuard` (APP_GUARD), `@Public()`, `extractToken`, `AuthModule`; `@Public()` on `GET /`
  and the S1 probe controller; unit specs (auth service with a real `$2a$` cost-10 fixture, guard + extractor, createUser);
  `test/auth-users.e2e-spec.ts`. Lint/build/test/e2e green.
  - [ ] Manual (orchestrator, prod `.env`): Phase 2 steps 1–3.
- [x] Phase 3 — `UpdateUserDto`, `updateUser`, `deleteUser`, `PUT`/`DELETE /users`; unit + e2e (401 matrix, Bearer + cookie,
  full flow). Green.
  - [ ] Manual (orchestrator, prod `.env`): Phase 3 steps 1–6 (creates and deletes one throwaway user).
- [x] Phase 4 — mail port + no-op mailer, one-time `JwtModule`, `hashToken`, forgot/reset, revocation; unit (real
  `@nestjs/jwt` errors pass `'jwt malformed'`/`'invalid signature'`/`'jwt expired'`/`'jwt not active'` unchanged) + e2e. Docs:
  `REPO_CONTEXT.md`, `IMPLEMENTATION_GUIDELINES.md`, `CLAUDE.md`. Green.
  - [ ] Manual (orchestrator, prod `.env`): Phase 4 steps 1–5 (creates and deletes one throwaway user).
- [x] `node dist/main.js` with fake env on a local in-memory replica set: boots, `GET /` 200, `PUT /users` without a token →
  401 in the envelope, signup + login give the expected cookie.
- [x] gitleaks v8.30.1 (binary): `git` mode over history → no leaks; `dir` mode over `src/ test/` → no finding in the new
  files (dummy hash and `$2a$` fixture not flagged), so `.gitleaksignore` is unchanged.
- Deviations: deps use caret ranges (`^12.0.3`, `^3.0.3`) like the rest of `package.json`; `user.module.spec.ts` added to
  test that the no-op mailer logs only the fixed warning; e2e adds `GET /nope` → 404 under the guard.
