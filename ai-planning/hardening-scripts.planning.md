# Plan: S8b — hardening-scripts (prod index script, data-repair report + fix for R1–R8)

**Status:** APPROVED (2026-10-25, as written, run-all). Open questions resolved with the plan's recommendations:
Q1 the report prints ids only (R4 lists the owner's category ids, no names); Q2 R4 via `--r4-map=<JSON file
recordId→categoryId>` kept outside the repo; Q3 deletes / repoints touch nothing else (balances, budgets, history,
`expensesPaid`, transfer pairs); Q4 no package.json scripts, `node dist/scripts/…`; Q5 R7 = any record with no
`userId`.

**Branch:** `feat/hardening-scripts` (from `main` after PR #12, S8a merged: cascade, helmet, `RateLimitModule` /
`ratelimits`) · **Date:** 2026-10-25 · **Research:** [`ai-research/hardening.research.md`](../ai-research/hardening.research.md)
(S8b scope: §6, §7; "Owner decisions (2026-10-25)" answers §9) · Pattern reference: `connection.transaction` +
`{ session }` (`AccountService.deleteAccount`, `UserService.deleteUser`), `closeTestApp`'s DB-name check
(`test/create-test-app.ts`), the prod-DB guard `assertTestMongoUri` (`src/mongoose-options.ts`) · Memory:
[`hardening-research.md`](../memories/repo/hardening-research.md),
[`hardening-code-planning.md`](../memories/repo/hardening-code-planning.md)

Owner decisions applied (`~/projects/notes/budget-master/be-refactor.md`, rows `E8.Q1–Q11` and `E8a plan gate`, read
only):
- **E8.Q8** never drop an index (prod's undeclared `date_1` / `userId_1` on `createexpenses` stay); dry run with
  `Model.diffIndexes()`, create with `Model.createIndexes()`, **never** `Model.syncIndexes()`.
- **E8.Q5 / E8a gate** the `ratelimits` TTL index `{ expiresAt: 1 }, expireAfterSeconds: 0` ships in this script.
- **E8.Q10** R1 `$unset` the bad `terminationFourDigits`; R2 repoint to the owner's same-name category, else leave;
  R3 report only; R4 report lists the owner's categories, repoint only per an explicit owner mapping, else leave;
  R5 delete records on missing accounts; R6 `$pull` the dangling budget id; R7 delete the expense with no `userId`;
  R8 delete accounts and categories whose user no longer exists.
- **E8.Q11** output prints `_id`s only (no names, emails, amounts); nothing of it is committed.
- **E8.Q9** no optional migration.
- **D16** tests never touch prod. The owner runs `--apply` by hand with his `.env`; never CI, never boot.

AC numbers are research §2's S8b AC1–AC4: 1. the index script lists missing indexes, creates them only with an
explicit flag, a re-run changes nothing, it never drops; 2. the report is read-only and prints the counts of §7;
3. the fix changes nothing without an explicit flag and applies only the owner-approved cases; 4. both run against a
local replica set in tests, never prod.

HTTP contract and clients: unchanged (no route, controller, DTO or response touched).

## Scope guard

**In:** `src/scripts/` (a shared runner, the index script, the data-repair script, their CLI entry files and unit
specs), `test/create-test-app.ts` (widen `closeTestApp`'s parameter type), one new e2e spec,
`ai-skills/REPO_CONTEXT.md`.

**Out (don't add):** dropping any index; `syncIndexes`; the optional migration (Q9); the legacy `accountrecords`
collection; balance / budget-amount / budget-history / paid-flag adjustments for deleted or repointed records (open
question 3); R1 digits (the owner gave none); any automatic R3 or R4 fix; new env keys; package.json scripts (open
question 4); running anything at boot or in CI against a real DB; a Nest module for the scripts.

## Design (applies to every phase)

- **Location and build.** `src/scripts/*.ts`, compiled by `nest build` to `dist/scripts/*.js` (Node 22.16 can't run
  our TS directly, research §6). Nothing under `src/` imports them; `AppModule` is unchanged. They do land in S9's
  Lambda bundle (inert; S9 may exclude `dist/scripts`, hand-off note).
- **Logic vs entry.** Each script is a logic file exporting one function that takes an `INestApplicationContext` and
  `{ apply, log }`, plus a `*.cli.ts` entry that only calls the shared runner (top-level `await`, like `main.ts`). Specs
  import the logic file, never the entry (which would run on import).
- **Connection reuse.** The runner builds `NestFactory.createApplicationContext(AppModule, { logger: ['error',
  'warn'] })`: the same `ConfigModule` (`.env`, Joi validation, `MONGO_*` keys), the same `mongooseOptions`, every model
  already registered (`app.get(getModelToken(X.name))`), no HTTP listener. No duplicated config or URI building.
  Under Vitest `mongooseOptions` still runs `assertTestMongoUri`, so the specs can't reach prod.
- **Target print + apply guard.** After the context connects and before any read: print `target: <connection.host>
  db=<connection.name> mode=<dry-run|apply>` (mongoose's parsed host, never the URI, so no credentials). `--apply`
  also requires `--db=<name>` equal to `connection.name`; otherwise print the refusal, `process.exitCode = 1`, close,
  and run nothing. Dry-run is the default and needs no `--db`.
- **Args.** `node:util` `parseArgs` (`strict: true`, no positionals): `--apply` (boolean), `--db` (string),
  `--r4-map` (string, data-repair only; ignored by the index script). An unknown flag or a stray `--` throws before
  connecting.
- **Errors.** The runner catches, prints only `error.name` and `code` (an E11000 message carries key values), sets
  `process.exitCode = 1`, and always `app.close()`s.
- **Output (Q11).** Only collection names, index keys / names, counts, case labels, `expense` / `income` kinds and
  `_id`s (records, accounts, categories, budgets, users). Never `categoryName`, `title`, emails, amounts, or the
  `terminationFourDigits` value (partial card digits). `log` defaults to `console.log`; specs inject a collector.

---

## Phase 1 — shared runner + index script (AC1, AC4)

### `src/scripts/script-runner.ts` — create
- `parseScriptArgs(argv: string[]): ScriptArgs` (`{ apply: boolean; db?: string; r4Map?: string }`) with `parseArgs`
  as above.
- `assertApplyTarget(args: ScriptArgs, dbName: string): boolean` — `true` for dry-run; with `apply`, `true` only when
  `args.db === dbName`.
- `createScriptContext(): Promise<INestApplicationContext>` — the `createApplicationContext` call above (reused by
  the e2e spec).
- `runScript(run: (app, opts: { apply: boolean; r4Map?: string; log }) => Promise<boolean>): Promise<void>` — parse
  `process.argv.slice(2)`, create the context, print the target line, check `assertApplyTarget`, call `run`, set
  `process.exitCode = 1` when it returns `false` or throws (name/code only), `app.close()` in `finally`.

### `src/scripts/db-indexes.ts` — create
- `INDEXED_MODELS = [User, Category, Account, Budget, BudgetHistory, Expense, Income, RateLimit]` (`.name`s; all eight
  are registered: `UserModule` has seven, `RateLimitModule` the eighth).
- `createMissingIndexes(app, { apply, log }): Promise<boolean>`: per model, sequentially:
  1. `const { toDrop, toCreate } = await model.diffIndexes()` (read only; a missing collection counts as no
     indexes, mongoose handles `NamespaceNotFound`).
  2. Log `<collection>: missing [<keys>…]` and, when `toDrop` is non-empty, `<collection>: extra, kept (never
     dropped) [<names>]`. `toDrop` is only ever printed.
  3. With `apply` and `toCreate.length > 0`: `await model.createIndexes()` (creates only; an index that already
     exists with the same spec is a no-op). Catch per model: E11000 (`code === 11000`, the unique
     `budgethistorymodels { budget, sub }` with duplicates) or an options conflict (codes 85 / 86, same keys
     different options) → log `<collection>: NOT created (<name> <code>)`, mark failure, continue with the next
     model. Any other error rethrows.
  4. With `apply`, re-run `diffIndexes()` and log `<collection>: after, missing <n>`.
  - Returns `false` if any model failed. Never calls `syncIndexes`, `dropIndex`, `dropIndexes` or
    `cleanIndexes` (one-line comment: Q8).
- Expected on prod (research §6): missing `categories {sub:1}`, `accounts {sub:1}`, `budgetmodels {sub:1}`,
  `budgethistorymodels {budget:1, sub:1}` unique, `createexpenses` and `createincomes {userId:1, account:1, date:-1}`,
  `ratelimits {expiresAt:1}` TTL; `users` nothing; extra kept `createexpenses` `date_1`, `userId_1`.

### `src/scripts/db-indexes.cli.ts` — create
- `await runScript(createMissingIndexes);`

### `src/scripts/script-runner.spec.ts` — create (unit)
- `parseScriptArgs`: `[]` → dry-run; `--apply --db=x --r4-map=/tmp/m.json` parsed; unknown flag, a positional and a
  stray `--` throw.
- `assertApplyTarget`: dry-run passes without `--db`; `apply` with no `--db` or a different name fails; equal passes.

### `src/scripts/db-indexes.spec.ts` — create (unit)
- Fake context whose `get(getModelToken(name))` returns stub models `{ collection: { name }, diffIndexes, createIndexes,
  syncIndexes, dropIndex? }` (spies).
- Coverage: dry-run never calls `createIndexes`; apply calls it only for models with `toCreate`; `toDrop` names are
  logged as kept and `syncIndexes` is never called; an E11000 on one model logs `NOT created`, the other models are
  still processed and the result is `false`; a non-index error rejects.

### `test/create-test-app.ts` — modify
- `closeTestApp(app: INestApplicationContext)` (was `INestApplication`; it only uses `get` and `close`), so the scripts
  spec reuses the guarded drop.

### `test/db-scripts.e2e-spec.ts` — create (indexes block; Phase 2 adds the repair block)
- `beforeAll`: `app = await createScriptContext()` (env from `test/setup-env.ts`, guard runs); `await model.init()` for
  the eight models (under `NODE_ENV=test` `autoIndex` builds every schema index), then make the DB look like prod:
  `dropIndexes()` on each raw collection (keeps `_id_`), recreate `users { email: 1 } unique`, add the undeclared
  `createexpenses` `date_1` and `userId_1`, and one more extra (e.g. `categories { icon: 1 }`). `afterAll`:
  `closeTestApp(app)`.
- Helper `snapshot()`: `listIndexes()` of every collection (names + key + `unique` + `expireAfterSeconds`).
- Coverage:
  - Dry-run: `createMissingIndexes(app, { apply: false, log })` → `true`; the log lists the seven missing indexes
    above and the three extras as kept; `snapshot()` unchanged.
  - Apply: → `true`; every schema index exists with its options (unique `{budget, sub}`, TTL `expireAfterSeconds: 0` on
    `ratelimits`); `date_1`, `userId_1` and the `icon_1` extra **still exist**.
  - Second apply: logs nothing missing, `snapshot()` equals the post-apply one (idempotent).
  - Duplicate pair: on a fresh state (drop the `budget_1_sub_1` index, insert two history docs with the same
    `{budget, sub}`), apply → `false`, `budgethistorymodels` logged `NOT created (MongoServerError 11000)`, every other
    collection's indexes still created; remove the duplicate afterwards.
  - Output check: the collected log contains no seeded name / email string.

**Success criteria**
- Automatic: `pnpm run build` (emits `dist/scripts/db-indexes.cli.js`), `pnpm test script-runner`,
  `pnpm test db-indexes`, `pnpm run test:e2e db-scripts`, then full `pnpm test` and `pnpm run test:e2e`.
- Manual: Phase 3.

---

## Phase 2 — data-repair: read-only report by default, `--apply` fix (AC2, AC3, AC4)

One script: the default mode **is** the report (read-only, recomputes every case, prints counts + `_id`s); `--apply`
is the fix. Each case is detected and fixed inside its own transaction, so the filters are the exact `_id`s found in
that same run and the same snapshot.

### `src/scripts/data-repair.ts` — create
- **Load (I/O, optional `session`)** `loadSnapshot(models, session?)`: lean projections only —
  `users {_id}`, `accounts {_id, sub, terminationFourDigits}`, `categories {_id, sub, categoryName}`,
  `budgetmodels {_id}`, `createexpenses {_id, userId, account, category, linkedBudgets}`,
  `createincomes {_id, userId, account, category}` (≈ 5.2k small docs on prod). `categoryName` is used for R2 matching
  only, never printed.
- **Classify (pure, unit-tested)** `classify(snapshot): RepairCases`. Every id compared as `String(value)` (record
  `category` is a string or an ObjectId, `account` a string, owner fields strings, research §7 / db-checks §1).
  Records without `userId` are only R7.
  - **R1** accounts whose `terminationFourDigits` is present and `!TERMINATION_DIGITS_REGEX.test(String(v))` (or not a
    string) → account ids.
  - **R2** records whose `category` resolves to a category with `sub !== userId` → `{ kind, recordId, target }`;
    `target` = the id of the record owner's category with the same `categoryName` when **exactly one** exists, else
    `null` (none or ambiguous → left, logged as `no-match` / `ambiguous`).
  - **R3** records whose `account` resolves to an account with `sub !== userId` → `{ kind, recordId }` (report only).
  - **R4** records whose `category` resolves to no category → `{ kind, recordId, userId, ownerCategoryIds }`.
  - **R5** records whose `account` resolves to no account (incl. non-ObjectId strings) → `{ kind, recordId }`.
  - **R6** expenses with `linkedBudgets` ids not in `budgetmodels` → `{ recordId, danglingIds }`.
  - **R7** records with no `userId` → `{ kind, recordId }` (prod: the one malformed expense).
  - **R8** accounts / categories whose `sub` is not a `users._id` → ids to delete, **except** any still referenced by
    a record (`account` / `category`), which go to `r8Kept` (logged as `referenced, kept`). Without this, deleting an
    R8 account that an R3 record points to would turn that record into R5 and the next run would delete it.
- **Report** `printCases(cases, log)`: per case the count and the ids (R2 with `target` or the reason; R4 with
  `userId` and `ownerCategoryIds`; R8 split accounts / categories / kept). Plus the R4 map summary when `--r4-map`
  is given (`apply` / `skip: not R4` / `skip: category not owned`).
- **R4 map** `loadR4Map(path)`: `JSON.parse(readFileSync)` of `{ "<recordId>": "<categoryId>" }`; every key and value
  must be a 24-hex ObjectId string, else throw before any write. A map entry is applied only when, in the
  same transaction, the record is still R4 and the category exists with `sub === record.userId`; otherwise skipped
  and logged. The file holds ids only; the owner keeps it outside the repo (doc says so).
- **`repairData(app, { apply, r4Map, log }): Promise<boolean>`**:
  1. `before = classify(await loadSnapshot(models))`; `printCases(before)`. Without `apply`: return `true` (no write of
     any kind; R4 map is validated and summarized only).
  2. With `apply`, cases in this order, each `await connection.transaction(async (session) => { const c =
     classify(await loadSnapshot(models, session)); …writes with { session }… })`, then log `R<n>: before <x>,
     fixed <y>, after <z>` (`after` from a fresh `classify` after the commit):
     - **R1** `accountModel.updateMany({ _id: { $in } }, { $unset: { terminationFourDigits: 1 } })`.
     - **R2** per entry with a `target`: `updateOne({ _id: recordId }, { $set: { category: target } })` on the kind's
       model (string id, what the API writes today).
     - **R4** per valid map entry: same `$set` as R2.
     - **R5** `deleteMany({ _id: { $in } })` on expenses, then on incomes.
     - **R6** per entry: `updateOne({ _id: recordId }, { $pull: { linkedBudgets: { $in: danglingIds } } })`.
     - **R7** `deleteMany({ _id: { $in }, userId: { $exists: false } })` on each record model.
     - **R8** last (after R2/R4 have repointed records): `deleteMany({ _id: { $in } })` on accounts, then categories.
     - **R3** none.
     - Inside each callback: if a write's `modifiedCount` / `deletedCount` differs from the ids it targeted, throw
       (aborts that case). No logging inside the callback (it may be retried).
  3. A failed case stops the run (later cases not attempted), logs `R<n>: aborted (<name> <code>)`, returns `false`.
  - Cases with zero ids skip the transaction (logged `R<n>: nothing to do`), so a second run is a pure read.
- Edge cases (documented in the code by one-line comments where non-obvious): `category` / `account` / budget ids that
  are not valid ObjectIds just never match (no cast errors: comparisons are on strings in memory, writes filter on
  `_id`s from the DB); R1 never prints the stored value; R2 / R4 write a string even if the old value was an
  ObjectId; R5 / R7 deletes don't touch balances, budget amounts, budget-history entries, `expensesPaid` lists or
  transfer counterparts (open question 3).

### `src/scripts/data-repair.cli.ts` — create
- `await runScript(repairData);` (`runScript` passes `r4Map` from the args; `loadR4Map` runs before any write).

### `src/scripts/data-repair.spec.ts` — create (unit)
- `classify` on hand-built snapshots: R1 int `123` / string `'12a4'` / missing / `'1234'` (only the first two); R2 with
  an ObjectId and a string category, same-name match, no match, two same-name candidates (ambiguous); R3; R4 with the
  owner's category list; R5 incl. a non-ObjectId account string; R6 keeps the existing budget ids; R7 excluded from
  every other case; R8 orphan account and category, one of each still referenced → `r8Kept`.
- `printCases`: output contains the ids and none of the seeded `categoryName`s / digits.
- `loadR4Map`: valid file; bad JSON, non-hex key or value → throws.

### `test/db-scripts.e2e-spec.ts` — modify (repair block)
- `beforeEach`: clear the seven data collections, then seed raw docs (`connection.collection(...).insertMany`, legacy
  shapes, string owners) for users `U1`, `U2` (and a never-created `GONE` id):
  - R1: `U1` account with `terminationFourDigits: 123` (int); controls: one with `'1234'`, one without the field.
  - R2: `U1` expense whose `category` is `U2`'s "Food" as an ObjectId, `U1` owns one "Food" → repointed; `U1` income on
    `U2`'s "Rare" (no `U1` "Rare") → left; one record whose name matches two `U1` categories → left.
  - R3: `U1` expense on `U2`'s account → untouched.
  - R4: two `U1` expenses on a missing category id; the map file (written to the OS temp dir, deleted in `afterAll`)
    maps the first to a `U1` category, plus an entry pointing to a `U2` category and an entry for a non-R4 record.
  - R5: one `U1` expense and one income on a missing account id; control record on an existing account.
  - R6: `U1` expense with `linkedBudgets [existingBudget, missingBudget]`.
  - R7: an expense with only `_id, isPaid, budgets, __v`.
  - R8: `GONE`'s account and two categories; a third `GONE` category referenced by a `U1` record that R2 can't repoint
    (kept), and a `GONE` account referenced by an R3-style record (kept).
- Helper `dataSnapshot()`: every doc of the seven collections, sorted by `_id`.
- Coverage:
  - Report (default): returns `true`; counts per case equal the seeded ones; `dataSnapshot()` unchanged (AC2/AC3);
    log has no seeded name, email, amount or `123`.
  - Apply: exactly R1 unset, the one R2 + the one mapped R4 repointed (string id), R5's two docs gone, only the
    missing budget pulled, R7 gone, the unreferenced `GONE` account and two categories gone; R3 record,
    the unmatched / ambiguous R2s, the unmapped and badly-mapped R4s, the referenced `GONE` docs and every control doc
    are byte-identical to the seed.
  - Second apply (same map): every case `nothing to do` or report-only, `dataSnapshot()` equals the post-apply one.
  - Atomicity: a one-shot spy on the incomes model's `deleteMany` that runs the real delete with the session and then
    throws → R5 aborted, both R5 docs still there, R6–R8 not applied, result `false`; an unspied re-run fixes them.
  - Guard (runner): `assertApplyTarget({ apply: true }, E2E_DB_NAME)` false, `--db=budget-master-e2e` true (no prod
    involved).

**Success criteria**
- Automatic: `pnpm run build` (emits `dist/scripts/data-repair.cli.js`), `pnpm test data-repair`,
  `pnpm run test:e2e db-scripts`, then `pnpm run lint`, full `pnpm test` and `pnpm run test:e2e`.
- Manual: Phase 3.

---

## Phase 3 — docs + manual dry-run on the prod DB (AC1, AC2, AC3)

### `ai-skills/REPO_CONTEXT.md` — modify
- Overview: add S8b (prod index script, data-repair report + fix). Current Structure: `src/scripts/` block
  (`script-runner.ts`, `db-indexes.ts` / `.cli.ts`, `data-repair.ts` / `.cli.ts`, specs) with "not imported by the
  app"; `test/db-scripts.e2e-spec.ts`.
- "Does **not** exist yet": remove "the prod index/TTL script and orphan clean-up (S8b)".
- Database: prod indexes come from `node dist/scripts/db-indexes.cli.js` (never `syncIndexes`; `date_1` / `userId_1`
  on `createexpenses` are kept on purpose); replace "built only under test until S8b's script" / "prod gets them from
  S8's script" wording with "until the owner runs the index script with `--apply`".
- New section **Operator scripts** (owner only, his `.env`, from the repo root, after `pnpm run build`):
  1. `node dist/scripts/db-indexes.cli.js` (dry-run), then `… --apply --db=<db name printed on the target line>`.
  2. `node dist/scripts/data-repair.cli.js` (report). For R4, write `{ "<recordId>": "<categoryId>" }` to a file
     **outside the repo** (ids only).
  3. Recommended: an Atlas snapshot / `mongodump` first. Then `node dist/scripts/data-repair.cli.js --apply
     --db=<name> [--r4-map=<path>]`.
  4. Re-run the report: R1, R2-with-match, mapped R4, R5, R6, R7 and unreferenced R8 are 0; R3, unmatched R2,
     unmapped R4 and referenced R8 remain by decision.
  - Output is ids only (Q11): don't paste it into the repo or the notes. Use `node …` directly (no `pnpm run … --`:
    a stray `--` is rejected by the strict arg parser). Never CI, never boot.

**Success criteria**
- Automatic: none beyond Phases 1–2.
- Manual (orchestrator, **read-only on the prod DB**, D16; the scripts read the owner's `.env` through
  `ConfigModule`, the orchestrator never opens it). From the repo root:
  1. `pnpm run build`.
  2. `node dist/scripts/db-indexes.cli.js` → exit 0; first line `target: <host> db=<name> mode=dry-run` (no user /
     password in it); per collection the missing indexes (expected: the seven listed in Phase 1) and `createexpenses`
     extra, kept `date_1`, `userId_1`. Run it a second time: identical output (nothing was created).
  3. `node dist/scripts/data-repair.cli.js` → exit 0; `mode=dry-run`; per case R1–R8 the count and ids, R2 targets,
     R4 owner category ids, R8 kept. Report the counts next to research §7's (1; 1+1; 2+1; 6+2; 1+1; 1; 1; 2+55);
     differences are information, not failures. Check by eye that no name, email, amount or digits appear.
  4. Do **not** run any `--apply` (owner step, Operator scripts section).
  - Creates nothing: no write in either dry-run path. (Context init may `createCollection` a missing collection via
    mongoose `autoCreate`, as `start:dev` does; all eight exist on prod since S8a.)
  - Relay the counts, the R2 targets and the R4 record / owner-category ids to the owner (terminal / chat only, not
    committed) so he can decide the R4 map and run the apply.

---

## AC Coverage Summary

| AC | Phase(s) | Automatic / manual | Coverage |
|---|---|---|---|
| AC1 — index script lists missing, creates only with a flag, idempotent, never drops | 1, 3 | both (unit: no create in dry-run, no drop API; e2e: dry-run snapshot unchanged, apply creates incl. TTL, extras kept, 2nd run no-op, E11000 reported; manual 2) | full in tests; the prod `--apply` is the owner's step, so the prod outcome is **partial** until he runs it |
| AC2 — report read-only, prints §7 counts | 2, 3 | both (unit `classify` per case; e2e counts + unchanged snapshot + no PII in log; manual 3) | full |
| AC3 — fix changes nothing without a flag, applies only approved cases | 1, 2 | automatic (`--apply` + `--db` guard unit; e2e exact changes, untouched R3 / unmatched / controls, 2nd run no-op, per-case rollback) | full in tests; prod apply **partial** (owner step) |
| AC4 — tests on a local replica set, never prod | 1, 2 | automatic (`createScriptContext` under Vitest → `assertTestMongoUri`; `closeTestApp` drops only `budget-master-e2e`) | full |

## Decisions (beyond the research)

- One data-repair script, not two: its default mode is the read-only report, `--apply` is the fix (research §7
  proposed two files; same behavior, less code).
- `--apply` requires `--db=<connected db name>`; the target host / db / mode is printed before any read.
- Scripts boot `AppModule` as an application context (no HTTP) to reuse config validation, `mongooseOptions` and
  the registered models; logic split from the `.cli.ts` entries so specs can import it.
- Detection runs inside each case's transaction and fixes exactly the ids it found there; per-case write counts must
  match or the case aborts; a failed case stops the run.
- R2 / R4 write the category id as a string (what the API writes today). R2 repoints only on exactly one same-name
  owner category (ambiguous → left).
- R7 rule = "record with no `userId`" in both record collections (prod: one expense, 0 incomes).
- R8 keeps orphan accounts / categories still referenced by any record (otherwise R8 would create R4 / R5 cases);
  R8 runs last.
- R1 matches the 4-digit rule the API uses (`TERMINATION_DIGITS_REGEX` on the string form) and never prints the value.
- Index failures (E11000, option conflict) are reported per collection; the other collections are still processed;
  exit code 1.
- No package.json scripts; the owner runs `node dist/scripts/…` (open question 4).
- E2E builds the indexes with `autoIndex` and then drops them to reproduce prod, instead of changing `NODE_ENV`.

## Assumptions

- Prod is an Atlas replica set (transactions available), MongoDB ≥ 4.2.
- Every owner field in prod is still a string (research §10); in-memory string comparison covers string and ObjectId
  `category` values.
- `mongoose` 9.11 `Model.diffIndexes()` returns `{ toDrop: string[], toCreate: [] }` and handles a missing collection
  (checked in `node_modules/mongoose/lib/model.js`); `createIndexes()` only creates.
- Booting `AppModule` as a context has no side effects besides connecting (no `onModuleInit` hooks in `src/`; Resend
  client construction is offline).
- The orchestrator may run the two dry-runs against prod via the owner's `.env`, as earlier manual blocks ran
  `start:dev` on it.

## Open questions (before implementation)

1. **R4 report and names.** Q11 forbids names, so the report lists the owner's category `_id`s only; the owner maps
   ids to names with his own Mongo client. *Recommend:* ids only, as Q11 says.
2. **R4 map format.** `--r4-map=<path>` to a JSON `{ recordId: categoryId }` kept outside the repo. *Recommend:* yes.
3. **Side effects of R5 / R7 deletes and R2 / R4 repoints.** No balance, budget `currentAmount`, budget-history entry,
   `expensesPaid` or transfer-counterpart change (the accounts are gone; research §7 says "no balance change").
   *Recommend:* accept; the report shows the ids first, so the owner can inspect any he cares about.
4. **package.json scripts.** *Recommend:* none; document `node dist/scripts/…` (avoids pnpm's `--` passing ambiguity).
   Alternative: `db:indexes` / `db:repair` for the dry-runs only.
5. **R7 scope.** *Recommend:* the rule covers any record with no `userId` in either collection (prod: the one expense).
6. **Plan approval.** *Recommend:* approve as written (3 phases).

## Implementation checklist

- [x] Phase 1 — shared runner + index script (unit + e2e)
- [x] Phase 2 — data-repair report + `--apply` fix (unit + e2e)
- [x] Phase 3 — `REPO_CONTEXT.md` (Operator scripts section)
- [ ] Phase 3 manual — the two prod dry-runs (orchestrator; not run in the implementation phase)

Implementation notes: `runScript` also refuses `--apply` without `--db` before connecting (no connection at all), and
an invalid flag / positional / stray `--` exits 1 before connecting. `AppModule` is imported lazily in
`createScriptContext` so the arg helpers' spec doesn't load the app or `.env`. R6 `$pull`s through the raw driver
(stored values as they are, no cast). R7's delete filter is `{ userId: null }` (missing or null), matching `classify`.
Records with no `category` / `account` field resolve to none (R4 / R5).
