# Research: S8 — hardening

**Branch:** `feat/hardening` (from `main` v0.11.0) · **Date:** 2026-10-25 · **Type:** epic-sized story, full research

Sources: `~/projects/notes/budget-master/be-refactor.md` (S8, D7, D14–D16, E2.A1/A4, E3.M5, E5 gate, E6 gate, E7.Q9,
Security findings), `be-refactor-db-checks.md` (prod counts, existing indexes), legacy `origin/develop`
(`src/users/`, `main.ts`, `lambda.ts`, `serverless.yml`), old-next (`src/app/api/route.ts`,
`src/features/Login/Login/LoginCard.utils.ts`), `ai-research/records.research.md` §9.

## 1. Story

Close the refactor's non-contract gaps: a user delete that removes every document the user owns, security headers,
rate limits on the two credential endpoints, the prod indexes (prod runs with `autoIndex` off), and a review +
repair of the bad prod data found in S5/S7. The HTTP contract (paths, statuses, bodies, the `accessToken` cookie)
does not change.

## 2. Proposed split (owner decides)

Too big for one reviewable PR: three unrelated code changes plus two operator scripts against prod.

| Story | Content | Order |
|---|---|---|
| **S8a — hardening-code** | user-delete cascade (transaction), helmet, rate limit on `POST /auth` + `POST /users/forgot-password` | 1st |
| **S8b — hardening-scripts** | index script (dry-run default), data-repair report (read-only) + fix script (dry-run default) | 2nd: if the rate-limit store is a Mongo collection (§5), its TTL index ships in this script |

ACs:
- S8a: 1. `DELETE /users` removes the user's categories, accounts, budgets, budget histories, expenses and incomes
  in one transaction; the body and status are unchanged. 2. Response headers/bodies otherwise unchanged, except the
  helmet headers and `X-Powered-By` removed (§4). 3. Over-limit login/forgot-password → 429 in the envelope, applied
  the same whether the email exists or not. 4. Unit + e2e tests for the cascade (incl. atomicity) and the limits.
- S8b: 1. The index script lists missing indexes and creates them only with an explicit flag; re-running changes
  nothing; it never drops an index. 2. The report script is read-only and prints the counts of §7. 3. The fix script
  changes nothing without an explicit flag and applies only the owner-approved cases. 4. Both run against a local
  replica set in tests, never prod.

## 3. User-delete cascade (S8a)

**Today** (`src/user/services/user.service.ts:125`): `findByIdAndDelete(sub)`; nothing else is deleted. Response
200 `{ ...INITIAL_RESPONSE, message: 'User deleted.', data: { userDeleted: { email, firstName, lastName } } }`;
missing → 400 `'User not found.'`. Unit tests at `user.service.spec.ts:212`.

**develop** (`src/users/services/users.service.ts:258`): identical body and status; every error → 400
`error.message` (we already answer 500 for unexpected errors, D6). No cascade. Contract to keep: status 200, that
body, the 400 text. old-next and fe-budget-master never call `DELETE /users` (D7).

**What to delete** (all owner fields are strings in prod, 0 ObjectIds; db-checks §1/§4):

| Collection | Model / module | Owner field |
|---|---|---|
| `categories` | `Category` / `category` | `sub` |
| `accounts` | `Account` / `account` | `sub` |
| `budgetmodels` | `Budget` / `budget` | `sub` |
| `budgethistorymodels` | `BudgetHistory` / `budget` | `sub` |
| `createexpenses` | `Expense` / `record` | `userId` |
| `createincomes` | `Income` / `record` | `userId` |
| `users` | `User` / `user` | `_id` |

Not covered: the legacy `accountrecords` collection (3 docs from 2023, no owner field) and the malformed expense with
no `userId` (§7).

**Constraints:**
- Module graph: `CategoryModule` and `AuthModule` import `UserModule`, so `UserModule` can't import
  `CategoryModule` (cycle; memory `categories-planning.md`). Existing precedents: the Symbol ports
  `ACCOUNT_RECORDS_CASCADE` / `BUDGET_EXPENSES_UNLINK` provided by the `@Global` `RecordModule`
  (`RecordPortsService`, depends only on models), and `connection.transaction` with `{ session }` on every op
  (`AccountService.deleteAccount`, `account.service.ts:116`). Another option is registering the other modules'
  schemas with `forFeature` in `UserModule` (entity files only, no module import). The plan picks one.
- The transaction body must stay side-effect free (it may be retried); ops sequential on one session.
- Size: the largest user has a few thousand records (4,195 expenses in total), well within a transaction.
- Race: a request already past the guard can insert a record after the cascade commits (its own transaction).
  After commit, the guard's per-request user-exists check 401s every later request, and public
  `create-local-categories` rejects the unknown `sub`. Accepting the in-flight race is an open question (Q2).
- Response: the deleted user's fields still come from the user doc, so the body stays as today. No counts are
  added (contract).
- Tests: unit with the mocked `connection.transaction`; e2e seeds docs of two users (incl. legacy-shaped string
  owners), deletes one, checks the other's docs survive; atomicity per `IMPLEMENTATION_GUIDELINES.md` (a one-shot
  spy throws mid-cascade → nothing deleted, user still exists); `model.init()` in `beforeAll`.

## 4. helmet (S8a)

- Not installed. `configure-app.ts` is the single place middleware goes (shared by `main.ts`, e2e, and S9's
  `lambda.ts`). Platform is Express 5 (`@nestjs/platform-express` 12); helmet's compatibility with it must be
  checked at plan time (no install in research).
- Headers helmet defaults add: `Content-Security-Policy`, `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster`, `Referrer-Policy`, `Strict-Transport-Security`,
  `X-Content-Type-Options`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Frame-Options`,
  `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection: 0`; it removes `X-Powered-By`. It never touches
  `Set-Cookie` or the `Access-Control-*` headers from `enableCors` (`credentials: true`, mirrored request headers).
- Client dependence (checked): old-next reads only `set-cookie[0]` of `POST /auth/` in its server-side BFF
  (`src/app/api/route.ts:13`); every other call is browser axios reading the JSON body. fe-budget-master reads no
  response headers. No client reads `X-Powered-By`.
- `Cross-Origin-Resource-Policy: same-origin`: browsers enforce CORP on `no-cors` fetches, not on CORS-mode XHR/fetch
  (what axios sends), so old-next's cross-origin calls keep working. Still a risk worth an e2e/manual check against
  old-next's origin; `cross-origin` is the safe fallback (Q4).
- `GET /` (`text/html`, `Hello World!`) gets the CSP too; it loads nothing, so no change.
- AC2 reading: the new security headers and the removed `X-Powered-By` are the intended change; everything else
  (status, body, cookies, CORS) unchanged.

## 5. Rate limiting (S8a)

**Routes:** `POST /auth` (raw body `LoginBody`, no DTO: `email` may be any JSON type when the guard runs) and
`POST /users/forgot-password` (DTO, but guards run before pipes, so the body is unvalidated there too).

**Who calls, from where (decides the key):**
- Login: old-next's Next route handler calls the backend **server-side from Vercel** (`route.ts:11`) and forwards no
  client IP. Per-IP limits would key every user on shared Vercel egress IPs → key **per email** (security findings
  table already says so).
- Forgot-password: called **from the browser** (`LoginCard.utils.ts:21`), so the client IP is meaningful. The S3 M5
  timing finding is an enumeration across many emails, which a per-email key does not slow; a per-IP key does.
- Behind API Gateway + serverless-express (S9), `req.ip` is only the client's when Express `trust proxy` is set;
  today nothing sets it (`grep` finds none). Per-IP keys depend on S9 getting this right.

**Store options (deploy is Lambda, S9: per-container memory, cold starts reset, parallel requests can fan out to new
containers):**

| Option | Per email | Per IP | Shared across instances | Cost / deps |
|---|---|---|---|---|
| `@nestjs/throttler` in memory | yes (custom tracker) | yes | **no** | new dep; Nest 12-compatible release must be checked |
| throttler or a small guard + **Mongo** collection (TTL index, atomic `$inc` upsert) | yes | yes | yes | no new infra; one extra write per login/forgot request; the collection would be created on prod by `start:dev` too (D16) |
| Redis/ElastiCache/DynamoDB store | yes | yes | yes | new infra for a 14-user app |
| API Gateway REST stage/method throttling (`serverless.yml` uses `http:` events) | no | no (global token bucket) | yes | free; caps total rate, so an attacker can block everyone's login |
| AWS WAF rate-based rule | no (keys: IP, header, cookie, query, path; not the JSON body) | yes | yes | ~USD 5+/month; login IP = Vercel, so per-IP only fits forgot-password |

**Recommendation:** app-level limits with the counters in Mongo (the only store already in the stack, shared by
every Lambda instance): login per email; forgot-password per email + per IP. API Gateway stage throttling as a coarse
cost backstop belongs to S9. In-memory throttler only if the owner accepts per-container limits (Q5).

**Constraints:**
- Key on a hash of the email, not the raw address (no unregistered emails stored), exact case (emails aren't
  lower-cased, legacy), and decide what a non-string `email` keys on.
- The limit must run before the user lookup and apply identically to unknown emails, or it becomes an enumeration
  oracle. forgot-password's always-201 stays below the limit.
- Over the limit → 429 through `GeneralAppExceptionFilter` (envelope, `error = exception.getResponse()`). old-next's
  login BFF turns any error into 400 with `error.message`, and the forgot page shows a generic error, so a new 429
  text is visible but harmless. `Retry-After` is acceptable; throttler's `X-RateLimit-*` headers on every response
  would break AC2 unless disabled.
- Login: the limiter must not set a cookie (`accessToken` must stay the first `Set-Cookie`).
- A per-email login limit lets anyone lock a known user out for the window (accepted trade-off? Q6).
- e2e specs log in once per file through helpers, and `auth-users` hits login 8× and forgot-password 4×; limits
  and test emails must not collide (test env can set the limits, or each spec uses its own email).

## 6. Index script (S8b)

**Declared in schemas** (built only under `NODE_ENV=test`, `src/mongoose-options.ts:40`):

| Collection | Index | Prod today |
|---|---|---|
| `users` | `{email:1}` unique | exists (`email_1`) |
| `categories` | `{sub:1}` | missing |
| `accounts` | `{sub:1}` | missing |
| `budgetmodels` | `{sub:1}` | missing |
| `budgethistorymodels` | `{budget:1, sub:1}` unique | missing; 5 docs, no duplicate pairs on 2026-10-25, but prod accepts duplicate history POSTs until this exists (E6 gate) |
| `createexpenses` | `{userId:1, account:1, date:-1}` | missing; prod has `date_1`, `userId_1` (not in the schema) |
| `createincomes` | `{userId:1, account:1, date:-1}` | missing |
| rate-limit collection (if §5 picks Mongo) | TTL on the expiry field | n/a |

**Facts that constrain the script:**
- Mongoose offers `Model.diffIndexes()` (to create / to drop, no write) and `Model.createIndexes()` (create only).
  `Model.syncIndexes()` **drops** indexes not in the schema: it would drop prod's `date_1` and `userId_1`. The story
  says "never automatic" and nothing asks to drop indexes.
- `userId_1` is a prefix of the new compound index (redundant once it exists); `date_1` serves no current query
  (records research §9). Dropping them is optional (Q8).
- The unique `{budget, sub}` build fails with E11000 if duplicates appeared since 2026-10-25; the script must report
  that instead of half-finishing.
- Running: Node here is 22.16 (no default TypeScript stripping, and our `.js`-suffixed imports don't resolve under
  `--experimental-strip-types`), no `tsx`/`ts-node` installed. `nest build` compiles only `src/` (`tsconfig.build.json`),
  so a script under `src/` ships as `dist/...js` and can reuse `AppModule`/`config.ts` (env validation, the same
  `MONGO_*` keys) via an application context. That also puts it in S9's Lambda bundle (harmless, but note it).
- The prod-DB guard (`assertTestMongoUri`) only runs under `VITEST`/`NODE_ENV=test`; the script's tests run under
  vitest against the memory replica set, so they're guarded. The owner runs it with his `.env` (prod) explicitly.
- Atlas builds on these sizes (≤ 4,195 docs) are instant; no rolling build needed.

## 7. Data repair (S8b) — every case is an owner decision

Counts from 2026-10-25 (db-checks + S5/S7 research). Proposed exposure: a **read-only report script** (recomputes the
counts and prints `_id`s to the owner's terminal only, nothing committed) and a **fix script** (dry-run by default,
applies only the cases/ids the owner names, re-checks each doc's condition at apply time, prints before/after counts).

| # | Case | Count | Effect today | Options | Recommendation |
|---|---|---|---|---|---|
| R1 | Account with int, non-4-digit `terminationFourDigits` | 1 | its PUT echo 400s (digits text), as on develop | a) set the 4-digit string the owner gives; b) `$unset` (looks like a cash account, D17); c) leave | a) if the owner knows the digits, else b) |
| R2 | Record whose `category` belongs to another user | 1 exp + 1 inc | editable (Q9), populated with the other user's category | a) repoint to the owner's category with the same name, if any; b) leave | a) when a same-name category exists, else b) |
| R3 | Record whose `account` belongs to another user | 2 exp + 1 inc | in no listing (they filter by `userId` + one of the caller's accounts); amount/account edit and delete → 404 (E7a gate, Q10) | a) move to an owner account the owner picks (no balance change); b) delete (no balance change); c) leave | owner inspects first (could be one person with two users); default c) |
| R4 | Record pointing to a missing category | 6 exp + 2 inc | `category` populates to `null` | a) leave; b) repoint to an owner category | a) unless the client breaks on `null` category (check before deciding) |
| R5 | Record pointing to a missing account | 1 exp + 1 inc | not listed anywhere (listings filter by account), delete → 404 (Q10): unreachable | a) delete; b) leave | a) |
| R6 | Expense whose `linkedBudgets` has a missing budget | 1 | skipped on edit/delete (E7a gate) | a) `$pull` the dangling id; b) leave | a) |
| R7 | (not in the story) malformed expense with only `_id, isPaid, budgets, __v` | 1 | invisible, no owner | a) delete; b) leave | a) |
| R8 | (not in the story) orphan accounts/categories whose user no longer exists (pre-cascade deletes) | 2 accounts + 55 categories | invisible | a) delete (what the cascade would have done, D7); b) leave | a) |

**Optional migration (story item):** not worth it. `account` is already a string in all 5,075 records (D2) and the
schema stores String; `nestResetDate` exists on 0 budgets (db-checks §2) and `toJSON` already maps it. The mixed
`category` type (≈ 400 ObjectIds) is handled by Q4 populate and is not asked for. Recommend dropping the item (Q9).

## 8. Affected files and modules

- S8a: `src/user/services/user.service.ts` (+ spec), `src/user/user.module.ts`, possibly a new port/provider in a
  global module (pattern: `src/record/services/record-ports.service.ts`, `src/record/record.module.ts`),
  `src/configure-app.ts` (helmet; shared with S9's handler), `src/auth/controllers/auth.controller.ts`,
  `src/user/controllers/user.controller.ts` (limits), `src/config.ts` + `.env.example` if limits are configurable,
  `package.json`/`pnpm-lock.yaml` (helmet, maybe throttler), `test/auth-users.e2e-spec.ts` (+ a cascade e2e),
  `ai-skills/REPO_CONTEXT.md` ("does not exist yet" line, route table `DELETE /users`, Database/Notes).
- S8b: new script files under `src/` (see §6), their specs, `package.json` scripts, `REPO_CONTEXT.md`
  (Database section: how prod indexes are built), and the `.gitleaksignore`/fixture rule (no Atlas-shaped URIs).

## 9. Open questions (with recommendation)

**All resolved 2026-10-25** (tracker row `E8.Q1–Q11`); answers in "Owner decisions" below.

1. **Split:** S8a (code) then S8b (scripts), as §2? — *Yes.*
2. **Cascade race:** accept that a request in flight when the user is deleted can leave a record behind? —
   *Yes (14 users; the guard stops every later request).*
3. **Cascade wiring:** port in the global `RecordModule` vs. `forFeature` of the other schemas in `UserModule`? —
   *Plan decides; both avoid the `UserModule`→`CategoryModule` cycle.*
4. **helmet:** defaults, or defaults with `Cross-Origin-Resource-Policy: cross-origin`? — *Defaults, verified with a
   CORS e2e and a manual old-next smoke test; fall back to `cross-origin` if anything breaks.*
5. **Rate-limit store:** Mongo-backed (shared across Lambda instances) vs. in-memory throttler (per instance)? —
   *Mongo.* API Gateway throttling only as a coarse S9 backstop.
6. **Limits and keys:** login per email, e.g. 10 attempts / 15 min; forgot-password per email 3 / hour and per IP
   10 / hour (needs `trust proxy` in S9). Count all attempts or failures only? Accept the lockout-by-email trade-off?
   — *These numbers, all attempts, accept lockout.*
7. **429 body:** default `ThrottlerException` text vs. a fixed legacy-style text (e.g. `'Too Many Requests'`)? —
   *Fixed `'Too Many Requests'`, `X-RateLimit-*` headers off.*
8. **Prod's extra indexes** `date_1`, `userId_1` on `createexpenses`: leave or drop? — *Leave (the script never
   drops); drop by hand later if wanted.*
9. **Optional migration:** drop it (no data needs it)? — *Drop.*
10. **Data repair R1–R8:** pick an option per row of §7 (R1 needs the real digits). Are R7/R8 in scope? — *Per the
    recommendation column; R7/R8 in scope.*
11. **Report output:** may the report print document `_id`s (no names/emails/amounts) to the owner's terminal? —
    *Yes, ids only, never committed.*

## Owner decisions (2026-10-25)

Owner "ok" on every recommendation (tracker `E8.Q1–Q11`); each question above is **resolved**:

- **Q1** split: S8a hardening-code (cascade, helmet, rate limits), then S8b hardening-scripts (index + data repair).
- **Q2** accepted: a request already past the guard when the user is deleted may leave one record; the guard rejects
  everything after the commit.
- **Q3** cascade wiring left to the plan (no module cycle, no `forwardRef`).
- **Q4** helmet defaults + a CORS e2e (credentials, mirrored origin) + a manual old-next smoke test; if anything
  breaks, `Cross-Origin-Resource-Policy: cross-origin`.
- **Q5** rate-limit store = a Mongo collection with a TTL index (shared by Lambda instances). The prod TTL index ships
  in S8b's index script (prod `autoIndex` is off); tests build it via `autoIndex`. Atomic counter. API Gateway
  throttling only as an S9 backstop.
- **Q6** login 10 / 15 min per email; forgot-password 3 / h per email and 10 / h per IP (the IP needs `trust proxy`,
  set in S9; S8a must not break local runs). Count every attempt; key on the normalized email (trim + lowercase);
  lockout of a known email accepted.
- **Q7** over the limit → 429 in the envelope, fixed `'Too Many Requests'`, no `X-RateLimit-*` headers, identical for
  known and unknown emails.
- **Q8** leave prod's `date_1` / `userId_1`; scripts never drop (`diffIndexes` dry run, `createIndexes`).
- **Q9** no optional migration.
- **Q10** R1 `$unset` the bad `terminationFourDigits` (no digits given); R2 repoint to the owner's same-name category,
  else leave; R3 report only; R4 report lists the owner's categories, repoint per owner choice, else leave (old-next's
  edit form crashes on a `null` category); R5 delete; R6 `$pull`; R7 delete; R8 delete the 2 accounts + 55 categories.
- **Q11** the report prints `_id`s only, never committed.

## 10. Assumptions

- Every owner field in prod is still a string (0 ObjectIds on 2026-10-25), so string filters reach every doc.
- The counts in §7 may have changed; the report recomputes them before any fix.
- No client calls `DELETE /users` (D7), so the cascade's latency is irrelevant to the UI.
- The owner runs the S8b scripts manually from his machine with his own `.env`; nothing runs them in CI or at boot.
- helmet and (if chosen) `@nestjs/throttler` versions compatible with Nest 12 / Express 5 exist; verified at plan.
