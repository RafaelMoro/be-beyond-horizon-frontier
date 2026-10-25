# Research: S5 — accounts (`accounts` collection, `/account-actions` CRUD, owner-bound balance helpers)

**Branch:** `feat/accounts` (stacked on `feat/categories`, PR #6) · **Date:** 2026-10-25 · **Type:** single story, full research

Sources: `~/projects/notes/budget-master/be-refactor.md` (S5, ground rules, D0/D2/D6/D17, E4 rows, Security findings
"High: record PUT repoints `account`"), `be-refactor-survey.md` §2.2/§4 Accounts, §5 #1/#9/#16/#17,
`be-refactor-survey-develop.md` §2.2/§2.3/§5/§6, `be-refactor-db-checks.md` §4–§5, `be-refactor-next-clients.md`,
`be-refactor-frontend-usage.md` rows 6–9, `memories/repo/categories-research.md`.
Legacy contract = `be-budgt-master` **`origin/develop`**: `src/repositories/accounts/**`,
`src/domain/user-accounts-actions/**`, and the cascade helpers in `src/domain/records/services/records.service.ts`,
`src/repositories/{expenses,incomes}/services/*.service.ts`. Live client = `old-next-budget-master@main` (2e02a8f, clone read only).

## Story

Port the per-user accounts: the `accounts` schema, the 4 `/account-actions` routes with develop's texts and statuses,
D17's new fields, and balance helpers for S7. Improve what clients can't see: owner-filtered writes, `$inc` balance
helpers that only touch the caller's account (audit High), a `{sub: 1}` index, and a delete cascade seam that S7 fills.

## Acceptance criteria

1. The 4 routes return the legacy status, envelope, `message` and `data` keys in the contract table below, including
   400 `'Account not found'`, 400 (PUT) / 401 (DELETE) `'Account does not belong to the user'`, the two develop
   service messages, and `data.{accountDeleted, numberExpensesDeleted, numberIncomesDeleted}`. `/account-actions/`
   (trailing slash, old-next) works the same.
2. D17: create requires `alias`; `accountProvider` and `terminationFourDigits` are optional on create and PUT and,
   when present, get develop's validators and messages; the schema marks none of the three required, so the 16 old
   accounts without them stay readable and editable. PUT can still set `amount`.
3. A foreign account is never written: PUT and DELETE on another user's id leave the document unchanged.
4. The account service exposes, for S7, an owned-account assertion (legacy 404/401) and an owner-bound `$inc` balance
   helper that both run inside a caller's session; the delete path calls a records-cascade seam that returns 0/0 until
   S7 implements it.
5. Unit tests (mocked model, stubbed cascade) for every service rule; e2e against the replica set for all 4 routes,
   including cross-user PUT/DELETE, D17 cases and the helpers' owner binding.

## Legacy contract (develop)

`@Controller('account-actions')`, JWT guard on all routes (legacy passport → our global guard). Responses are mongoose
docs (default `toJSON`: `_id`, `__v`, `sub` included). Constants (`src/repositories/accounts/constants/index.ts`):
`ACCOUNT_CREATED_MESSAGE 'Account created'`, `ACCOUNT_UPDATED_MESSAGE 'Account Updated'`, `ACCOUNT_DELETED_MESSAGE
'Account Deleted'`, `ACCOUNT_NOT_FOUND 'Account not found'`, `ACCOUNT_UNAUTHORIZED_ERROR 'Account does not belong to
the user'`. Service texts (inline in `accounts.service.ts`): `'Termination digits must be a 4-digit number (digits
only).'` (regex `/^[0-9]{4}$/`), `'Invalid account provider'` (exact, case-sensitive `visa|mastercard|american-express`).

| Method | Body (DTO) | Success | Errors (in order) |
|---|---|---|---|
| GET | – | 200 `message:null`, `data:{accounts:[full docs incl. sub, __v]}`; `find({sub})`, no projection, no sort; `[]` when none | 401 guard |
| POST | `CreateAccountDto`: `title`, `alias`, `accountType`, `accountProvider`, `terminationFourDigits`, `backgroundColor`, `color` all IsString+IsNotEmpty; `amount` IsNumber+IsNotEmpty | 201 `'Account created'`, `data:{account}` (saved doc, `sub` = `req.user.sub`) | 400 class-validator (`message: string[]`); then 400 digits text, then 400 provider text (strings) |
| PUT | `UpdateAccountDto` = `PartialType(Create)` + `accountId` IsMongoId+IsNotEmpty | 200 `'Account Updated'`, `data:{account}` (doc after `$set: changes`) | 400 validation; 400 `'Account not found'`; **400** `'Account does not belong to the user'` (401 re-wrapped, `accounts.-actions.service.ts:104-106`); then digits/provider 400s, each only when the field is truthy |
| DELETE | body `DeleteAccountDto`: `accountId` IsMongoId+IsNotEmpty | 200 `'Account Deleted'`, `data:{accountDeleted, numberExpensesDeleted, numberIncomesDeleted}` | 400 validation; 400 `'Account not found'`; **401** `'Account does not belong to the user'` (rethrown, :179) |

Ownership check (`validateAccountBelongsUser`): `findById` → missing 400, `String(account.sub) !== userId` → 401.
PUT runs it **before** the digits/provider checks. Delete order: ownership → find the user's expenses and incomes for
the account (`aggregate $match {userId, account: accountId}`, string match) → delete them one by one → delete the
account → counts = number of matched records. The cascade doesn't touch budgets, budget history, `isPaid` flags or
transfer counterparts.

For S7 (records), legacy `findAccountByIdForRecords` throws **404** `'Account not found'` / **401** `'Account does not
belong to the user'`; expense/income routes rethrow both, the transfer route wraps them in 400. Balance writes
(`modifyAccountBalance*`) read the balance, compute in JS and `$set` it, filtered by `_id` only (the audit's High finding).

Dead code not to port: `modifyAccountBalanceOnExpense/OnIncome` (read-modify-write), `modifyAccountBalance`
(`$set`), the unused Budgets/BudgetHistory imports in `UserActionsModule`, `card-provider.service.ts` as a separate file.

## Clients (what must not break)

- **old-next (live):** GET from server and browser (`src/shared/lib/dashboard.lib.ts:27`, `src/shared/utils/accounts.utils.ts:41`,
  Bearer), reads `data.accounts[]` `_id, title, amount, accountType, alias, terminationFourDigits, accountProvider`
  (all three treated as optional; provider defaults to `mastercard` in display). POST/PUT/DELETE go through its BFF
  (`src/app/api/accounts/route.ts:12,41,70`) to **`/account-actions/`** (trailing slash). Create sends
  `{title, alias: alias||title, accountType, accountProvider ∈ {mastercard,visa,american-express} (default mastercard),
  amount: number, terminationFourDigits: input || random 4-digit string, backgroundColor:'Dark Orange', color:'white'}`;
  edit sends the same + `accountId`; delete `{accountId}` as the DELETE body. Any non-2xx becomes BFF 400
  `{message: error.message}` (shown, not compared). No status code is branched on.
- **FE_Budget_Master (refactored next, D0):** PUT echoes the fetched doc's fields except `_id, __v, sub, amount`
  plus `accountId`, `amount`. So the PUT DTO must whitelist every non-meta field GET returns: today `title, alias,
  accountType, accountProvider, terminationFourDigits, backgroundColor, color, amount`. Adding a response field (e.g.
  timestamps) would 400 its PUT. Its create omits the D17 optional fields and `alias` (400 under D17 too; it adapts).

## Prod data (db-checks)

- `accounts`: 38 docs, **`sub` a string in all 38**, 8 owners, 1 orphan owner with 2 docs, only `_id_` index.
  22 docs have `alias` (develop's creates, newest 2026-10-05); 16 have none of the three new fields.
- Strings because legacy's `@Prop({type: Types.ObjectId})` became `Mixed` through `SchemaFactory` (S4 memory). So
  `sub` is declared `String` and queried with `req.user.sub` as is, like categories.
- Records' `account` is always a string (D2, 5,075 docs); the S7 cascade can match it as a string.

## Affected files and modules

- New module (name to confirm, Q1: `account`), controller path `account-actions`, entity pinned to
  `collection: 'accounts'`, model name `Account`, constants (legacy texts + provider list), DTOs, service + spec,
  registered in `src/app.module.ts`, exports the service (S7's record module imports it).
- A records-cascade port (interface + token, Q2) with a 0/0 default.
- `test/accounts.e2e-spec.ts` (new); `ai-skills/REPO_CONTEXT.md` (structure, route table, "does not exist yet" line).
- No change in `src/auth` or `src/user`. No `UserModule` import needed (the guard already proves the user exists).

## Existing patterns to follow

- `src/category/*` end to end: entity with `@Schema({ collection })`, default `__v`, no timestamps, `sub: String`,
  schema `{sub: 1}` index (test-only build; prod from S8's script); hand-written update DTO with `@IsOptional()`
  (`@nestjs/mapped-types` not installed); `$set` built from an allow-list that drops `null`/absent fields (never
  `accountId`/`sub`); `findOneAndUpdate`/`findOneAndDelete` with `{_id, sub}` and `returnDocument: 'after'`;
  `{ ...INITIAL_RESPONSE, message, data }`; `isValidObjectId` guard + `exists` in `assertCategoryOwned`.
- Ports: S2/S3's `FORGOT_PASSWORD_MAILER` (interface in the consumer's `*.interface.ts`, `Symbol` token in its
  `*.constants.ts`, injected with `@Inject`, unit tests `useValue` it, e2e spies on it via `app.get(token, {strict:false})`).
- Transactions: `@InjectConnection()` + `connection.transaction(fn)`, `{ session }` on every op, no side effects in
  `fn` (`IMPLEMENTATION_GUIDELINES.md` → Transactions).
- Errors: throw `BadRequestException`/`UnauthorizedException`/`NotFoundException` with the legacy text; never wrap
  caught messages; unexpected → 500 (D6). Global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`)
  matches legacy flags, so validation messages are class-validator's (e.g. `'alias should not be empty'`).
- Methods with more than 3 params take one destructured object.

## Decisions taken in research (from the given data)

- **`sub`:** `String`, stored as `req.user.sub`, queried as is.
- **Foreign update/delete statuses:** kept (plan says keep). Evidence it is safe either way: neither client reads the
  status (frontend-usage: "No branch depends on 400 vs 401 vs 404 vs 500"; old-next's BFF maps every error to 400).
  The cost is an existence oracle on someone else's ObjectId, which needs the id already; accepted.
- **Owner-bound writes:** the PUT/DELETE write itself filters `{_id, sub}`; telling "missing" from "foreign" needs a
  read of `_id` alone, used only to pick the message. Keep legacy precedence on PUT: not found → foreign → digits →
  provider.
- **D17 validation:** create `alias` IsString+IsNotEmpty (required); `accountProvider`, `terminationFourDigits`
  IsOptional+IsString+IsNotEmpty on create and PUT, service checks (digits first, then provider) only when present.
  A number `terminationFourDigits` fails `IsString` (develop). Schema: all three optional, no default.
- **`null` values:** `IsOptional` lets `null` through. Follow S4: present-and-non-null fields only are written, and
  the D17 checks skip `null`. Legacy would `$set` the null (PUT) or save it (create); no client sends null.
- **`amount` on PUT:** written directly (`$set`), contract. It can overwrite a concurrent S7 `$inc`; accepted (legacy).
- **Balance helpers (for S7, signatures only):**
  - `assertAccountOwned({ accountId, sub, session? }): Promise<void>`: 404 `'Account not found'` (also for a
    non-ObjectId id), 401 `'Account does not belong to the user'` (legacy `findAccountByIdForRecords`; S7 wraps the
    transfer case in 400 itself).
  - `incrementBalance({ accountId, sub, delta, session }): Promise<AccountDoc>`: one `findOneAndUpdate({_id, sub},
    {$inc: {amount: delta}}, {session})`; no match → throw 404 `'Account not found'` so the transaction aborts. S7
    passes `-amount` (expense create), `+amount` (income create), `previous - new` (expense edit), etc.
- **Delete cascade:** S5 has no records collections, so the cascade is a port called inside the delete with the
  session, returning `{ numberExpensesDeleted, numberIncomesDeleted }`; S5's default returns `0/0`. S7 implements it
  (`deleteMany({userId: sub, account: accountId}, {session})` on `createexpenses`/`createincomes`; legacy counts
  matched records). See Q2/Q3.

## Edge cases and constraints

- **Module cycle:** S7's record module imports this module (helpers). If the cascade implementation lives in the
  record module, this module can't import it back; S7 must provide the token without `AccountModule → RecordModule`
  (e.g. a provider that only needs the record models, or `forwardRef`). Planning/S7 picks; S5 just must not hardwire it.
- PUT with only `accountId` → 200 with the doc unchanged (as categories). `accountId` and `sub` are never persisted;
  `sub` in the body → 400 (whitelist).
- `/account-actions/` with a trailing slash must route like `/account-actions` (login's `auth/` already does).
- `amount` is IsNumber only: negatives, `0` and floats pass; strings fail (no implicit conversion), `NaN`/`Infinity`
  can't arrive in JSON.
- `$inc` adds the delta to the stored double; legacy computed `current + previous - new` in JS. S7's characterization
  tests may see a last-digit float difference on fractional amounts.
- Old accounts without the D17 fields: GET returns them without the keys; PUT works (no schema validators on
  `findOneAndUpdate`). Never `save()`/`validate()` a loaded doc expecting them.
- The orphan owner's 2 accounts stay; the guard blocks deleted users; S8's user-delete cascade removes them by
  string `sub`.
- Delete leaves budgets, budget history, `isPaid` flags and transfer counterparts as they are (legacy; S7/S8 scope).
- E2E is on a replica set; await `model.init()` before the first transaction (S4 memory).

## Open questions

- **Q1 — module name.** Recommendation: `account` (singular, guideline example); route stays `/account-actions`,
  collection `accounts`, model `Account`.
- **Q2 — cascade seam.** Recommendation: a port (interface + `Symbol` token, mailer pattern) with a 0/0 default
  provided by this module; unit tests stub it with non-zero counts to cover the response; S7 swaps the provider.
  Alternative: hardcode `0/0` and let S7 edit the service (less code now, but AC2's "test stub" has nothing to stub).
- **Q3 — transaction around delete now.** Recommendation: yes: ownership read, cascade port call and account delete
  in one `connection.transaction`, session passed to the port, so S7 only adds the implementation. Cost now: one
  transaction per delete on a single doc.
- **Q4 — `null` handling** (above). Recommendation: drop `null` like S4 (no write, no D17 check). Alternative: reject
  `null` with a 400 (changes no client either).

## Assumptions

- Contract is develop; D17 overrides develop only on required-ness of `accountProvider`/`terminationFourDigits`
  (create) and the schema's `required`.
- The 22 accounts with `alias` also have `accountProvider`/`terminationFourDigits` (db-checks counted only `alias`);
  `amount` is numeric in all 38 (not checked).
- FE_Budget_Master's PUT echo comes from `be-refactor-frontend-usage.md`; its source wasn't re-read.
- No new fields in account responses (no timestamps), so FE_Budget_Master's echo keeps passing the whitelist.
