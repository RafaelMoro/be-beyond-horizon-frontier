# Plan: S8a — hardening-code (user-delete cascade, helmet, rate limits on login + forgot-password)

**Status:** APPROVED (2026-10-25, run-all). Open questions answered at the end.

**Branch:** `feat/hardening-code` (from `main` v0.11.0, S1–S7 merged) · **Date:** 2026-10-25 ·
**Research:** [`ai-research/hardening.research.md`](../ai-research/hardening.research.md) (S8a scope: §3, §4, §5;
"Owner decisions (2026-10-25)" answers §9) · Pattern reference: `AccountService.deleteAccount`
(`src/account/services/account.service.ts:116`, `connection.transaction` + `{ session }`), the one-shot rollback e2e
in `test/categories.e2e-spec.ts:342`, the manual block of
[`records-transfers-listing.planning.md`](./records-transfers-listing.planning.md) · Memory:
[`hardening-research.md`](../memories/repo/hardening-research.md),
[`categories-planning.md`](../memories/repo/categories-planning.md) (`UserModule` can't import `CategoryModule`)

Owner decisions applied (`~/projects/notes/budget-master/be-refactor.md`, read only):
- **D7** hard-delete cascade in a transaction; no client calls `DELETE /users`. **E8.Q2** the in-flight race is accepted.
  **E8.Q3** wiring chosen here (below).
- **E8.Q4** helmet defaults, CORS e2e + old-next smoke; fallback `Cross-Origin-Resource-Policy: cross-origin`.
- **E8.Q5** counters in a Mongo collection with a TTL index; prod index from S8b, tests via `autoIndex`.
- **E8.Q6** login 10 / 15 min per email; forgot-password 3 / h per email + 10 / h per IP; all attempts counted; key on
  trim + lowercase email. **E8.Q7** 429 in the envelope, `'Too Many Requests'`, no `X-RateLimit-*`.
- **D6** unknown errors → 500; **D14** `accessToken` stays the first and only `Set-Cookie` of `POST /auth`; **D15**
  CORS `credentials: true`; **D16** tests never touch prod, the manual run removes all it creates.

AC numbers are the tracker's S8a AC1–AC4: 1. cascade keeps develop's 200 body/status; 2. headers unchanged except
helmet's and no `X-Powered-By`; 3. 429 in the envelope, same for known/unknown emails; 4. unit + e2e incl. atomicity.

## Scope guard

**In:** `UserModule` + `UserService.deleteUser` (+ spec), `configure-app.ts` (helmet), a new `rate-limit` module
(entity, service + spec), `AuthService.login` and `UserService.forgotPassword` / `UserController.forgotPassword`
calling it, `package.json` / `pnpm-lock.yaml` (helmet), e2e specs, `ai-skills/REPO_CONTEXT.md`.

**Out (don't add):** `@nestjs/throttler`; configurable limits (no env keys, `.env.example` unchanged); `Retry-After`
or any `X-RateLimit-*` header; `trust proxy` (S9); the prod index / TTL script (S8b); orphan clean-up of already
deleted users (R8, S8b); the legacy `accountrecords` collection; counts in the delete response; a sliding window;
API Gateway throttling (S9).

## Dependency check (done at plan time, `pnpm view` / `npm pack`, nothing installed)

- **helmet 8.3.0** (latest, published 2026-07-11, > 2 weeks old): zero dependencies, no peer deps, `engines.node
  >=18`, dual package (`exports.import → index.mjs`, `index.d.mts` types bundled, no `@types/helmet`). It is a plain
  `(req, res, next)` middleware using `setHeader` / `removeHeader`, so it doesn't depend on the Express major (works
  on Express 5 / `@nestjs/platform-express` 12). ESM import: `import helmet from 'helmet';`. 8.x changes since 7.x:
  HSTS max-age 365 d, stricter CSP directive validation (irrelevant with defaults). Install `pnpm add helmet@^8.3.0`.
- **`@nestjs/throttler` 6.7.1** does declare `^12.0.0` peers, but it is **not used**: its storage is in-memory unless a
  custom `ThrottlerStorage` is written (which is the same Mongo `$inc` code as below), it adds `X-RateLimit-*` headers
  that must then be disabled (AC2), and its tracker/guard runs before pipes, so the email key needs custom parsing
  anyway. A ~40-line service on the existing mongoose stack does the whole job.

## CLI note

Run up front (Phase 3); check the generated relative imports end in `.js`, that `RateLimitService` was added to
`RateLimitModule.providers` and that `nest g mo` registered `RateLimitModule` in `AppModule` (**verify**; harmless, the
module is imported by `AuthModule` and `UserModule` anyway).

```bash
pnpm nest g mo rate-limit
pnpm nest g s rate-limit/services/rate-limit --flat
```

---

## Phase 1 — user-delete cascade in one transaction (AC1, AC4)

**Wiring (E8.Q3):** `UserModule` registers the six owned schemas with `MongooseModule.forFeature` (entity imports only,
no module import, no `forwardRef`). `@nestjs/mongoose` reuses an already compiled model (`connection.models[name]`,
`node_modules/@nestjs/mongoose/dist/mongoose.providers.js`), so the models are the same instances `CategoryModule`,
`AccountModule`, `BudgetModule` and `RecordModule` use. Chosen over a port in `RecordModule` because that port would
need the same four extra `forFeature` registrations there, plus a token, an interface and a provider: more code for
the same result. The entity files import only other entity files (`expense → budget`, `record → category`), never a
module, so no ESM cycle.

### `src/user/user.module.ts` — modify
- `MongooseModule.forFeature([...])`: add `Category`, `Account`, `Budget`, `BudgetHistory`, `Expense`, `Income` (each
  `{ name: X.name, schema: XSchema }`) next to `User`. One-line comment: registered here only for the delete cascade
  (importing their modules would be a cycle: `CategoryModule` imports `UserModule`).

### `src/user/services/user.service.ts` — modify
- Constructor: `@InjectConnection() connection: Connection` and `@InjectModel(...)` for the six models.
- `deleteUser(sub: string): Promise<GeneralResponse>` → `this.connection.transaction(async (session) => { … })`:
  1. `userModel.findByIdAndDelete(sub, { session })`; `null` → `BadRequestException(USER_NOT_FOUND_ERROR)` (re-checked
     inside the transaction, as the guidelines ask; aborts with no other delete).
  2. Sequential `deleteMany(filter, { session })`, one `await` each (one session, no `Promise.all`): `categoryModel`,
     `accountModel`, `budgetModel`, `budgetHistoryModel` with `{ sub }`; `expenseModel`, `incomeModel` with
     `{ userId: sub }`. `sub` is the string from the guard; every owner field in prod is a string (research §3).
  3. Return the unchanged body built from the deleted user doc: `{ ...INITIAL_RESPONSE, message: DELETE_USER_MESSAGE,
     data: { userDeleted: { email, firstName, lastName } } }`.
  - Nothing else in the callback (no logs): it may be retried.
  - Replace the "No cascade … lands in S8" comment with one line: the cascade, and the accepted in-flight race (E8.Q2).

### `src/user/services/user.service.spec.ts` — modify
- Providers: add `getModelToken(X.name)` mocks for the six models (`deleteMany: vi.fn(() => ({ exec }))`) and
  `getConnectionToken()` → `{ transaction: vi.fn((fn) => fn(fakeSession)) }`.
- `deleteUser` coverage: the body and message are exactly as before; `findByIdAndDelete(sub, { session })`; each
  `deleteMany` gets the right filter (`sub` vs `userId`) and `{ session }`, in order, after the user delete; missing
  user → 400 `'User not found.'` and no `deleteMany`; a rejecting `deleteMany` rejects `deleteUser` (no catch).

### `test/user-delete.e2e-spec.ts` — create
- `beforeAll`: `createTestApp()`, then `await model.init()` for all seven models (`app.get(getModelToken(...))`).
- Seed users A and B (signup + login through the API), then for **each** insert straight into the raw collections
  (`connection.collection(...)`, legacy shapes, string owners, minimal / missing fields): 2 categories, 1 account,
  1 budget, 1 budget history, 2 expenses, 1 income; and `POST /categories/create-local-categories {sub: A}` for one
  API-written set.
- Coverage:
  - `DELETE /users` as A → 200 with `toStrictEqual` develop's body (`'User deleted.'`, `data.userDeleted {email,
    firstName, lastName}`); `countDocuments` for A in all seven collections = 0; B's counts unchanged.
  - The same token afterwards → 401 (guard; nothing new), login for A → 401 `'Email or Password incorrect.'`.
  - **Atomicity:** before the clean delete, a one-shot spy on the `Income` model's `deleteMany` (the last op) that runs
    the real delete with the real session and then throws → enveloped 500; A's user doc and every A doc in all
    collections are still there (incl. the incomes); then the unspied `DELETE /users` → 200 and counts 0.
  - B can still log in and `GET /categories` / `GET /account-actions` return its docs.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test user.service`, `pnpm run test:e2e` (the existing `auth-users` DELETE flows
  still pass).
- Manual: none here (Phase 4).

---

## Phase 2 — helmet (AC2)

### Baseline first (before installing)
- On the unchanged code, run the new header assertions of `test/app.e2e-spec.ts` (below) in a "record" mode, or just
  print `Object.keys(res.headers).sort()` for the four requests, and paste the lists as the expected literals. That is
  the "unchanged" reference for AC2.

### `package.json` / `pnpm-lock.yaml`
- `pnpm add helmet@^8.3.0` (see the dependency check).

### `src/configure-app.ts` — modify
- `import helmet from 'helmet';` and `app.use(helmet())` as the **first** statement of `configureApp` (before
  `cookieParser` and `enableCors`, so preflight and error responses get the headers too). Defaults only (E8.Q4).
- Comment one line: defaults; `crossOriginResourcePolicy: { policy: 'cross-origin' }` is the agreed fallback if
  old-next breaks.
- No `disable('x-powered-by')`: helmet's `xPoweredBy` already removes it.

### `test/app.e2e-spec.ts` — modify
- `HELMET_HEADERS` = the 12 names from research §4 (`content-security-policy`, `cross-origin-opener-policy`,
  `cross-origin-resource-policy`, `origin-agent-cluster`, `referrer-policy`, `strict-transport-security`,
  `x-content-type-options`, `x-dns-prefetch-control`, `x-download-options`, `x-frame-options`,
  `x-permitted-cross-domain-policies`, `x-xss-protection`).
- `it.each` over: `GET /` (`text/html`, body still `Hello World!`), an enveloped 404 (`GET /nope`), the existing CORS
  preflight (`OPTIONS /` from `http://localhost:4100`), and a credentialed `POST /auth` 201 (seed a user) with
  `Origin: http://localhost:4100`:
  - every `HELMET_HEADERS` name present; `x-powered-by` absent;
  - header names minus `HELMET_HEADERS` `toStrictEqual` the baseline list for that request (AC2 "otherwise unchanged");
  - `cross-origin-resource-policy` is `same-origin` (pins the default, so a later switch to the fallback is a visible
    change).
- The `POST /auth` case also asserts CORS on the actual (non-preflight) request: `access-control-allow-origin` =
  the mirrored origin, `access-control-allow-credentials: true`, `set-cookie[0]` starts with `accessToken=` and is
  the only cookie, body unchanged.
- The existing preflight / unlisted-origin tests stay as they are.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm run test:e2e app` then the full `pnpm run test:e2e`.
- Manual: Phase 4 steps 2 and 9.

---

## Phase 3 — rate limits on `POST /auth` and `POST /users/forgot-password` (AC3, AC4)

### Design
- **Fixed window per key:** `_id = \`${scope}:${hashToken(normalized)}:${bucket}\``, `bucket = Math.floor(now /
  windowMs)`, `normalized = value.trim().toLowerCase()`. `hashToken` is the existing sha256 hex helper
  (`src/user/user.utils.ts`): no email or IP is stored in clear. The window is in the key, so correctness never
  depends on the TTL index; TTL only cleans up.
- **Atomic counter:** `findOneAndUpdate({ _id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true,
  returnDocument: 'after', lean: true })`; `expiresAt = new Date((bucket + 1) * windowMs)`. Over the limit when
  `count > limit`. Using `_id` as the key means the uniqueness the upsert relies on exists in prod without S8b (the
  `_id` index always exists), and MongoDB ≥ 4.2 retries a concurrent upsert that hits a duplicate key when the filter
  is an equality on the unique key, so parallel first hits don't 500 (proved in e2e). Not inside any transaction.
- **Where:** in the services, as the first step that sees a usable key, before the user lookup (so known and unknown
  emails behave the same):
  - login: after `AuthService`'s existing `isFilled` check (a missing / non-string email or password 401s without a
    lookup or bcrypt, so it can't guess anything), before `findByEmail`. Key on the email only (old-next logs in from
    Vercel's shared IPs, research §5).
  - forgot-password: first line of `UserService.forgotPassword`, after the DTO pipe (a 400 body does no lookup and no
    send). Both keys are incremented on every call (per email, per IP), then 429 if either is over.
- `shortcut:` comment on the window: a fixed window allows up to 2 × limit across a boundary; move to a sliding window
  if abuse shows up.

### `src/rate-limit/rate-limit.module.ts` — CLI, then populate
- `imports: [MongooseModule.forFeature([{ name: RateLimit.name, schema: RateLimitSchema }])]`, `providers:
  [RateLimitService]`, `exports: [RateLimitService]`. Depends on nothing else (no cycle with `AuthModule` /
  `UserModule`).

### `src/rate-limit/entities/rate-limit.entity.ts` — create
- `@Schema({ collection: 'ratelimits', versionKey: false })`; `@Prop({ type: String }) _id: string`, `@Prop({
  required: true }) count: number`, `@Prop({ required: true }) expiresAt: Date`.
- `RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })` — built under test only (`autoIndex`); prod
  gets it from S8b's script (comment says so).

### `src/rate-limit/rate-limit.constants.ts` — create
- `RATE_LIMITS = { login: { limit: 10, windowMs: 15 * 60_000 }, forgotPasswordEmail: { limit: 3, windowMs:
  3_600_000 }, forgotPasswordIp: { limit: 10, windowMs: 3_600_000 } } as const`; `type RateLimitScope = keyof typeof
  RATE_LIMITS`.
- `TOO_MANY_REQUESTS = 'Too Many Requests'`.

### `src/rate-limit/services/rate-limit.service.ts` — CLI, then populate
- `async consume(hits: { scope: RateLimitScope; value: string }[]): Promise<void>`: for each hit, sequentially, the
  upsert above; after all of them, if any `count > limit` → `throw new HttpException(HttpException.createBody(
  TOO_MANY_REQUESTS, TOO_MANY_REQUESTS, HttpStatus.TOO_MANY_REQUESTS), HttpStatus.TOO_MANY_REQUESTS)`, i.e. `error =
  { message: 'Too Many Requests', error: 'Too Many Requests', statusCode: 429 }` through `GeneralAppExceptionFilter`
  (same shape as every other `HttpException`; not logged, < 500). Sets no header, no cookie.

### `src/rate-limit/services/rate-limit.service.spec.ts` — CLI, then populate
- Mocked model (`findOneAndUpdate` → `{ exec }` resolving `{ count }`), `vi.useFakeTimers()` / `setSystemTime`.
- Coverage: key = `scope:<64 hex>:<bucket>` and never contains the raw value; `' A@B.com '` and `'a@b.com'` give the
  same key; `count === limit` passes, `limit + 1` throws the 429 body above; with two hits every hit is upserted even
  when the first is over; `expiresAt` = the bucket's end; moving the clock past the window changes the bucket (new
  key); the update is `$inc` + `$setOnInsert` with `upsert: true`.

### `src/auth/auth.module.ts`, `src/user/user.module.ts` — modify
- Add `RateLimitModule` to `imports`.

### `src/auth/services/auth.service.ts` (+ spec) — modify
- Inject `RateLimitService`; after the `isFilled` check: `await this.rateLimit.consume([{ scope: 'login', value: email
  }])`. The `findByEmail` lookup stays exact-case (legacy); only the key is normalized.
- Spec: `consume` called with the raw email before `findByEmail`; not called for missing fields; a 429 from `consume`
  propagates and `findByEmail` / `bcrypt.compare` / `signAsync` are never called.

### `src/user/services/user.service.ts` (+ spec), `src/user/controllers/user.controller.ts` — modify
- `forgotPassword({ email }: ForgotPasswordDto, ip: string | undefined)`: first line `await this.rateLimit.consume([{
  scope: 'forgotPasswordEmail', value: email }, { scope: 'forgotPasswordIp', value: ip ?? 'unknown' }])`.
- Controller: `forgotPassword(@Body() dto, @Req() req: Request)` → `this.userService.forgotPassword(dto, req.ip)`
  (pulling a request field, like `req.user.sub`; `Request` from `express`, type-only import).
- `req.ip` is the socket address until S9 sets `trust proxy`; `X-Forwarded-For` is ignored meanwhile (can't be
  spoofed to dodge the IP limit). Locally each developer is one IP, so nothing breaks.
- Spec: update the three existing `forgotPassword` calls for the new argument; `consume` gets both hits (raw email,
  the ip, `'unknown'` when `undefined`) before `findByEmail`; a 429 → no lookup, no token write, no mail.

### `test/rate-limit.e2e-spec.ts` — create
- `beforeAll`: `createTestApp()`, `await rateLimitModel.init()`; `beforeEach`: `deleteMany({})` on `ratelimits` (the
  file's tests share one IP); mailer spy as in `auth-users` (`FORGOT_PASSWORD_MAILER`, `mockResolvedValue`).
- Coverage:
  - Login, known email: 10 wrong-password attempts → 401 each; the 11th with the **right** password → 429, body
    `toStrictEqual({ ...INITIAL_RESPONSE, success: false, error: { message: 'Too Many Requests', error: 'Too Many
    Requests', statusCode: 429 } })`, no `set-cookie`, no `retry-after`, no header starting with `x-ratelimit`.
  - Login, unknown email: same sequence → identical statuses and 429 body (AC3, known = unknown).
  - Normalization: attempts alternating `' User@X.invalid '` / `'user@x.invalid'` share one counter.
  - Missing email / password → 401 `'Unauthorized'` and no `ratelimits` doc.
  - Forgot-password per email: 3 × 201 `'Email Sent'`, the 4th → 429 (same body), for a known and an unknown email;
    the mailer is called 3 times for the known one, never on the 429.
  - Forgot-password per IP: 10 different unknown emails → 201, the 11th (new email) → 429; sending a different
    `X-Forwarded-For` on each doesn't help (still 429 on the 11th).
  - **Atomicity:** 15 parallel wrong-password logins for one email (`Promise.all`) → exactly 10 × 401 and 5 × 429, no
    500; the window's doc has `count: 15` and there is exactly one doc for that key.
  - Stored docs: `_id` matches `/^login:[0-9a-f]{64}:\d+$/` (no raw email in the collection), `expiresAt` in the
    future; `ratelimits` has the TTL index `{ expiresAt: 1 }`, `expireAfterSeconds: 0` (built by `autoIndex`, the
    shape S8b must create).
- Existing specs stay under the limits (checked): `auth-users` sends 7 counted forgot-password calls from one IP (< 10)
  and at most 2 per email (< 3), and every login spec uses a fresh email (< 10); each e2e file drops the DB in
  `closeTestApp`, so counters don't leak between files.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`, `pnpm run lint`.
- Manual: Phase 4 steps 5–8.

---

## Phase 4 — docs + manual run on the prod DB (AC1–AC3)

### `ai-skills/REPO_CONTEXT.md` — modify
- Overview: add S8a (cascade, helmet, rate limits). Current Structure: `configure-app.ts` comment gains helmet; new
  `rate-limit/` block (module, constants, entity `ratelimits`, service + spec); `user.module.ts` comment: also
  `forFeature` of the six owned schemas for the cascade; new e2e files `user-delete`, `rate-limit`.
- "Does **not** exist yet": remove the user-delete cascade, rate limiting and helmet.
- Route table: `POST /auth` and `POST /users/forgot-password` gain the 429 row text (`'Too Many Requests'`, limits,
  keys); `DELETE /users` → "Deletes the user and their categories, accounts, budgets, budget histories, expenses and
  incomes in one transaction; 200 `'User deleted.'` `data.userDeleted {email, firstName, lastName}`".
- Database: `ratelimits` collection (hashed keys, fixed windows, TTL on `expiresAt`, built only under test until S8b's
  script); the prod collection is created by the first login on `start:dev` (D16).
- Notes: **S9** must set Express `trust proxy` (only API Gateway's hop) or every forgot-password call shares one IP
  bucket; helmet's CORP fallback.

**Success criteria**
- Automatic: none beyond Phases 1–3.
- Manual (orchestrator, `PORT=4000 TEST_FRONTEND_URI=http://localhost:4101 pnpm run start:dev` on the owner's `.env`
  = **prod DB**, D16; process env wins over `.env`, so CORS gets a known test origin without reading `.env`). Base
  `http://localhost:4000`. **Creates 1 `users` doc, the 12 seeded categories, 1 account, 1 budget + its history,
  1 expense, 1 income, and `ratelimits` docs (keys = sha256 of the throwaway / `.invalid` emails and of the local IP);
  the cascade removes everything except the `ratelimits` docs (step 10).** Never touch existing prod docs, never send
  forgot-password to a real address (only unknown `.invalid` ones, so no mail is even attempted). `TS=$(date +%s)`,
  `EMAIL=e2e-manual-$TS@example.invalid`, throwaway password, `curl -i` everywhere.
  1. `POST /users` `{email, password, firstName:'Manual', lastName:'Check', middleName:''}` → 201; `SUB`.
  2. `POST /auth` `{email, password}` with `-H 'Origin: http://localhost:4101'` → 201; `TOKEN` = `set-cookie[0]`
     value; headers: the 12 helmet headers, no `X-Powered-By`, `Access-Control-Allow-Origin: http://localhost:4101`,
     `Access-Control-Allow-Credentials: true`, only one `Set-Cookie`.
  3. `POST /categories/create-local-categories {sub:SUB}` → 201; `GET /categories` → 12; take one `CAT`.
  4. `POST /account-actions` (`title:'Manual'`, `alias:'m'`, `accountType:'Debit'`, `amount:100`,
     `backgroundColor:'#000'`, `color:'#fff'`) → `ACC`; `POST /budgets` with the 11 fields → 201; `POST
     /expenses-actions` (amount 10, `account:ACC`, `category:CAT`, `linkedBudgets:[]`) → 201; `POST /incomes-actions`
     (amount 5, `account:ACC`, `category:CAT`, `expensesPaid:[]`) → 201.
  5. Login limit: `POST /auth` with `EMAIL` and a wrong password 9 times → 401 each (10 attempts with step 2); the
     next one with the **right** password → 429 `'Too Many Requests'` in the envelope, no `Set-Cookie`, no
     `X-RateLimit-*`. (`EMAIL` stays locked for 15 min; `TOKEN` from step 2 still works.)
  6. Same 11-attempt sequence with `UNK=e2e-manual-unknown-$TS@example.invalid` (never signed up) → the same 10 × 401
     + 429.
  7. Forgot-password per email: `POST /users/forgot-password {email: UNK}` 3 × → 201 `'Email Sent'`, the 4th → 429.
  8. Forgot-password per IP: 6 more calls with fresh `e2e-manual-ip-$TS-<n>@example.invalid` emails → 201 (10 counted
     from this IP with step 7), the next → 429. (The local IP stays limited for up to 1 h; say so to the owner.)
  9. ~~old-next smoke~~ **Dropped (Q4): moves to S9's beta; CORS is covered by the e2e.** Was: old-next smoke (**owner, browser**, optional but recommended): run the old-next clone with `next dev -p 4101` and
     `NEXT_PUBLIC_BACKEND_URI=http://localhost:4000` (its own `.env.local`, not this repo's), log in with a second
     throwaway `e2e-manual-ui-$TS@example.invalid` user (sign up through the UI), open the dashboard, create and
     delete one account; the browser console shows no CORS / CORP / CSP error. Delete that user with its token
     (`DELETE /users` → 200). If CORP blocks anything, switch to the `cross-origin` fallback and repeat.
  10. **Clean-up:** `DELETE /users` with `TOKEN` → 200, body `{…, message:'User deleted.', data:{userDeleted:{email:
      EMAIL, firstName:'Manual', lastName:'Check'}}}` (AC1); the same token → 401. Orchestrator's read-only check on
      the prod connection: `users.countDocuments({_id: SUB})`, `categories` / `accounts` / `budgetmodels` /
      `budgethistorymodels` `countDocuments({sub: SUB})`, `createexpenses` / `createincomes`
      `countDocuments({userId: SUB})` = 0 each . `ratelimits` docs: list `_id`s starting with
      `login:<sha256(lowercase EMAIL)>:`, `login:<sha256(UNK)>:`, `forgotPasswordEmail:` / `forgotPasswordIp:` for the
      hashes used; delete them with the owner's OK (`deleteMany` by those exact `_id`s), or leave them: they hold only
      hashes, stop counting when their window ends, and the TTL monitor removes them within a minute of S8b creating
      the index (their `expiresAt` is already past). Report `SUB`, the counts and which option was taken.
  - On any failure after step 1, jump to step 10 with the current token (the cascade removes every owned doc).

---

## AC Coverage Summary

| AC | Phase(s) | Automatic / manual | Coverage |
|---|---|---|---|
| AC1 — cascade keeps develop's 200 body/status | 1, 4 | both (unit body + filters; e2e body `toStrictEqual`, counts for A = 0, B untouched; manual 10) | full |
| AC2 — headers unchanged except helmet's, no `X-Powered-By` | 2, 3, 4 | both (e2e header-name sets vs. the pre-helmet baseline on 4 responses incl. CORS; 429 has no `x-ratelimit-*` / `retry-after`; manual 2, 5, 9) | full in-process; the old-next browser smoke (9) is owner-run, so CORP-in-browser is **partial** until he does it |
| AC3 — 429 in the envelope, same for known/unknown emails | 3, 4 | both (unit 429 body; e2e known vs unknown, both limits, normalization; manual 5–8) | full for email keys; the per-IP key is real only once S9 sets `trust proxy` (**partial** for deployed per-IP behavior, local/e2e full) |
| AC4 — unit + e2e incl. atomicity | 1, 3 | automatic (cascade rollback e2e; 15 parallel logins → exact count) | full |

## Decisions (beyond the research)

- **Cascade wiring (E8.Q3):** `forFeature` of the six schemas in `UserModule`, not a `RecordModule` port (less code,
  same models, no cycle).
- User doc deleted first inside the transaction (re-checks existence; the response comes from it), then the six
  `deleteMany`s in a fixed order.
- **No new rate-limit dependency:** own `RateLimitService` + mongoose; `@nestjs/throttler` rejected (above).
- Module name `rate-limit` (`RateLimitModule`, `RateLimitService`), collection `ratelimits`, scopes `login`,
  `forgotPasswordEmail`, `forgotPasswordIp`, e2e files `user-delete` and `rate-limit` (open question 1).
- Fixed window keyed in `_id` (no extra unique index needed in prod; TTL only cleans up).
- Both email and IP are stored only as sha256 (reusing `hashToken`); the email key is trim + lowercase, the lookup
  stays exact-case.
- Login counts after the existing missing-field 401 check (those requests can't guess a password); forgot-password
  counts after the DTO pipe (a 400 does no lookup or send). Every attempt that reaches the lookup is counted, success
  or not (E8.Q6).
- 429 body = Nest's standard shape `{ message: 'Too Many Requests', error: 'Too Many Requests', statusCode: 429 }`,
  like every other `HttpException` in the envelope.
- `req.ip` missing → key `'unknown'`.
- Limits are constants (no env keys); tests use the real numbers.
- helmet is registered first in `configureApp` so preflights and early errors carry the headers.

## Assumptions

- Prod Atlas runs MongoDB ≥ 4.2, so concurrent upserts on `_id` are retried by the server (e2e proves it on the memory
  replica set and CI's `mongo:8`).
- Every owner field in prod is a string (research §10), so string filters reach every doc.
- Nest's body parser and helmet both run as Express middleware in `configureApp`'s order; if a 413 / invalid-JSON
  response turns out to skip helmet, that is accepted (no client reads those headers) and the AC2 baseline covers only
  the four listed responses.
- The `ratelimits` collection appearing in prod on the first `start:dev` login is fine (research §5, D16).
- The orchestrator may read the prod connection for the post-run counts, as in S7c's manual block.

## Open questions (before implementation)

1. **Module name.** The guidelines ask to confirm a new module's name at plan time. *Recommend:* `rate-limit`
   (`RateLimitModule`, collection `ratelimits`).
2. **Lockout window for the manual run.** Steps 5–8 lock the throwaway emails (harmless) and the owner's local IP for
   forgot-password for up to 1 h. *Recommend:* accept; or drop step 8 and rely on the e2e for the per-IP limit.
3. **Leftover `ratelimits` docs after the manual run.** *Recommend:* delete them by exact `_id` with the owner's OK;
   leaving them is also safe (hashes only, expired windows, removed once S8b's TTL index exists).
4. **Plan approval.** *Recommend:* approve as written (4 phases).

### Answers (owner, 2026-10-25)

1. Yes: module `rate-limit` (`RateLimitModule`), collection `ratelimits`.
2. Accepted: the manual run locks its throwaway emails and the local IP's forgot-password for up to 1 h.
3. The orchestrator deletes the leftover `ratelimits` docs by exact `_id` and reports the count.
4. Approved as written, except: step 9 (old-next browser smoke) is dropped from the manual block and moves to S9's
   beta; CORS is covered by the e2e. Everything else as planned (helmet 8.3.0 defaults, no `@nestjs/throttler`,
   `forFeature` in `UserModule`, `trust proxy` noted for S9).

## Implementation checklist

- [x] Phase 1 — `UserModule` `forFeature`, `deleteUser` transaction + spec, `test/user-delete.e2e-spec.ts`
  (cascade, other user untouched, rollback)
- [x] Phase 2 — baseline header lists, `pnpm add helmet@^8.3.0`, `configureApp`, `app.e2e-spec` header + CORS checks
- [x] Phase 3 — CLI module/service, entity, constants, `consume` + spec, wiring in auth/user (+ specs),
  `test/rate-limit.e2e-spec.ts`
- [x] Phase 4 — `REPO_CONTEXT.md`
- [x] Automatic: `pnpm run lint`, `pnpm run build`, `pnpm test` (21 files / 275 tests), `pnpm run test:e2e`
  (10 files / 193 tests)
- [ ] Phase 4 manual run on the prod DB — orchestrator (steps 1–8, 10; step 9 dropped, moved to S9's beta)
