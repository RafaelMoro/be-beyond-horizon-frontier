# Plan: S5 — accounts (`accounts` collection, `/account-actions` CRUD, owner-bound balance helpers)

**Status:** APPROVED (2026-10-25) — owner approved as written; run-all.

**Branch:** `feat/accounts` (from `main` v0.6.0, S1–S4 merged) · **Date:** 2026-10-25 · **Research:**
[`ai-research/accounts.research.md`](../ai-research/accounts.research.md)
· Memory: [`memories/repo/accounts-research.md`](../memories/repo/accounts-research.md),
[`memories/repo/accounts-planning.md`](../memories/repo/accounts-planning.md)

Owner decisions applied (`~/projects/notes/budget-master/be-refactor.md`):
- **E5.Q1–Q4** (as the research recommended): Q1 module **`account`** (route `/account-actions`, collection
  `accounts`, model `Account`); Q2 the delete cascade is a **port** (`Symbol` token, default `0/0`) that S7 implements;
  Q3 the delete runs in **`connection.transaction`** (ownership read + port + delete, session passed to the port);
  Q4 **`null` is skipped** (no write, no D17 check), as in S4. Kept: 400 foreign PUT vs 401 foreign DELETE, PUT may
  `$set` `amount`.
- Prod facts (E5 row): `sub` is a string ×38, `amount` is int or double, 22 docs have all 3 D17 fields, **1 doc has a
  non-4-digit int `terminationFourDigits`**: keep develop's behaviour (its PUT echo 400s with the digits text); S8's
  data repair fixes the doc. No S5 code for it.
- D0 (develop = contract; old-next must keep working; FE_Budget_Master adapts), D6 (unexpected → 500, legacy texts
  exact), D16 (tests never touch prod; the manual run is on prod and deletes everything it creates), D17 (`alias`
  required on create; `accountProvider`/`terminationFourDigits` optional; schema marks none of the three required).
- Security finding High "record PUT repoints `account`, then rewrites its balance" → Phase 3 (`incrementBalance`
  filters `{_id, sub}`); PUT/DELETE write filters `{_id, sub}` → Phase 2.

The contract table, client usage and edge-case list are in the research; this plan doesn't repeat them. AC numbers
are the research's AC1–AC5.

## Scope guard

**In:** the `account` module (entity, constants, interface, DTOs, service + spec, controller), the 4 routes, the
records-cascade port with a `0/0` default, `assertAccountOwned` + `incrementBalance` for S7,
`test/accounts.e2e-spec.ts`, `REPO_CONTEXT.md`.

**Out (don't add):** the dead legacy balance methods (research list), a real records cascade (S7), budgets/history/
`isPaid`/transfer clean-up on delete, the prod index script and the `terminationFourDigits` data repair (S8), response
fields beyond develop's (no timestamps: FE_Budget_Master echoes them into PUT), `@nestjs/mapped-types`, a shared e2e
auth helper file, response DTO classes for raw docs, a `UserModule` import.

## CLI note

Generate the module first, then service and controller with `--flat` (S2 memory). Check generated relative imports
end in `.js`. The controller schematic writes `@Controller('account')`: change it to `@Controller('account-actions')`.

---

## Phase 1 — Module, `accounts` schema, `GET` + `POST /account-actions`

**Changes**

1. `pnpm nest g mo account` — creates `src/account/account.module.ts`, adds `AccountModule` to `AppModule` imports
   (**verify**).
2. `src/account/entities/account.entity.ts` — create (hand-authored), like `category.entity.ts`:
   - `@Schema({ collection: 'accounts' })` class `Account`, no timestamps, default `versionKey`.
   - Required: `title`, `accountType`, `backgroundColor`, `color` (strings), `amount` (`Number`), `sub`
     (`{ type: String, required: true }`, same comment as categories: legacy `Types.ObjectId` became `Mixed`, all prod
     docs are strings).
   - Optional, no default (D17): `alias`, `accountProvider`, `terminationFourDigits` — all `String` (develop's type;
     the one prod int hydrates to its string form, like develop — comment pointing at S8's repair).
   - `AccountSchema.index({ sub: 1 })` (test-only build; prod from S8's script). `export type AccountDoc =
     HydratedDocument<Account>`.
3. `src/account/account.constants.ts` — create: `ACCOUNT_CREATED_MESSAGE 'Account created'`, `ACCOUNT_UPDATED_MESSAGE
   'Account Updated'`, `ACCOUNT_DELETED_MESSAGE 'Account Deleted'`, `ACCOUNT_NOT_FOUND 'Account not found'`,
   `ACCOUNT_UNAUTHORIZED_ERROR 'Account does not belong to the user'` (verbatim from `git -C ../be-budgt-master show
   origin/develop:src/repositories/accounts/constants/index.ts`), plus the two inline develop texts
   `TERMINATION_DIGITS_ERROR 'Termination digits must be a 4-digit number (digits only).'`, `INVALID_PROVIDER_ERROR
   'Invalid account provider'`, `CARD_PROVIDERS = ['visa', 'mastercard', 'american-express'] as const`,
   `TERMINATION_DIGITS_REGEX = /^[0-9]{4}$/`.
4. `src/account/dtos/account.dto.ts` — create `CreateAccountDto`, develop's property order and decorators
   (`title`, `alias`, `accountType`, `accountProvider`, `amount`, `terminationFourDigits`, `backgroundColor`, `color`):
   strings `@IsString() @IsNotEmpty()`, `amount` `@IsNumber() @IsNotEmpty()`. D17: `accountProvider` and
   `terminationFourDigits` get `@IsOptional()` in front; `alias` stays required. No initializers.
5. `src/account/account.module.ts` — populate: `MongooseModule.forFeature([{ name: Account.name, schema: AccountSchema }])`,
   `exports: [AccountService]` (S7).
6. `pnpm nest g s account/services/account --flat` — `AccountService` (`@InjectModel(Account.name)`):
   - `findByUser(sub: string)` — `find({ sub }).exec()`, **no projection** (develop returns `sub`, `__v`), no sort →
     `{ ...INITIAL_RESPONSE, data: { accounts } }` (`message: null`).
   - `createAccount(sub: string, dto: CreateAccountDto)`:
     - `fields` = dto without `null` values (Q4 rule applied to create too, see Decisions).
     - private `assertCardFields({ accountProvider, terminationFourDigits })`: digits first
       (`terminationFourDigits != null && !REGEX.test(...)` → `BadRequestException(TERMINATION_DIGITS_ERROR)`), then
       provider (`!= null && !CARD_PROVIDERS.includes(...)` → `BadRequestException(INVALID_PROVIDER_ERROR)`). Exact,
       case-sensitive. Reused by PUT.
     - `create({ ...fields, sub })` → 201 `{ ...INITIAL_RESPONSE, message: ACCOUNT_CREATED_MESSAGE, data: { account } }`.
   - No try/catch (D6).
7. `pnpm nest g co account/controllers/account --flat --no-spec` — `@Controller('account-actions')`, thin:
   `@Get() getAccounts(@Req() req: AuthenticatedRequest)`, `@Post() createAccount(@Body() dto, @Req() req)`, both pass
   `req.user.sub`.
8. `test/accounts.e2e-spec.ts` — create; `signupAndLogin()` copied from `test/categories.e2e-spec.ts` (email prefix
   `e2e-acc-`), `badRequest()` / `unauthorized` helpers, `accountModel` from `getModelToken(Account.name)`,
   `await accountModel.init()` in `beforeAll` (Phase 2 adds the first transaction).

**Edge cases**
- `terminationFourDigits: 1234` (number) → 400 `IsString` message (develop). `amount: '10'` → 400; `0`, negatives,
  floats pass.
- A cash account omits both card fields: the saved doc has no `accountProvider`/`terminationFourDigits` keys.
- `sub` or `accountId` in the POST body → 400 whitelist.

**Test coverage**
- `account.service.spec.ts` (model via `getModelToken(Account.name)`): `findByUser` queries `{ sub }` with no
  projection; create stores `sub`, message/shape; digits error wins over provider error when both bad; each check
  skipped when the field is absent or `null`; `null` keys not passed to `create`; `'Visa'` / `'amex'` rejected.
- e2e: GET 401 without token; GET fresh user → `data.accounts: []`, `message: null`; POST card account → 201 exact
  envelope, doc incl. `_id, sub, __v`, `sub` = the JWT string; POST cash account (no provider/digits) → 201 without
  those keys; missing `alias` → 400 exact class-validator array; digits `'12a4'` / `'123'` → 400 digits text;
  provider `'Visa'` → 400 provider text, and no doc written for either (`countDocuments({ sub })`); number digits → 400;
  `sub` in body → 400; POST to `/account-actions/` (trailing slash) → 201; user B's GET doesn't list A's account; GET
  returns full docs incl. `sub`.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none (no delete path yet; the full manual run with clean-up is in Phase 3).

---

## Phase 2 — `PUT` / `DELETE /account-actions`: owner-bound writes, cascade port, delete transaction

**Changes**

1. `src/account/account.interface.ts` — create (mailer-port pattern):
   ```ts
   export interface AccountRecordsCascade {
     deleteAccountRecords(args: { accountId: string; sub: string; session: ClientSession }):
       Promise<{ numberExpensesDeleted: number; numberIncomesDeleted: number }>;
   }
   ```
2. `src/account/account.constants.ts` — add `ACCOUNT_RECORDS_CASCADE = Symbol('ACCOUNT_RECORDS_CASCADE')`.
3. `src/account/account.module.ts` — `providers: [AccountService, { provide: ACCOUNT_RECORDS_CASCADE, useValue:
   noRecordsCascade }]` where the default resolves `{ numberExpensesDeleted: 0, numberIncomesDeleted: 0 }` (comment:
   S7 replaces it; it must not make `AccountModule` import `RecordModule`, which imports this module).
4. `src/account/dtos/account.dto.ts` — add `UpdateAccountDto` by hand: every create field `@IsOptional()` + its create
   decorators (all 8, so FE_Budget_Master's GET echo passes the whitelist), then `accountId` `@IsMongoId()
   @IsNotEmpty()`; `DeleteAccountDto` with `accountId` `@IsMongoId() @IsNotEmpty()`.
5. `AccountService` — inject `@InjectConnection() connection` and `@Inject(ACCOUNT_RECORDS_CASCADE) recordsCascade`.
   - private `findAccountOwner(accountId: string, session?: ClientSession): Promise<string | null>` —
     `findById(accountId).select('sub').session(session ?? null)`; returns `String(doc.sub)` or `null`. The one read
     used to pick the message; the write itself is still filtered by owner.
   - `updateAccount(sub: string, dto: UpdateAccountDto)` — legacy precedence:
     1. owner `null` → 400 `ACCOUNT_NOT_FOUND`; owner `!== sub` → **400** `ACCOUNT_UNAUTHORIZED_ERROR`.
     2. `assertCardFields(dto)` (null/absent skipped).
     3. `$set` from the 8-field allow-list, present and non-null only (never `accountId`/`sub`; `amount: 0` kept).
     4. `findOneAndUpdate({ _id: accountId, sub }, { $set }, { returnDocument: 'after' })`; null (deleted in between)
        → 400 `ACCOUNT_NOT_FOUND`.
     5. 200 `{ ...INITIAL_RESPONSE, message: ACCOUNT_UPDATED_MESSAGE, data: { account } }`.
   - `deleteAccount(sub: string, { accountId }: DeleteAccountDto)` — all inside `connection.transaction(async (session)
     => …)`, `{ session }` on every op, no side effects:
     1. `findAccountOwner(accountId, session)`: `null` → 400 `ACCOUNT_NOT_FOUND`; `!== sub` → **401**
        `UnauthorizedException(ACCOUNT_UNAUTHORIZED_ERROR)`.
     2. `counts = await recordsCascade.deleteAccountRecords({ accountId, sub, session })`.
     3. `accountDeleted = findOneAndDelete({ _id: accountId, sub }, { session })`; null → 400 `ACCOUNT_NOT_FOUND`.
     4. return 200 `{ ...INITIAL_RESPONSE, message: ACCOUNT_DELETED_MESSAGE, data: { accountDeleted, ...counts } }`
        (key order `accountDeleted, numberExpensesDeleted, numberIncomesDeleted`).
6. `AccountController` — `@Put() updateAccount(@Body() dto, @Req() req)`, `@Delete() deleteAccount(@Body() dto, @Req() req)`
   (id in the body, legacy). Both pass `req.user.sub`.

**Edge cases**
- PUT with only `accountId` → 200 `'Account Updated'` with the unchanged doc.
- PUT on an old account without D17 fields (insert it raw via `accountModel.collection.insertOne`) → 200; GET shows it
  without those keys. Never `save()` a loaded doc.
- PUT on a doc whose stored `terminationFourDigits` is an int (raw insert `123`): GET returns `'123'`; echoing it in PUT
  → 400 digits text (develop behaviour, E5 row). Echoing a valid stored value passes.
- Foreign id with bad digits → 400 `ACCOUNT_UNAUTHORIZED_ERROR`, not the digits text (ownership first).
- Non-ObjectId `accountId` → 400 `IsMongoId` validation, never reaches the query.

**Test coverage**
- `account.service.spec.ts` (model mocked; `connection` as `{ transaction: vi.fn((fn) => fn(session)) }`; cascade
  `useValue` returning `{ numberExpensesDeleted: 2, numberIncomesDeleted: 3 }`):
  - update: missing → 400 not-found, foreign → 400 unauthorized (both before the D17 checks and without a write);
    digits before provider; `$set` excludes `accountId`/`sub`/`null`/absent, keeps `amount: 0`; filter `{ _id, sub }`;
    `returnDocument: 'after'`; write returns null → 400 not-found.
  - delete: missing → 400, foreign → 401 (`UnauthorizedException`), cascade and delete not called; owned → cascade
    gets `{ accountId, sub, session }`, delete filters `{ _id, sub }` with the session, response carries 2/3; delete
    returns null → 400.
- e2e:
  - AC3: A creates an account; B's PUT → 400 `'Account does not belong to the user'`, B's DELETE → 401 same text
    (exact bodies); A's doc unchanged (`findById` deep-equal before/after). Random unused ObjectId → 400 `'Account
    not found'` on both.
  - Owner PUT: title + `amount: 250.5` → 200 new values; only `accountId` → 200 unchanged; `alias: null` → 200 alias
    kept; bad digits / provider → 400 texts, doc unchanged; `sub` in body → 400; full GET echo (FE_Budget_Master shape:
    every GET field except `_id, __v, sub` + `accountId`) → 200; old-account and int-digits cases above; PUT and
    DELETE to `/account-actions/` (trailing slash) work.
  - Owner DELETE → 200 `'Account Deleted'`, `data: { accountDeleted: <doc>, numberExpensesDeleted: 0,
    numberIncomesDeleted: 0 }`; second DELETE → 400 not-found; no token → 401.
  - Port wiring: `cascade = app.get(ACCOUNT_RECORDS_CASCADE, { strict: false })`; spy resolves 4/1 and captures the
    session → response has 4/1 and `session.inTransaction()` was `true` during the call. Spy rejects → 500 enveloped
    and the account still exists (silence `Logger.prototype.error`).

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none here (Phase 3 runs all 4 routes once on prod, with clean-up).

---

## Phase 3 — Helpers for S7, docs, manual run on prod

**Changes**

1. `AccountService.assertAccountOwned({ accountId, sub, session }: { accountId: string; sub: string; session?:
   ClientSession }): Promise<void>` — `!isValidObjectId(accountId)` → `NotFoundException(ACCOUNT_NOT_FOUND)` without
   a query; `findAccountOwner(accountId, session)` → `null` → 404; `!== sub` → `UnauthorizedException(
   ACCOUNT_UNAUTHORIZED_ERROR)` (legacy `findAccountByIdForRecords`; comment: S7 wraps the transfer case in 400).
   Unused by S5 routes.
2. `AccountService.incrementBalance({ accountId, sub, delta, session }: { accountId: string; sub: string; delta:
   number; session: ClientSession }): Promise<AccountDoc>` — invalid id → 404 without a query; one
   `findOneAndUpdate({ _id: accountId, sub }, { $inc: { amount: delta } }, { session, returnDocument: 'after' })`;
   null → `NotFoundException(ACCOUNT_NOT_FOUND)` so the caller's transaction aborts. Comment: owner-bound (audit High),
   S7 passes signed deltas. `session` required (it is only meaningful inside a caller's transaction).
3. `ai-skills/REPO_CONTEXT.md` — Overview (S5), tree (`account/`, `test/accounts.e2e-spec.ts`), the 4 routes in the
   route table (statuses and the 400-PUT/401-DELETE split), a line on `ACCOUNT_RECORDS_CASCADE` (default 0/0, S7
   provides it), and drop "accounts" from the "does not exist yet" line.

**Edge cases**
- `$inc` on an int-stored `amount` with a fractional delta stores a double (fine; research note on last-digit float
  differences vs legacy JS math is S7's characterization concern).
- A foreign account and a missing one both give 404 from `incrementBalance` (one query, no oracle needed for S7).

**Test coverage**
- `account.service.spec.ts`: `assertAccountOwned` bad id → 404 no query; missing → 404; foreign → 401; owned →
  resolves; session forwarded. `incrementBalance` filters `{ _id, sub }`, `$inc: { amount: delta }`, passes the
  session and `returnDocument: 'after'`; null → 404; bad id → 404 no query.
- e2e (helpers via `app.get(AccountService)`, inside `connection.transaction` from `app.get(getConnectionToken())`):
  A's account `amount: 100`; `incrementBalance` with A's sub and `-30.5` → returns `69.5`, DB `69.5`; with B's sub →
  404 and DB unchanged; a transaction that increments then throws → DB unchanged (rollback). `assertAccountOwned`:
  A → resolves, B → 401, unused id / `'abc'` → 404.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e` (CI repeats e2e on the
  docker replica set).
- Manual (orchestrator, `pnpm run start:dev` on the owner's `.env` = **prod DB**, D16). **Creates one `users` doc and
  two `accounts` docs, no categories, and deletes all of them in this phase.** `TS=$(date +%s)`,
  `EMAIL=e2e-manual-$TS@example.invalid`, throwaway password, base `localhost:3000`, JSON bodies.
  1. `POST /users` `{email, password, firstName:'Manual', lastName:'Check', middleName:''}` → 201; keep
     `SUB=data.userCreated.sub`.
  2. `POST /auth/` → 201; `TOKEN` = `set-cookie[0]` value (between the first `=` and `;`). Send
     `Authorization: Bearer $TOKEN` below.
  3. `GET /account-actions` → 200 `message: null`, `data.accounts: []`.
  4. Cash: `POST /account-actions/` `{title:'Manual cash', alias:'Cash', accountType:'Efectivo', amount:100,
     backgroundColor:'Dark Orange', color:'white'}` → 201 `'Account created'`, no `accountProvider` /
     `terminationFourDigits` keys, `sub == SUB`; keep `CASH`.
  5. Card: same + `accountType:'Crédito', accountProvider:'visa', terminationFourDigits:'1234'` → 201; keep `CARD`.
  6. Rejections (no doc written): card body with `terminationFourDigits:'12a4'` → 400 digits text; `accountProvider:
     'Visa'` → 400 `'Invalid account provider'`; no `alias` → 400 validation array. `GET` → still exactly 2 accounts.
  7. `PUT /account-actions/` `{accountId: CARD, title:'Manual card 2', amount: 250.5}` → 200 `'Account Updated'` with
     the new values; then the old-next edit shape (all fields + `accountId`) → 200.
  8. `PUT` and `DELETE /account-actions` `{accountId:'000000000000000000000000'}` → 400 `'Account not found'` (the
     foreign-account case is e2e-only; never touch real users' docs on prod).
  9. **Clean-up (before the user):** `DELETE /account-actions/` `{accountId: CASH}` and `{accountId: CARD}` → each 200
     `'Account Deleted'`, `numberExpensesDeleted: 0`, `numberIncomesDeleted: 0`. Then `GET /account-actions` →
     `data.accounts: []` (**0-leftover check for `SUB`**, while the token still works). Only then `DELETE /users` →
     200, and `GET /account-actions` with the same token → 401.
  - On any failure after step 1, jump to step 9 with the current token (list ids from `GET`). The orchestrator's
    independent check: read-only `countDocuments({ sub: SUB })` on `accounts` against the prod URI = 0; if not,
    delete leftovers by `sub` with the owner's OK. Report `SUB` and the final count.

---

## AC Coverage Summary

| AC | Phase(s) | Automatic / manual | Coverage |
|---|---|---|---|
| AC1 — 4 routes: legacy status, envelope, messages, `data` keys, trailing slash | 1, 2 (+3 manual) | both (e2e per route and error; manual steps 3–9) | full |
| AC2 — D17: `alias` required on create, card fields optional with develop's checks, old docs readable/editable, PUT sets `amount` | 1, 2 | both (unit + e2e incl. raw old doc and int-digits doc; manual 4–7) | full |
| AC3 — foreign PUT/DELETE never write | 2 | automatic (e2e two users, doc deep-equal; unit filters) | full (manual only covers the missing-id side, by design on prod) |
| AC4 — `assertAccountOwned` 404/401, owner-bound `incrementBalance` in a session, cascade seam 0/0 | 2 (seam), 3 (helpers) | automatic (unit + e2e incl. rollback and session-in-transaction) | full (real cascade is S7) |
| AC5 — unit tests for every service rule; e2e for 4 routes, cross-user, D17, helpers' owner binding | 1, 2, 3 | automatic | full |

## Decisions (beyond the research)

- Cascade default is a `useValue` object in `AccountModule`; e2e spies on it via `app.get(token, { strict: false })`.
- PUT reads `sub` only (`select('sub')`) to choose the message, then writes with `{ _id, sub }`; a write that matches
  nothing after a passing check → 400 `'Account not found'`. DELETE's read and write share the transaction session.
- `null` values are dropped on **create** too (not only PUT): no `null` card field is stored and the D17 checks skip
  it. Legacy would store it; no client sends `null`.
- `incrementBalance` takes a required session and returns the updated doc; foreign and missing both 404.
- Card checks are one private service method (no separate `card-provider` file); provider list and regex in constants.
- No `IMPLEMENTATION_GUIDELINES.md` change: ports and transactions are already documented patterns.
- The manual run creates no categories (accounts don't need them).

## Assumptions

- Research assumptions accepted (develop = contract; no new response fields).
- `terminationFourDigits` declared `String` hydrates a stored int to its string, so GET returns `'123'` as develop
  did; the e2e int-digits case confirms it (if mongoose returns the number instead, the PUT echo still 400s, via
  `IsString`).
- Express non-strict routing makes `/account-actions/` match `/account-actions` (already true for `POST /auth/`).
- Atlas supports transactions; the owner's `.env` has a working `JWT_KEY`.

## Implementation checklist

- [x] Phase 1 — module (CLI, `AppModule` verified), entity, constants, create DTO, `findByUser`/`createAccount` + card checks + spec, controller (`account` → `account-actions`), e2e GET/POST
- [x] Phase 2 — interface + token + 0/0 default, update/delete DTOs, `updateAccount`, `deleteAccount` in a transaction + spec, PUT/DELETE routes, e2e cross-user/D17/old docs/port wiring
- [x] Phase 3 — `assertAccountOwned`, `incrementBalance` + spec + e2e; `REPO_CONTEXT.md`
- [x] Automatic: `pnpm run lint`, `pnpm run build`, `pnpm test`, `pnpm run test:e2e`
- [ ] Phase 3 manual run on the prod DB — orchestrator (steps 1–9) — **not run by the implementer** (no `.env`, no prod access); the same flow passed on `node dist/main.js` against a local in-memory replica set
