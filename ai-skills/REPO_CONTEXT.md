# Repository Context - be-beyond-horizon-frontier

**Last Updated:** 2026-10-25

Architecture and conventions for the be-beyond-horizon-frontier NestJS backend.

> Sections marked _(planned)_ describe intended conventions, not existing code. Update this document as modules land.

## Overview

Backend for Budget Master. Today it has the S1 foundation (config, Mongo connection, response envelope, global error filters, validation, CORS, cookies, e2e harness), `GET /` returning `Hello World!`, S2 auth + users (`user` and `auth` modules: signup, login cookie, global JWT guard, profile update/delete, forgot/reset password), S3 mail (`mail` module: the forgot-password email via Resend), S4 categories (`category` module: per-user categories, owner-filtered update/delete, default seeding in a transaction) and S5 accounts (`account` module: `/account-actions` CRUD, owner-bound writes, delete in a transaction behind a records-cascade port, balance helpers for S7) and S6 budgets (`budget` module: `/budgets` and `/budget-history`, create/delete with the history doc in one transaction, a `linkedBudgets` unlink port, amount/record helpers for S7) and S7a records-expenses (`record` module: `/expenses-actions` create/edit/delete with balance and linked-budget effects in one transaction each, the monthly expenses listing, and the real `BUDGET_EXPENSES_UNLINK` port) and S7b records-incomes (`/incomes-actions` create/edit/delete with balance and owner-filtered `expensesPaid` paid-flag effects in one transaction each, and the real `ACCOUNT_RECORDS_CASCADE` port) and S7c records-transfers-listing (`POST /records/transfer`: both sides, both balances and the income side's paid flags in one transaction; `GET /records/expenses-and-incomes` merged monthly listing; no transfer edit/delete route, each side goes through its own route, D9) and S8a hardening-code (`DELETE /users` cascades to every owned collection in one transaction, helmet defaults, Mongo-backed rate limits on login and forgot-password: `rate-limit` module) and S8b hardening-scripts (operator scripts in `src/scripts/`: the prod index script and the data-repair report + `--apply` fix).

_(planned)_ It is the rewrite of the legacy backend `be-budgt-master` (sibling checkout `../be-budgt-master`) (MongoDB/mongoose, JWT cookie auth, AWS Lambda). The existing frontend's HTTP contract must keep working — no breaking API changes. The plan and progress live outside this repo, in `~/projects/notes/budget-master/be-refactor.md` (local notes, not in this repo).

**Tech Stack:**

- NestJS 12 (`@nestjs/core` 12.2), Express platform (`@nestjs/platform-express`)
- `@nestjs/config` 12 + Joi 18 (env validation), `@nestjs/mongoose` 12 + mongoose 9, class-validator / class-transformer, cookie-parser
- `@nestjs/jwt` 12 (jsonwebtoken, HS256), `bcryptjs` 3 (cost 10). No passport.
- `helmet` 8 (defaults). No `@nestjs/throttler`: rate limits are the own `rate-limit` module.
- `resend` 6 (mail), `@react-email/components` 1 + `react` 19 (templates rendered to HTML), all exact-pinned (the template snapshot depends on the renderer)
- TypeScript 6, ESM (`"type": "module"`, `module`/`moduleResolution: nodenext`, `strict: true`, `jsx: react-jsx` for the `.tsx` mail templates under `src/mail/templates`)
- pnpm (`pnpm-lock.yaml`; CI pins pnpm 10, Node 22)
- Vitest 4 (unit + e2e), supertest for e2e
- oxlint (lint), Prettier (format)

## Current Structure

```
src/
├── main.ts                 # bootstrap: configureApp + enableShutdownHooks; listens on process.env.PORT ?? 3000
├── configure-app.ts        # configureApp(app): helmet (first, defaults), cookie-parser, ValidationPipe, filters, CORS (shared with e2e)
├── app.module.ts           # root module: ConfigModule + MongooseModule.forRootAsync, AppController + AppService
├── config.ts               # envSchema (Joi), buildMongoUri, registerAs('config') typed config
├── mongoose-options.ts     # mongooseOptions factory + assertTestMongoUri (prod-DB guard)
├── constants.ts            # VERSION_RESPONSE (from package.json), INITIAL_RESPONSE envelope
├── response.interface.ts   # GeneralResponse
├── exceptions/
│   ├── http-exception.filter.ts  # GeneralAppExceptionFilter (@Catch(HttpException))
│   └── catch-all.filter.ts       # CatchAllExceptionFilter (@Catch())
├── app.controller.ts       # GET / (@Public)
├── auth/
│   ├── auth.module.ts      # JwtModule (JWT_KEY, 5d) + APP_GUARD JwtAuthGuard; imports UserModule, RateLimitModule
│   ├── auth.constants.ts   # cookie name/max-age, IS_PUBLIC_KEY, LOGIN_ERROR, DUMMY_PASSWORD_HASH
│   ├── auth.interface.ts   # JwtPayload, AuthenticatedRequest, LoginBody (interface on purpose)
│   ├── auth.utils.ts       # extractToken: accessToken cookie first, else Authorization: Bearer
│   ├── decorators/public.decorator.ts
│   ├── guards/jwt-auth.guard.ts (+ .spec)
│   ├── services/auth.service.ts (+ .spec)   # login (rate-limited per email, after the missing-field check)
│   └── controllers/auth.controller.ts       # POST /auth, sets the cookie
├── user/
│   ├── user.module.ts      # forFeature(User + the six owned schemas, only for the delete cascade: importing their modules would be a cycle), JwtModule (ONE_TIME_JWT_KEY, 1d); imports MailModule (FORGOT_PASSWORD_MAILER), RateLimitModule
│   ├── user.constants.ts   # legacy texts, BCRYPT_COST, FORGOT_PASSWORD_MAILER token
│   ├── user.interface.ts   # ForgotPasswordMail / ForgotPasswordMailer (mail port, implemented by mail/)
│   ├── user.utils.ts       # hashToken (sha256 hex)
│   ├── entities/user.entity.ts       # collection `users`
│   ├── dtos/user.dto.ts, user-responses.dto.ts
│   ├── services/user.service.ts (+ .spec)   # deleteUser cascade (transaction), forgotPassword (rate-limited per email + IP)
│   └── controllers/user.controller.ts       # /users routes
├── mail/
│   ├── mail.module.ts      # MailService + FORGOT_PASSWORD_MAILER (useExisting: MailService), exports the token
│   ├── mail.constants.ts   # FORGOT_PASSWORD_SUBJECT (legacy), MAIL_SEND_TIMEOUT_MS (5000)
│   ├── services/mail.service.ts (+ .spec)   # Resend send; null client (warn, no send) when a mail key is blank
│   └── templates/reset-password.tsx (+ .spec, __snapshots__)  # legacy ResetPassword port + renderResetPassword()
├── category/
│   ├── category.module.ts  # forFeature(Category); imports UserModule (create-local user check); exports CategoryService
│   ├── category.constants.ts # legacy texts + ALL_LOCAL_CATEGORIES (the 12 defaults, verbatim)
│   ├── entities/category.entity.ts   # collection `categories`, `sub` is a string, index { sub: 1 }
│   ├── dtos/category.dto.ts
│   ├── services/category.service.ts (+ .spec)  # CRUD by owner, createLocalCategories (transaction), assertCategoryOwned (S7)
│   └── controllers/category.controller.ts      # /categories routes
├── account/
│   ├── account.module.ts   # forFeature(Account); exports AccountService (ACCOUNT_RECORDS_CASCADE comes from the global RecordModule)
│   ├── account.constants.ts # legacy texts, CARD_PROVIDERS, TERMINATION_DIGITS_REGEX, ACCOUNT_RECORDS_CASCADE token
│   ├── account.interface.ts # AccountRecordsCascade (records-cascade port, implemented by S7)
│   ├── entities/account.entity.ts    # collection `accounts`, `sub` is a string, index { sub: 1 }; alias/card fields optional (D17)
│   ├── dtos/account.dto.ts
│   ├── services/account.service.ts (+ .spec)  # CRUD by owner, card checks, delete in a transaction, assertAccountOwned + incrementBalance (S7)
│   └── controllers/account.controller.ts      # /account-actions routes
├── budget/
│   ├── budget.module.ts    # forFeature(Budget, BudgetHistory); exports both services (BUDGET_EXPENSES_UNLINK comes from the global RecordModule)
│   ├── budget.constants.ts # legacy texts, BUDGET_EXPENSES_UNLINK token
│   ├── budget.interface.ts # BudgetExpensesUnlink (linkedBudgets pull on budget delete, implemented by S7)
│   ├── entities/budget.entity.ts          # collection `budgetmodels`, `sub` string, index { sub: 1 }; toJSON maps legacy nestResetDate → nextResetDate (D8)
│   ├── entities/budget-history.entity.ts  # collection `budgethistorymodels`, `budget` ObjectId ref, unique index { budget: 1, sub: 1 }
│   ├── dtos/budget.dto.ts, dtos/budget-history.dto.ts
│   ├── services/budget.service.ts (+ .spec)          # budget CRUD, create/delete transactions, incrementBudgetAmount (S7)
│   ├── services/budget-history.service.ts (+ .spec)  # history CRUD, owner check on POST, addHistoryRecord / removeHistoryRecord (S7)
│   └── controllers/budget.controller.ts, controllers/budget-history.controller.ts  # /budgets, /budget-history
├── record/
│   ├── record.module.ts    # @Global; forFeature(Expense, Income); imports Account/Budget/CategoryModule; provides RecordService and the 3 controllers; provides + exports BUDGET_EXPENSES_UNLINK and ACCOUNT_RECORDS_CASCADE (both useExisting: RecordPortsService)
│   ├── record.constants.ts # legacy texts (expenses, incomes, /records listing and transfer, transferMismatch(field)), RECORD_UPDATABLE_FIELDS (shared PUT $set list), MAX_LINKED_BUDGETS, months/weekdays, CATEGORY_POPULATE, EXPENSES_PAID_POPULATE
│   ├── record.interface.ts # ExpenseMutationResult, IncomeMutationResult, TransferMutationResult
│   ├── record.utils.ts (+ .spec)  # toMexicoCityWallClock (Intl, TZ-independent), formatDateToString, formatNumberToCurrency, getMonthBounds, toExpenseIds (expensesPaid ids/objects → deduped ids, null on anything else)
│   ├── entities/record.entity.ts   # AccountRecord base (no schema): category Mixed + ref, account String, indebtedPeople subdocs
│   ├── entities/expense.entity.ts  # collection `createexpenses`, isPaid, linkedBudgets ObjectId[] (no default); index { userId, account, date: -1 }
│   ├── entities/income.entity.ts   # collection `createincomes`, expensesPaid ObjectId[] (ref Expense), no isPaid; same index
│   ├── dtos/record.dto.ts, dtos/expense.dto.ts, dtos/income.dto.ts, dtos/transfer.dto.ts (CreateTransferDto: nested expense + income)
│   ├── services/expense.service.ts (+ .spec)       # listing, create/update/delete in transactions, budget add/remove helpers
│   ├── services/income.service.ts (+ .spec)        # create/update/delete in transactions, owner-filtered paid-flag helpers (ownedExpenseIds + payExpenses public, reused by RecordService)
│   ├── services/record.service.ts (+ .spec)        # /records: merged listing, createTransfer (develop's validation order, category/account 404/401 → 400)
│   ├── services/record-ports.service.ts (+ .spec)  # BUDGET_EXPENSES_UNLINK + ACCOUNT_RECORDS_CASCADE impls; depends only on record models (no cycle)
│   ├── controllers/expense.controller.ts           # /expenses-actions routes
│   ├── controllers/income.controller.ts            # /incomes-actions routes
│   └── controllers/record.controller.ts            # /records routes
├── rate-limit/
│   ├── rate-limit.module.ts    # forFeature(RateLimit); exports RateLimitService; imported by AuthModule and UserModule
│   ├── rate-limit.constants.ts # RATE_LIMITS (login 10/15 min, forgotPasswordEmail 3/h, forgotPasswordIp 10/h), TOO_MANY_REQUESTS
│   ├── entities/rate-limit.entity.ts   # collection `ratelimits`: _id `scope:sha256(trim+lowercase value):bucket`, count, expiresAt (TTL index)
│   └── services/rate-limit.service.ts (+ .spec)  # consume(hits): $inc upsert per key (fixed window), 429 if any key is over
├── scripts/                # operator scripts (S8b), built to dist/scripts/; NOT imported by the app
│   ├── script-runner.ts (+ .spec)  # parseScriptArgs (strict: --apply, --db, --r4-map), assertApplyTarget, createScriptContext (AppModule app context), runScript (target line, guard, exit code)
│   ├── db-indexes.ts (+ .spec), db-indexes.cli.ts    # createMissingIndexes: diffIndexes + createIndexes only, never drops
│   └── data-repair.ts (+ .spec), data-repair.cli.ts  # loadSnapshot / classify (R1–R8) / printCases / loadR4Map / repairData (one transaction per case)
├── app.controller.spec.ts
└── app.service.ts
test/
├── global-setup.ts         # MONGO_TEST_URI or MongoMemoryReplSet → provide('mongoUri')
├── setup-env.ts            # overwrites process.env for e2e; E2E_DB_NAME
├── create-test-app.ts      # createTestApp / closeTestApp
├── app.e2e-spec.ts
├── auth-users.e2e-spec.ts
├── categories.e2e-spec.ts
├── accounts.e2e-spec.ts
├── budgets.e2e-spec.ts
├── records-expenses.e2e-spec.ts
├── records-incomes.e2e-spec.ts
├── records-transfers.e2e-spec.ts
├── user-delete.e2e-spec.ts
├── rate-limit.e2e-spec.ts
└── db-scripts.e2e-spec.ts  # index script + data repair against the local replica set
.env.example                # every S1 key, documented
.gitleaksignore             # known gitleaks false positives (by fingerprint)
vitest.config.ts            # unit: **/*.spec.ts
vitest.config.e2e.ts        # e2e: **/*.e2e-spec.ts, globalSetup + setupFiles, no file parallelism
oxlint.json                 # no-explicit-any off, no-floating-promises warn
```

Does **not** exist yet — don't assume it: authorization/roles, logout or `/me`, interceptors, a custom logger, request ids, `/health`, `trust proxy` (S9), OpenAPI docs, path aliases (`tsconfig.json` has no `paths`).

## Config

- `src/config.ts`. `ConfigModule.forRoot({ envFilePath: '.env', load: [config], isGlobal: true, validationSchema: envSchema })` in `AppModule`. Missing/invalid keys fail at startup with `Config validation error`.
- Keys (legacy names): `MONGO_URI` **or** `MONGO_CONNECTION` + `MONGO_USER` + `MONGO_PWD` + `MONGO_HOST` (full host); `MONGO_DB_NAME`; `FRONTEND_URI`, `TEST_FRONTEND_URI`, `DOMAIN_URI`; `NODE_ENV`; `JWT_KEY` (access token, 5d), `ONE_TIME_JWT_KEY` (reset token, 1d); `RESEND_API_KEY`, `MAILER_MAIL` (Resend sender, `Name <addr>` allowed): optional and blank-able unless `NODE_ENV=production`, where both are required and non-empty — if either is blank, forgot-password logs a fixed warn and sends nothing (tests blank both in `test/setup-env.ts`); optional `PORT`. `PUBLIC_KEY` is no longer read. Unknown keys are allowed. Later stories add their keys to `envSchema`, the `registerAs` object and `.env.example`.
- Read config by injecting `@Inject(config.KEY) c: ConfigType<typeof config>` (or `app.get(config.KEY)`), never `process.env` in services.
- The owner's `.env` points at the **prod** DB (local dev uses prod data). Tests never read it for Mongo.
- CORS origins are the three `*_URI` keys: scheme required, no trailing slash (CORS matches exactly).

## Database

- Connection in `AppModule`: `MongooseModule.forRootAsync({ inject: [config.KEY], useFactory: mongooseOptions })`. No separate `DatabaseModule` (`MongooseCoreModule` is global).
- `mongooseOptions`: `serverSelectionTimeoutMS: 5000`, `retryAttempts` 0 under test / 2 otherwise, `retryDelay: 1000`, `autoIndex` only when `NODE_ENV=test` (prod indexes come from `node dist/scripts/db-indexes.cli.js`, never `syncIndexes`; prod's undeclared `date_1` / `userId_1` on `createexpenses` are kept on purpose).
- Multi-document writes use `connection.transaction` (no custom wrapper; rules in `IMPLEMENTATION_GUIDELINES.md` → Database → Transactions). First use: `createLocalCategories`.
- `ratelimits`: one doc per key and fixed window (`_id` = `scope:sha256(trim+lowercase value):bucket`, `count`, `expiresAt` = window end); no email or IP in clear. Correctness doesn't depend on the TTL index `{ expiresAt: 1 }, expireAfterSeconds: 0` (built only under test until the owner runs the index script with `--apply`). In prod the collection appears on the first login from `start:dev` (D16).
- Prod-DB guard: whenever `VITEST` is set or `NODE_ENV=test`, `assertTestMongoUri` requires `mongodb://` and every host in `localhost` / `127.0.0.1` / `[::1]`.

## Operator scripts

Owner only, with his `.env` (prod), from the repo root, after `pnpm run build`. Never CI, never at boot. They boot `AppModule` as an application context (same config validation, `mongooseOptions`, models; no HTTP). First line: `target: <host> db=<name> mode=<dry-run|apply>`; `--apply` also needs `--db=<that name>`. Use `node …` directly: no `pnpm run … --` (the strict parser rejects a stray `--`).

1. `node dist/scripts/db-indexes.cli.js` (dry-run: missing indexes, extras listed as kept), then `… --apply --db=<name>`. An E11000 / options conflict is reported per collection (`NOT created`), exit 1.
2. `node dist/scripts/data-repair.cli.js`: read-only report, R1–R8 counts and `_id`s. For R4, write `{ "<recordId>": "<categoryId>" }` to a file **outside the repo** (ids only) and pass `--r4-map=<path>`.
3. Recommended: an Atlas snapshot / `mongodump` first. Then `node dist/scripts/data-repair.cli.js --apply --db=<name> [--r4-map=<path>]`: R1 `$unset`, R2 repoint to the owner's single same-name category, R4 per map, R5 / R7 delete, R6 `$pull`, R8 delete unreferenced orphans (last); each case re-detected and fixed in its own transaction, a failed case stops the run. No balance / budget / history / `expensesPaid` / transfer-pair adjustment.
4. Re-run the report: R1, matched R2, mapped R4, R5, R6, R7 and unreferenced R8 are 0; R3, unmatched R2, unmapped R4 and referenced R8 remain by decision.

Output is ids only (Q11: no names, emails, amounts, card digits): don't paste it into the repo or the notes. `dist/scripts` lands in S9's Lambda bundle (inert; S9 may exclude it).

## Response envelope

- Success responses spread `INITIAL_RESPONSE` per route: `{ ...INITIAL_RESPONSE, data }` → `{ version, success, message, data, error }`. `version` is package.json's version. No response interceptor. `message` is `string | string[] | null` (`GeneralResponse`): the record mutations return a `string[]` step log (D10).
- `GET /` is excluded: it returns plain `Hello World!` (`text/html`).

## Error filters

Registered in `configureApp` as `useGlobalFilters(new CatchAllExceptionFilter(), new GeneralAppExceptionFilter())`. Nest reverses global filters, so this order makes `HttpException`s hit `GeneralAppExceptionFilter` and everything else the catch-all. Both answer inside the envelope (`success: false`, `data: null`, `message: null`).

| Error | Status | `error` |
|---|---|---|
| `HttpException` (incl. ValidationPipe, 404, invalid JSON) | its status | `exception.getResponse()` (legacy `{ message, error, statusCode }`) |
| mongoose `CastError` | 400 | `{ message: 'Invalid <path>', error: 'Bad Request', statusCode: 400 }` |
| `BSONError` (bad ObjectId) | 400 | `{ message: 'Invalid id', … }` |
| mongoose `ValidationError` | 400 | `{ message: [validator messages], … }` |
| `code === 11000` | 409 | `{ message: 'Duplicate value', error: 'Conflict', statusCode: 409 }` |
| exposed `http-errors` (e.g. 413) | its status | `{ statusCode, message }` |
| anything else | 500 | `{ statusCode: 500, message: 'Internal server error' }` |

Logging rule: method + route pattern (`req.route?.path`) + status (+ stack where safe). Never the URL, body, cookies, `Authorization`, `keyValue` or emails. 4xx `HttpException`s and exposed http-errors are not logged; 5xx and unknown errors are logged as `error`, Mongo mappings as `warn`.

## E2E harness

- `createTestApp({ controllers? })` builds `AppModule` (+ optional test-only controllers), runs `configureApp`, `init()`. It calls `assertTestMongoUri` before compiling.
- `closeTestApp(app)` (any `INestApplicationContext`, also the scripts' `createScriptContext()`) drops the DB only if its name is `budget-master-e2e`, then closes the app.
- `test/global-setup.ts` uses `MONGO_TEST_URI` (CI: docker replica set) or starts a `MongoMemoryReplSet` locally; `test/setup-env.ts` overwrites `process.env` so `.env` never decides the target.

## Controllers and API Routes

Every route goes through the global `JwtAuthGuard` unless marked `@Public()`.

| Controller       | Route                                      | Guard  | Purpose |
| ---------------- | ------------------------------------------ | ------ | ------- |
| `AppController`  | `GET /`                                    | public | Starter route, returns `Hello World!` (`text/html`, no envelope) |
| `AuthController` | `POST /auth`                               | public | Login. Raw body `{email, password}` (no DTO); 201 `data.user`; `accessToken` cookie (bare JWT, first and only `Set-Cookie`, `HttpOnly; Secure; SameSite=Strict`, 5d). Bad creds 401 `'Email or Password incorrect.'`, missing 401 `'Unauthorized'` (not counted). Over 10 attempts / 15 min per email (trim + lowercase, every attempt counted, known = unknown) → 429 `'Too Many Requests'` in the envelope, no cookie, no `Retry-After` / `X-RateLimit-*` |
| `UserController` | `POST /users`                              | public | Signup, 201 `'User created'` `data.userCreated {email, sub}`; dup 400 `'Try with other email.'` |
| `UserController` | `PUT /users`                               | JWT    | Profile names; `email` required and equal to the stored one; `password` → 400 |
| `UserController` | `DELETE /users`                            | JWT    | Deletes the user and their categories, accounts, budgets, budget histories, expenses and incomes in one transaction; 200 `'User deleted.'` `data.userDeleted {email, firstName, lastName}` |
| `UserController` | `POST /users/forgot-password`              | public | Always 201 `'Email Sent'`; stores sha256 of a one-time JWT, raw token only to the mailer port. Known email: awaits the Resend send (5 s timeout) of `${FRONTEND_URI}/reset-password/<token>`; a failed send is logged (`error.name`/`statusCode` only) and still 201. Counted after the DTO pipe: over 3 / h per email or 10 / h per IP (`req.ip`) → 429 `'Too Many Requests'` (no lookup, no send) |
| `UserController` | `POST /users/reset-password/:oneTimeToken` | public | 201 `'Reset Password Successfully'`; jsonwebtoken errors → 400 with their message; sets `passwordChangedAt` |
| `CategoryController` | `GET /categories`                      | JWT    | 200 `data.categories` (the user's docs without `sub`; `message: null`) |
| `CategoryController` | `POST /categories`                     | JWT    | Body `{categoryName, subCategories, icon}`; 201 `'New category created'` `data.category` (incl. `sub`, `__v`) |
| `CategoryController` | `PUT /categories`                      | JWT    | Body `{categoryId, categoryName?, subCategories?, icon?}`; 200 `data.category`; not owned/missing → 400 `'Category not found'` |
| `CategoryController` | `DELETE /categories`                   | JWT    | Body `{categoryId}`; 200 `'Category deleted'` `data.category`; not owned/missing → 400 `'Category not found'`. Records are left as they are |
| `CategoryController` | `POST /categories/create-local-categories` | public | Body `{sub}`; seeds the 12 defaults in a transaction for an existing user with no categories, stored `sub` = the user's id; 201 `'New category created'` `data.categories`. Unknown user or already has categories → 400 `'Local categories already exists'` |
| `AccountController` | `GET /account-actions`                 | JWT    | 200 `data.accounts` (the user's full docs incl. `sub`, `__v`; `message: null`) |
| `AccountController` | `POST /account-actions`                | JWT    | Body `{title, alias, accountType, amount, backgroundColor, color, accountProvider?, terminationFourDigits?}`; 201 `'Account created'` `data.account`. Bad digits → 400 `'Termination digits must be a 4-digit number (digits only).'` (checked first), bad provider → 400 `'Invalid account provider'` |
| `AccountController` | `PUT /account-actions`                 | JWT    | Body `{accountId, …any create field}`; 200 `'Account Updated'` `data.account`. Missing → 400 `'Account not found'`, foreign → **400** `'Account does not belong to the user'` (both before the card checks) |
| `AccountController` | `DELETE /account-actions`              | JWT    | Body `{accountId}`; 200 `'Account Deleted'` `data { accountDeleted, numberExpensesDeleted, numberIncomesDeleted }`. Missing → 400 `'Account not found'`, foreign → **401** `'Account does not belong to the user'`. Runs in a transaction; records cascade via the `ACCOUNT_RECORDS_CASCADE` port: deletes the owner's expenses and incomes on that account string, real counts |
| `BudgetController` | `POST /budgets`                        | JWT    | Body: all 11 fields `{name, description, typeBudget, startDate, endDate, currentAmount, limit, period, isActive, nextResetDate, previousPeriods}`; 201 `'New budget created'` `data { budget, budgetHistory }` (both incl. `sub`; history `records: []`). One transaction |
| `BudgetController` | `GET /budgets`                         | JWT    | 200 `data.budgets` (without `sub`). Empty → **200** `message: 'Budgets not found'`, `data: null` |
| `BudgetController` | `GET /budgets/:budgetId`               | JWT    | 200 `data.budget` (incl. `sub`). Missing/foreign → **200** `'Budget not found'`, `data: null`; non-ObjectId → 400 `'Invalid _id'` |
| `BudgetController` | `PUT /budgets`                         | JWT    | Body `{budgetId, …any create field}`; 200 **`'Budget history updated'`** (sic, develop) `data.budget`. Missing/foreign → 404 `'Budget not found'` |
| `BudgetController` | `DELETE /budgets`                      | JWT    | Body `{budgetId}`; 200 `'Budget deleted'` `data { budget, budgetHistoryDeleted }`. Missing/foreign → 404 `'Budget not found'`. One transaction with the `BUDGET_EXPENSES_UNLINK` port (pulls the budget from the owner's expenses' `linkedBudgets`) and the history delete; a missing history still commits the budget delete, then 404 `'Budget history not found'` (E6.Q6) |
| `BudgetHistoryController` | `POST /budget-history`          | JWT    | Body `{budget, records}`; 201 `'New budget history created'` `data.budgetHistory`. Missing/foreign/non-ObjectId budget → 404 `'Budget not found'` (no write); duplicate `{budget, sub}` → 409 `'Duplicate value'` (only where the unique index exists) |
| `BudgetHistoryController` | `POST /budget-history/add-record` | JWT  | Body `{budgetId, record}`; 201 `'Record added to budget history'` `data.budgetHistory` (`$push`). No owned history → **400** `'Budget history not found'` |
| `BudgetHistoryController` | `POST /budget-history/delete-record` | JWT | Body `{budgetId, record: <recordId, ObjectId>}`; 201 `'Record removed from budget history'` (`$pull`; unknown id → unchanged). No owned history → **400** `'Budget history not found'` |
| `BudgetHistoryController` | `GET /budget-history`           | JWT    | 200 `data.budgetsHistory` (without `sub`, `budget` populated). Empty → **404** `'Budget history not found'` |
| `BudgetHistoryController` | `GET /budget-history/:budgetHistoryId` | JWT | 200 `data.budgetHistory` (populated; D13). Missing/foreign → 404 `'Budget history not found'`; non-ObjectId → 400 `'Invalid _id'` |
| `BudgetHistoryController` | `PUT /budget-history`           | JWT    | Body `{budgetHistoryId, records?, budget?}`; 200 `'Budget history updated'`; replaces `records`, ignores `budget`. Missing/foreign → 404 |
| `BudgetHistoryController` | `DELETE /budget-history`        | JWT    | Body `{budgetHistoryId}`; 200 `'Budget history deleted'` `data.budgetHistory`. Missing/foreign → 404 |

| `ExpenseController` | `GET /expenses-actions/:accountId/:month/:year` | JWT | 200 `data.expenses` (owner's `typeOfRecord:'expense'` records on that account string, UTC month bounds, unsorted, lean: stored keys only; `category` → `{_id, categoryName, icon}`, `linkedBudgets` → full budget docs), `message: null`. Empty, or month not `Jan`..`Dec` / year not 4 digits → 200 `'Expenses not found.'` `data.expenses: []` |
| `ExpenseController` | `POST /expenses-actions`                | JWT    | Create; 201 `message: string[]`, `data.expense` (category + linkedBudgets populated). Date stored as Mexico City wall clock. 400 transfer+budgets / `'Invalid type of record'` / max 3 budgets; category 404; account 404/401; missing/foreign budget 400 `'Budget history not found'`. One transaction: balance `−amount`, each budget `+amount` + history entry |
| `ExpenseController` | `PUT /expenses-actions`                 | JWT    | Body `{recordId, …}`; 200 `data.expense` (only category populated). 400 missing date/category/amount(0)/linkedBudgets; 404 `'Expense not found.'`; 401 `'This expense does not belongs to the user'`. Q9: category/account/added budgets checked only when changed. Balance and budgets per research §5.1/§5.2 (bug 8 fixed); a stored foreign account + amount/account change → 404 |
| `ExpenseController` | `DELETE /expenses-actions`              | JWT    | Body `{recordId}`; 200 raw deleted doc. 404/401 as PUT; missing/foreign account → 404, record kept (Q10); stale budget links skipped |
| `IncomeController` | `POST /incomes-actions`                 | JWT    | Create; 201 `message: string[]`, `data.income` unpopulated. Date stored as Mexico City wall clock. 400 `'Invalid type of record'` (not `income`), malformed `expensesPaid` element → 400 `INVALID_EXPENSES_PAID` (before any write); category 404; account 404/401. `expensesPaid` takes ids or expense objects; only the caller's existing expenses are stored and set `isPaid: true` (others counted as failed). One transaction: balance `+amount` |
| `IncomeController` | `PUT /incomes-actions`                  | JWT    | Body `{recordId, …, expensesPaid?}`; 200 `data.income` (`expensesPaid` → `_id shortName amountFormatted fullDate formattedTime`, category populated). 400 missing date/category/amount(0); 404 `'Expense not found.'` (sic); 401 `"You're unauthorized to see these incomes."`. Q9 ownership checks only on change; balance `+new − old`, account move `−old`/`+new`. With `expensesPaid`: removed unpaid, added paid, kept untouched (bug 7); without it nothing changes (Q8) |
| `IncomeController` | `DELETE /incomes-actions`               | JWT    | Body `{recordId}`; 200 raw deleted doc. 404 `'Income not found.'`, 401 `'This income does not belongs to the user'`; missing/foreign account → 404, income kept (Q10). Balance `−amount`, the owner's stored `expensesPaid` set `isPaid: false` |
| `RecordController` | `GET /records/expenses-and-incomes/:accountId/:month/:year` | JWT | 200 `data.records`: the owner's expenses and incomes (transfers included, no `typeOfRecord` filter) on that account string, UTC month bounds, lean (stored keys only: the client tells the kind by `isPaid` / `expensesPaid`), merged date desc (stable: expenses first on ties); expenses populate `category` + `linkedBudgets`, incomes `expensesPaid` + `category`. `message`: `null` (both), `'No expenses found.'` (only incomes), `'No incomes found.'` (only expenses). None, or month not `Jan`..`Dec` / year not 4 digits → 200 `'No incomes or expenses found.'` `data: null` |
| `RecordController` | `POST /records/transfer`                | JWT    | Body `{expense: CreateExpenseDto, income: CreateIncomeDto}`; 201 `message: string[]`, `data { expense, income }` unpopulated, cross-linked `transferRecord {transferId, account}` (a body one is overwritten), same Mexico City wall-clock date. Every contract error → 400 with develop's text, before any write: `'Invalid type of record'`, unpaid expense, linked budgets, same account, then short name/amounts/dates/category/subCategory mismatch, malformed `expensesPaid`; category/account 404/401 → 400 same text. Unexpected → 500 (D6). One transaction: expense account `−amount`, income account `+amount`, owned `expensesPaid` set paid. No transfer PUT/DELETE: each side uses its own route (D9) |

`BUDGET_EXPENSES_UNLINK` is provided by the global `RecordModule` (`$pull` from the owner's expenses in the budget-delete transaction); `ACCOUNT_RECORDS_CASCADE` is provided by the same module (`deleteMany` of the owner's expenses and incomes on that account, in the account-delete transaction; no paid-flag or transfer-counterpart effects).

The unique `{ budget: 1, sub: 1 }` and `{ sub: 1 }` budget indexes build only under test (`autoIndex`); prod gets them when the owner runs the index script with `--apply`, so until then a duplicate history POST on prod creates a second doc.

## Auth

- `JwtAuthGuard` is registered as `APP_GUARD` in `AuthModule`. Opt out with `@Public()` (`src/auth/decorators/public.decorator.ts`) on a handler or a controller class.
- Token: `accessToken` cookie wins; otherwise `Authorization: Bearer` (scheme case-insensitive). A bad cookie does not fall back to the header.
- Checks: `verifyAsync` with `JWT_KEY`, the user still exists (`findById`; non-ObjectId `sub` = missing), and `iat >= floor(passwordChangedAt/1000)` (a reset revokes older tokens). Every failure is the same message-less 401.
- `req.user = { sub, iat, exp }` (`AuthenticatedRequest`); handlers pass `req.user.sub` to the service.
- Two non-global `JwtModule`s: `AuthModule` (access, `JWT_KEY`) and `UserModule` (one-time reset, `ONE_TIME_JWT_KEY`). Never make either global, or the keys mix.
- Login always runs bcrypt (against `DUMMY_PASSWORD_HASH` for unknown emails).

## Mail

- `MailService` (`src/mail`) implements the `ForgotPasswordMailer` port; `UserModule` imports `MailModule`. It renders the `.tsx` template to HTML itself and sends `html:` (no `react:` payload), with `AbortSignal.timeout(5000)`.
- It never rejects: Resend `{ error }`, a thrown error or a timeout is logged as `forgot-password mail failed (<name>[, <status>])`; success logs `forgot-password mail sent (<resend id>)`. Logger context `ForgotPasswordMailer`. Never log the recipient, names, URL, token or Resend's `message`.
- Outside production the Resend SDK itself `console.error`s `[Resend API Error]` with the full error (can include addresses); accepted, silent when `NODE_ENV=production`.
- `<Head>` must stay inside `<Tailwind>` in templates, or the `hover:`/`focus:` classes make every render throw.

## Testing Structure

- **Unit tests:** `*.spec.ts` co-located with source — `pnpm test` (`vitest run`, config `vitest.config.ts`)
- **E2E tests:** `test/*.e2e-spec.ts` — `pnpm run test:e2e` (config `vitest.config.e2e.ts`)
- **Coverage:** `pnpm run test:cov` → `coverage/` (`@vitest/coverage-v8`)
- Both configs use `globals: true` and `vite-tsconfig-paths`.

## Branching & Release

- PRs target `main` (no `develop`). Feature branches are named `feat/<topic>`.
- `check-label.yml`: every PR needs a `major`, `minor` or `patch` label.
- `ci.yml`: on PRs to and pushes to `main` — job `verify`: `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run build`, a Node-ESM import of `dist/app.module.js` with a dummy env (catches CJS named value imports like `{ Connection } from 'mongoose'` that only break `node dist/main.js`; import types with `type`), `pnpm test`, then a `mongo:8` replica set via `docker run --replSet rs0` and `pnpm run test:e2e` with `MONGO_TEST_URI`. Job `secrets` (parallel): gitleaks (`ghcr.io/gitleaks/gitleaks:v8.30.1`) over the full git history with `--redact`.
- `update-changelog.yml`: on merge to `main`, bumps `package.json` version per the label (highest wins), prepends the PR to `CHANGELOG.md`, commits `chore(release): vX.Y.Z (<bump>)`, tags `vX.Y.Z` and pushes.

## Adding New Modules

1. Scaffold with the Nest CLI (see `IMPLEMENTATION_GUIDELINES.md`).
2. Confirm the module is registered in `src/app.module.ts` (`nest g mo` does this).
3. Export services other modules need, via the module's `exports` array.
4. Update this document: module details and the route table.

## Common Patterns

### Module Export Pattern

```typescript
@Module({
  providers: [MyService],
  exports: [MyService], // ← makes the service available to importing modules
})
```

### ESM relative imports

Relative imports end in `.js` (`import { AppService } from './app.service.js';`).

### Guard Stacking

`JwtAuthGuard` (authentication) is the only guard, global. Any future authorization guard runs after it (register it after `AuthModule`'s `APP_GUARD`, or per route).

## Notes

- `.env.example` documents every key; `.env` is gitignored.
- `package.json` has a `deploy` script (`nest deploy`, with `@nestjs/mau` installed), but there is no deployment config or deploy workflow in the repo. _(planned)_ deployment target is not decided here; check the external plan.
- `dist/` and `*.tsbuildinfo` are build output (gitignored).
- **S9** must set Express `trust proxy` (API Gateway's hop only); until then `req.ip` is the socket address and, deployed, every forgot-password call shares one IP bucket.
- helmet runs with defaults; if old-next breaks on CORP, the agreed fallback is `crossOriginResourcePolicy: { policy: 'cross-origin' }`.
