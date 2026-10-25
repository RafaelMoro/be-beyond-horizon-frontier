# Research: S6 — budgets and budget history (`budgetmodels`, `budgethistorymodels`, 12 routes, helpers for S7)

**Branch:** `feat/budgets-and-history` (stacked on `feat/accounts`, PR #7) · **Date:** 2026-10-25 · **Type:** single story, full research

Sources: `~/projects/notes/budget-master/be-refactor.md` (S6, ground rules, D0/D6/D8/D13, E4/E5 rows, Security
"Medium: POST `/budget-history` accepts another user's budget"), `be-refactor-survey.md` §2.2 Budgets / Budget
history, §4 "Expenses and budgets" / "Budgets and budget history", §5 #1/#13/#14/#17/#18, `be-refactor-db-checks.md`
§1–3/§5, `be-refactor-next-clients.md`, `be-refactor-frontend-usage.md` rows 23–26, `memories/repo/{categories,accounts}-*.md`.
Legacy contract = `be-budgt-master` **`origin/develop`** (44ea0c7): `src/budgets/**`, `src/budget-history/**`,
`src/domain/expenses-actions/services/expenses-actions.service.ts`. Develop did not change budgets vs main.
Live client = `old-next-budget-master@main` (2e02a8f, clone read only).

## Story

Port both budget collections and their 12 routes with develop's texts, statuses and shapes; persist
`nextResetDate`/`previousPeriods` (D8); fix `GET /budget-history/:id` (D13). Improve what clients can't see: budget
create/delete atomic with the history doc, `$inc`/`$push`/`$pull` helpers that S7 calls inside its own session,
owner check on history POST (audit Medium), indexes `{sub: 1}` (budgets) and unique `{budget: 1, sub: 1}` (history),
and a seam for pulling a deleted budget from expenses' `linkedBudgets` (S7 fills it).

## Acceptance criteria

1. The 5 `/budgets` and 7 `/budget-history` routes return develop's status, envelope, `message` and `data` keys in the
   tables below: 200 `data: null` + `'Budgets not found'` / `'Budget not found'` on empty GETs, PUT's
   `'Budget history updated'`, 404 `'Budget not found'` on PUT/DELETE, DELETE's `'Budget history not found'` path,
   404 on empty `GET /budget-history`.
2. D8: create stores `nextResetDate` and `previousPeriods`; PUT accepts both as optional and writes them; a stored
   `nestResetDate` is returned as `nextResetDate` when `nextResetDate` is absent. D13: `GET /budget-history/:id`
   returns the caller's history (populated `budget`), 404 for missing/foreign.
3. Budget create writes budget + history in one transaction (both or neither); budget delete removes budget + history
   (+ the S7 seam) in one transaction. History POST with a missing or foreign `budget` writes nothing.
4. The budget module exposes, for S7, an owner-bound `$inc` on `currentAmount` and `$push`/`$pull` history-record
   helpers that run in a caller's session; none touches another user's docs.
5. Unit tests (mocked models, mocked `connection.transaction`) for every service rule; e2e on the replica set for all
   12 routes, including cross-user cases, atomicity (one-shot failing spy → 0 docs), D8 and D13.

## Legacy contract (develop)

All routes behind the JWT guard. Responses are hydrated docs (`_id`, `__v`, `sub` unless projected out). Every service
`catch` rethrows 404s and wraps anything else in 400 with `error.message` (D6: unexpected → 500 now; filter maps
CastError/ValidationError to 400). Validation pipe on legacy: `whitelist` + `forbidNonWhitelisted`, **no `transform`**
(so dates reached mongoose as strings; ours, with `transform: true`, gets `Date`s, same stored result).

Constants: budgets `BUDGET_CREATED_MESSAGE 'New budget created'`, `BUDGET_NOT_FOUND_ERROR 'Budget not found'`,
`BUDGETS_NOT_FOUND_ERROR 'Budgets not found'`, `BUDGET_DELETED_MESSAGE 'Budget deleted'`; history
`BUDGET_HISTORY_CREATED 'New budget history created'`, `BUDGET_HISTORY_NOT_FOUND_ERROR 'Budget history not found'`,
`BUDGET_HISTORY_DELETED_MESSAGE 'Budget history deleted'`; inline `'Budget history updated'` (both PUTs),
`'Record added to budget history'`, `'Record removed from budget history'`.

**`CreateBudgetsDto`** (all required, none `IsOptional`): `name` IsString+IsNotEmpty, `description` IsString (`''`
ok), `typeBudget` IsString+IsNotEmpty (TS type `'periodic'|'one-time'` only), `startDate`/`endDate` IsDate+`@Type(Date)`+IsNotEmpty,
`currentAmount`/`limit` IsNumber+IsNotEmpty, `period` IsString, `isActive` IsBoolean, `nextResetDate` IsDate+`@Type(Date)`,
`previousPeriods` IsArray (elements unchecked; comment says `"DD:MM:YYYY | DD:MM:YYYY"`). `UpdateBudgetDto` =
swagger `PartialType` (all optional) + `budgetId` IsMongoId+IsNotEmpty. `DeleteBudgetDto` `{budgetId}` IsMongoId.

| Route | Success | Errors |
|---|---|---|
| POST `/budgets` | 201 `'New budget created'`, `data:{budget, budgetHistory}` (both full docs incl. `sub`; history `records: []`) | 400 validation; two writes, not atomic |
| GET `/budgets` | 200 `message:null`, `data:{budgets}` (`find({sub},{sub:0})`, no sort). Empty: 200 `message:'Budgets not found'`, `data:null` | 401 guard |
| GET `/budgets/:budgetId` | 200 `message:null`, `data:{budget}` (incl. `sub`; `find({_id, sub})`). Missing/foreign: 200 `'Budget not found'`, `data:null` | bad id → 400 (CastError text; ours: `'Invalid _id'`) |
| PUT `/budgets` | 200 `'Budget history updated'` (sic), `data:{budget}` (after `$set: changes`, `{_id, sub}` filter) | 400 validation; **404** `'Budget not found'` (missing or foreign) |
| DELETE `/budgets` | 200 `'Budget deleted'`, `data:{budget, budgetHistoryDeleted}` | 404 `'Budget not found'` (missing/foreign); **404 `'Budget history not found'` after the budget is already deleted** |

**History DTOs:** `RecordsHistory {recordId, recordName: IsString+IsNotEmpty; recordDate: IsDate+@Type(Date)+IsNotEmpty;
recordAmount, budgetCurrentAmount, budgetUpdatedAmount: IsNumber+IsNotEmpty}`. `CreateBudgetHistoryDto {budget:
IsNotEmpty+IsString, records: IsArray+ValidateNested(each)+@Type}`. `UpdateBudgetHistoryDto` = Partial + `budgetHistoryId`
IsMongoId. `DeleteBudgetHistoryDto {budgetHistoryId}`. `AddRecordToBudgetHistoryDto {budgetId: IsMongoId+IsNotEmpty,
record: ValidateNested({each})+@Type}` (single object). `RemoveRecordFromBudgetHistoryDto {budgetId: IsMongoId, record: IsMongoId}`.

| Route | Success | Errors |
|---|---|---|
| POST `/budget-history` | 201 `'New budget history created'`, `data:{budgetHistory}` | 400. No budget existence/owner check (audit Medium) |
| POST `/budget-history/add-record` | 201 `'Record added to budget history'`, `data:{budgetHistory}` | **400** `'Budget history not found'` (404 wrapped) |
| POST `/budget-history/delete-record` | 201 `'Record removed from budget history'`, `data:{budgetHistory}`; unknown record → 201, unchanged | **400** `'Budget history not found'` |
| GET `/budget-history` | 200 `message:null`, `data:{budgetsHistory}` (`find({sub},{sub:0})`, `budget` populated, full doc) | **404** `'Budget history not found'` when empty |
| GET `/budget-history/:budgetHistoryId` | intended 200 `message:null`, `data:{budgetHistory}` (populated) | **always 404** (filters `userId`) → D13 |
| PUT `/budget-history` | 200 `'Budget history updated'`, `data:{budgetHistory}`; `$set` of the rest, **`budget` ignored**, `records` replaced wholesale | 404 `'Budget history not found'` |
| DELETE `/budget-history` | 200 `'Budget history deleted'`, `data:{budgetHistory}` (`{_id, sub}`) | 404 |

Legacy internals S7 depends on (expenses-actions.service.ts):
- `updateBudgetAmount({changes:{budgetId, amountRecord}, sub, expenseOperation})`: `findOne({_id, sub})`; **missing or
  foreign → returns `{oldBudget:null, updatedBudget:null, message:'Budget not found'}` (no throw)**; else read-modify-write
  `$set currentAmount ± amount`; returns `{oldBudget, updatedBudget}`. Create/edit-add use `+`, delete/edit-remove `-`.
- `addRecordToBudgetHistory({budgetId, sub, newRecord})` / `removeRecordFromBudgetHistory({budgetId, sub, recordToBeDeleted})`:
  find by `{budget, sub}` (first match), push / filter `recordId !== id` in JS, then `$set` the whole doc (lost-update
  risk; remove passes the array as the id). Not found → 400 `'Budget history not found'`.
- History entry from expense create: `{recordId: expense._id.toString(), recordName: shortName, recordDate: date,
  recordAmount, budgetCurrentAmount: <before>, budgetUpdatedAmount: <before + amount>}`; edit-add uses the old/updated
  docs returned by `updateBudgetAmount`.
- `removeBudgetHistoryByBudgetId(budgetId, sub)`: `findOneAndDelete({budget: new ObjectId(budgetId), sub})`, null → message.

## Clients (what must not break)

- **old-next (live):** only `GET /budgets` (`src/shared/lib/budgets.lib.ts:23`, server, Bearer). Reads `data.budgets[]`
  `_id`, `name` (`useHandleBudgets.tsx`). On an empty list (`data: null`) its destructure throws, is caught, and the
  expense form toasts `BUDGETS_FETCH_ERROR`: existing behaviour with develop, unchanged by keeping `data: null`. No
  budget mutation, no `GET /budgets/:id`, no `/budget-history*`.
- **FE_Budget_Master (adapts, D0):** GET compares `!data && message === 'Budgets not found'` → `[]`, else
  `data.budgets.map`; reads `_id, name, typeBudget, description, startDate, endDate, limit, currentAmount, period,
  isActive, nextResetDate, previousPeriods?.`. Create sends all 11 fields (`nextResetDate = endDate`,
  `previousPeriods: []`); PUT sends the form fields + `budgetId`, usually without `previousPeriods` (no `_id/__v/sub`
  echo, so new response fields don't break its whitelist). Mutations without `unwrap()`; no status is branched on.
  Never calls `GET /budgets/:id` or any `/budget-history`.

## Prod data (db-checks)

- `budgetmodels`: 5 docs (2024-07-25..30), `sub` string ×5, `typeBudget` one-time ×3 / periodic ×2, `period`
  bi-weekly ×3 / weekly ×2, keys `name, startDate, endDate, currentAmount, description, isActive, sub, period, limit,
  typeBudget, _id, __v`. No `nextResetDate`, `nestResetDate`, `previousPeriods`. Only `_id_` index.
- `budgethistorymodels`: 5 docs, `sub` string ×5, **`budget` ObjectId ×5**, all resolve, no duplicate `{budget, sub}`.
  Keys `_id, sub, budget, records, __v`. `records` element shape not checked.
- `createexpenses.linkedBudgets` elements: ObjectId ×19 (S7's `$pull` matches ObjectIds).
- Why the types: legacy `@Prop({type: Types.ObjectId, ref})` via `SchemaFactory` is **Mixed** (S4 memory), so `budget`
  kept the ObjectId that budget create passed, and `sub: string` stayed a string. Declaring `budget` as `ObjectId`
  (ref the budget model) matches prod and makes string ids cast.

## Affected files and modules

- New module(s) (Q1), entities pinned to `collection: 'budgetmodels'` / `'budgethistorymodels'`, constants (legacy
  texts), DTOs (hand-written Partial, like S4/S5; `@nestjs/mapped-types`/swagger not installed), services + specs,
  two controllers (`budgets`, `budget-history`), registered in `src/app.module.ts`, exporting what S7 needs.
- A budget-delete → records seam (port interface + `Symbol` token, Q2).
- `test/budgets.e2e-spec.ts` (+ history, one or two files); `ai-skills/REPO_CONTEXT.md` (structure, route table,
  "does not exist yet" line).
- No change in `src/account`, `src/category`, `src/auth`, `src/user`.

## Existing patterns to follow

- `src/account/*` end to end: `@Schema({ collection })`, default `__v`, no timestamps, `sub: {type: String}`,
  `Schema.index(...)` (test-only build via `autoIndex`; prod from S8's script), `HydratedDocument` type,
  `{ ...INITIAL_RESPONSE, message, data }`, no try/catch (global filters), `findOneAndUpdate/Delete` with `{_id, sub}`
  and `returnDocument: 'after'`, `isValidObjectId` guard in helpers, `null` values dropped (E5.Q4).
- Transactions (E4): `@InjectConnection()` + `connection.transaction(fn)`, `{ session }` on every op, `fn` side-effect
  free and re-runnable; unit mock `vi.fn((fn) => fn(session))`; e2e `await model.init()` first (the unique index must
  exist before the first transaction).
- Ports (E5): interface in `*.interface.ts`, `Symbol` token in `*.constants.ts`, default `useValue` in the module,
  S7 swaps the provider without the budget module importing the record module (`ACCOUNT_RECORDS_CASCADE`).
- Helper shape (S5 `incrementBalance`): one destructured object, required `session`, owner-bound filter, `$inc`.
- First uses in the repo of `@Type(() => Date)` + `IsDate`, `ValidateNested`, and `populate`.

## Decisions taken in research (from the given data)

- **`sub`:** `String`, stored as `req.user.sub`, queried as is (both collections). **`budget`:** `ObjectId`, ref the budget model.
- **Statuses/texts:** kept exactly, including the odd ones (PUT `/budgets` → `'Budget history updated'`; add/delete-record
  "not found" → 400; empty `GET /budget-history` → 404 vs empty `GET /budgets` → 200).
- **D8:** `nextResetDate` (Date) and `previousPeriods` (`[String]`) in the schema. Create DTO keeps develop's
  required-ness (both required, as develop's DTO already was; FE sends both); PUT has both optional. Fallback: wherever
  a budget doc is returned (incl. populated `budget` in history GETs, and later S7's populated `linkedBudgets`), a stored
  `nestResetDate` surfaces as `nextResetDate` when that is absent. 0 prod docs need it.
- **D13:** `GET /budget-history/:id` filters `{_id, sub}`; missing/foreign → 404 `'Budget history not found'`.
- **History POST owner check** (audit Medium): the `budget` must be an existing budget of the caller, else no write (Q3 for the response).
- **Add/delete-record routes:** owner-bound by the `{budget, sub}` filter already; with `$push`/`$pull` they no longer
  rewrite the whole doc. (On legacy the HTTP routes likely never matched a prod doc: Mixed path, string `budgetId` vs
  stored ObjectId. Ours casts, so they start working: allowed, ground rule 3, no client calls them.)
- **PUT `/budgets`:** `$set` only present, non-null allowed fields (never `budgetId`/`sub`); `currentAmount` stays
  settable (contract), can overwrite a concurrent S7 `$inc` (accepted, like account `amount`).
- **PUT `/budget-history`:** `budget` still ignored (prevents repointing); `records` replaced wholesale (contract).
- **Helpers for S7 (signatures only):**
  - `incrementBudgetAmount({ budgetId, sub, delta, session })`: one `findOneAndUpdate({_id, sub}, {$inc: {currentAmount: delta}})`;
    returns what S7 needs for the history entry (amount before and after). Missing/foreign: legacy skips silently;
    S7 owns the "ownership on `linkedBudgets`" fix, so returning `null` (caller decides) vs throwing is Q4.
  - `addHistoryRecord({ budgetId, sub, record, session })` → `$push` on `{budget, sub}`; `removeHistoryRecord({ budgetId,
    sub, recordId, session })` → `$pull: {records: {recordId}}`. No match → 400 `'Budget history not found'` (legacy
    text/status; inside S7's transaction it aborts). HTTP add-record/delete-record reuse them without a session.
- **`typeBudget` IsIn:** see Q5.

## Edge cases and constraints

- **Budget delete without a history doc** (possible after `DELETE /budget-history`, 0 such budgets in prod): legacy
  deletes the budget and answers 404. Inside one transaction a thrown 404 rolls the delete back, making that budget
  undeletable. See Q6.
- Unique `{budget, sub}`: a second history POST for the same budget → E11000 → the filter's 409 `'Duplicate value'`
  (legacy 201 duplicate). Budget create can't hit it (new `_id`). See Q3.
- `previousPeriods` as a schema array: mongoose fills `[]` on hydration for the 5 old docs, so GET starts returning
  `previousPeriods: []` (additive; FE reads `?.`). `default: undefined` would keep the key absent; planning picks.
- `Model.create` needs the array form to take a session; `fn` may retry, so the history `_id` must come from inside `fn`.
- `GET /budgets/:budgetId` with a non-ObjectId → 400 `'Invalid _id'` (sanitized CastError) instead of mongoose's text;
  never called by a client. Same for `:budgetHistoryId`.
- `previousPeriods` elements unchecked (develop); non-string-castable elements → CastError 400 from the filter.
- `ValidateNested({each: true})` on add-record's single `record` validates it as an object (class-validator ignores
  `each` on non-iterables); a missing `record` behaviour should be characterized in e2e, not assumed.
- Budget delete leaves expenses' `linkedBudgets` and their history entries until S7 implements the seam; the
  account-delete cascade (S5) still doesn't touch budgets (legacy; S7/S8).
- User delete doesn't cascade to budgets/history until S8 (plus S8's index script must add `{sub:1}` and the unique index;
  the unique build would fail only if duplicates appear before then).
- Manual runs on prod (D16): delete each created budget via `DELETE /budgets` (removes its history) before `DELETE /users`.

## Open questions

- **Q1 — module layout.** History POST now needs the budget model (owner check) and budget create/delete needs the
  history model, so two modules importing each other would cycle. Recommendation: one module `budget` registering both
  schemas, two controllers (`/budgets`, `/budget-history`), `BudgetService` + `BudgetHistoryService`; S7 imports it.
  Alternative: two modules with `forwardRef` (more code, no gain).
- **Q2 — `linkedBudgets` pull on budget delete.** Recommendation: a port (`Symbol` token, no-op default returning
  `void`) called inside the delete transaction with the session; S7 implements `$pull: {linkedBudgets: ObjectId}` on
  the user's expenses (and their history entries vanish with the history doc). Alternative: leave it out of S6 and let
  S7 edit the service.
- **Q3 — history POST rejections.** Recommendation: missing, foreign or non-ObjectId `budget` → 404 `'Budget not
  found'` (legacy text, the same status PUT/DELETE use for foreign budgets); a duplicate → the filter's 409
  `'Duplicate value'`. No client calls this route. Alternative: 400 for both (legacy's blanket wrap).
- **Q4 — `incrementBudgetAmount` on a missing/foreign budget.** Recommendation: return `null` (legacy semantics) and
  let S7 decide when it adds the `linkedBudgets` ownership check. Alternative: throw 404 `'Budget not found'` like
  `incrementBalance`, so S7 can't forget.
- **Q5 — `IsIn(['periodic','one-time'])` on `typeBudget`.** It is stricter than develop, so it is a contract change,
  though no client sends anything else (prod has only those two). No server rule reads `typeBudget`, so it protects
  nothing today. Recommendation: **don't add it**; keep develop's IsString+IsNotEmpty and revisit when a reset job
  uses the field. If added: create and PUT, class-validator's default message.
- **Q6 — delete when the history doc is missing.** Recommendation: keep develop's observable result: the budget (and
  the S7 seam) is deleted and committed, then 404 `'Budget history not found'` is returned; any other failure aborts
  everything. Alternatives: abort and 404 (budget becomes undeletable), or 200 with `budgetHistoryDeleted: null`
  (changes a documented 404 path).

## Assumptions

- Contract is develop = main for budgets; D8/D13 and the audit finding are the only intended deviations (plus Q3–Q6).
- `records` elements in prod have develop's shape (`recordId` string, …) with subdocument `_id`s; not checked.
- Legacy `populate('budget')` on the Mixed path returned the full budget doc; ours returns the full doc (incl. `sub`).
- FE_Budget_Master's requests are taken from `be-refactor-frontend-usage.md`; its source wasn't re-read.
- No new response fields besides `nextResetDate`/`previousPeriods` (no timestamps).
