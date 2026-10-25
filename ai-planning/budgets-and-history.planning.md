# Plan: S6 — budgets and budget history (`budgetmodels`, `budgethistorymodels`, 12 routes, helpers for S7)

**Status:** APPROVED (2026-10-25) — owner approved as written; run-all.

**Branch:** `feat/budgets-and-history` (stacked on `feat/accounts`, PR #7) · **Date:** 2026-10-25 · **Research:**
[`ai-research/budgets-and-history.research.md`](../ai-research/budgets-and-history.research.md)
· Memory: [`memories/repo/budgets-and-history-research.md`](../memories/repo/budgets-and-history-research.md),
[`memories/repo/budgets-and-history-planning.md`](../memories/repo/budgets-and-history-planning.md)

Owner decisions applied (`~/projects/notes/budget-master/be-refactor.md`):
- **E6.Q1–Q6** (as the research recommended): Q1 one module **`budget`** with both schemas, two controllers
  (`/budgets`, `/budget-history`), two services; S7 imports it. Q2 the `linkedBudgets` pull is a **port** (`Symbol`
  token, no-op default) called with the session inside the delete transaction. Q3 history POST with a
  missing/foreign/non-ObjectId `budget` → **404 `'Budget not found'`**, duplicate `{budget, sub}` → 409 `'Duplicate
  value'` (filter). Q4 `incrementBudgetAmount` on a missing/foreign budget returns **`null`**. Q5 **no `IsIn`** on
  `typeBudget`. Q6 budget delete with a missing history: **commit** the budget delete (+ port), **then** 404 `'Budget
  history not found'`. Also: `previousPeriods` uses **`default: undefined`** (old docs come back unchanged); empty
  `GET /budgets` stays `data: null`.
- D0 (develop = contract; old-next only calls `GET /budgets`), D6 (unexpected → 500 via the filters, legacy texts
  exact), D8 (persist `nextResetDate`/`previousPeriods`), D13 (fix `GET /budget-history/:id`), D16 (tests never touch
  prod; the manual run on prod deletes everything it creates).
- Security finding Medium "POST `/budget-history` accepts another user's budget" → Phase 3 (owner check before the
  write). The `linkedBudgets` Medium is S7's.

The contract tables, client usage and edge cases are in the research; this plan doesn't repeat them. AC numbers are
the research's AC1–AC5.

## Scope guard

**In:** the `budget` module (2 entities, constants, interface, 2 DTO files, 2 services + specs, 2 controllers), the 12
routes, the `BUDGET_EXPENSES_UNLINK` port with a no-op default, `incrementBudgetAmount` / `addHistoryRecord` /
`removeHistoryRecord` for S7, `test/budgets.e2e-spec.ts`, `ai-skills/REPO_CONTEXT.md`.

**Out (don't add):** `IsIn` on `typeBudget` (Q5), a period-reset job, the real `linkedBudgets` pull (S7), user-delete
cascade and the prod index script (S8), timestamps or other new response fields, `@nestjs/mapped-types`, response DTO
classes for raw docs, a shared e2e auth helper file, sorting.

## CLI note

Generate the module first, then services/controllers with `--flat` into it. Check generated relative imports end in
`.js`. The controller schematic writes `@Controller('budget')` / `@Controller('budget-history')`: change the first to
`@Controller('budgets')`.

## Mongoose gotcha (read before Phase 1)

`@Prop({ type: Types.ObjectId })` (the `Types` from `mongoose`) is exactly legacy's bug: it becomes **Mixed**. The
history `budget` path must be `@Prop({ type: mongoose.Schema.Types.ObjectId, ref: Budget.name, required: true })` so
string ids cast and match the 5 prod ObjectIds. A unit/e2e check below proves it (`schema.path('budget').instance ===
'ObjectId'`).

---

## Phase 1 — Module, both schemas, `POST` / `GET /budgets`, `GET /budgets/:budgetId`

**Changes**

1. `pnpm nest g mo budget` — creates `src/budget/budget.module.ts`, adds `BudgetModule` to `AppModule` (**verify**).
2. `src/budget/entities/budget.entity.ts` — create, like `account.entity.ts`:
   - `@Schema({ collection: 'budgetmodels', toJSON: { transform } })` class `Budget`, no timestamps, default `__v`.
   - Legacy paths and required-ness: `name` required, `description?`, `typeBudget` required, `startDate`/`endDate`
     `{ type: Date, required: true }`, `currentAmount`/`limit` required Number, `period?: string`, `isActive?: boolean`,
     `sub: { type: String, required: true }` (comment: all 5 prod docs are strings).
   - D8: `nextResetDate?: Date` (`type: Date`), `previousPeriods?: string[]` (`{ type: [String], default: undefined }`,
     comment: old docs stay without the key), and legacy's misspelt `nestResetDate?: Date` (`type: Date`, read-only:
     no DTO field writes it).
   - `toJSON.transform(doc, ret)`: when `ret.nextResetDate == null && ret.nestResetDate != null`, set
     `ret.nextResetDate = ret.nestResetDate`; return `ret`. `nestResetDate` stays in the output (develop returned it).
   - `BudgetSchema.index({ sub: 1 })` (test-only build; S8's script for prod). `export type BudgetDoc =
     HydratedDocument<Budget>`.
3. `src/budget/entities/budget-history.entity.ts` — create:
   - `@Schema({ collection: 'budgethistorymodels' })` class `BudgetHistory`.
   - `budget` per the gotcha above (ObjectId, ref `Budget.name`, required); `sub: { type: String, required: true }`;
     `records` with develop's inline element type verbatim (`recordId: String, recordName: String, recordAmount:
     Number, recordDate: Date, budgetCurrentAmount: Number, budgetUpdatedAmount: Number`; subdocs keep their `_id`).
   - `BudgetHistorySchema.index({ budget: 1, sub: 1 }, { unique: true })`. `BudgetHistoryDoc` type.
4. `src/budget/budget.constants.ts` — create: the 7 legacy constants and 3 inline texts listed in the research
   (`BUDGET_CREATED_MESSAGE` … `BUDGET_HISTORY_DELETED_MESSAGE`, plus `BUDGET_UPDATED_MESSAGE = 'Budget history
   updated'` with a "sic, develop" comment, `RECORD_ADDED_MESSAGE`, `RECORD_REMOVED_MESSAGE`), verbatim from
   `git -C ../be-budgt-master show origin/develop:src/budgets/budgets.constants.ts` and the history one.
5. `src/budget/dtos/budget.dto.ts` — create `CreateBudgetDto`: develop's fields, order and decorators (research
   §CreateBudgetsDto), all required, no `IsOptional`; dates `@Type(() => Date) @IsDate() @IsNotEmpty()`;
   `previousPeriods` `@IsArray()` only (elements unchecked, develop). No `IsIn` (Q5). No initializers.
6. `src/budget/budget.module.ts` — `MongooseModule.forFeature([{ name: Budget.name, schema: BudgetSchema }, { name:
   BudgetHistory.name, schema: BudgetHistorySchema }])`.
7. `pnpm nest g s budget/services/budget --flat` — `BudgetService` (`@InjectModel` both models, `@InjectConnection()`):
   - `createBudget(sub: string, dto: CreateBudgetDto)` — `connection.transaction(async (session) => …)`:
     `const [budget] = await budgetModel.create([{ ...dto, sub }], { session })`; `const [budgetHistory] = await
     historyModel.create([{ budget: budget._id, sub, records: [] }], { session })`; return both (created **inside**
     `fn`, so a retry makes fresh `_id`s). 201 `{ ...INITIAL_RESPONSE, message: BUDGET_CREATED_MESSAGE, data: { budget,
     budgetHistory } }`.
   - `findByUser(sub)` — `find({ sub }, { sub: 0 })`, no sort; `[]` → `{ ...INITIAL_RESPONSE, message:
     BUDGETS_NOT_FOUND_ERROR, data: null }`; else `data: { budgets }`.
   - `findOne(sub, budgetId)` — `findOne({ _id: budgetId, sub })` (no projection, `sub` included as develop); null →
     200 `message: BUDGET_NOT_FOUND_ERROR, data: null`; else `data: { budget }`. A non-ObjectId id → CastError → 400
     `'Invalid _id'` via the filter (no guard).
   - No try/catch (D6).
8. `pnpm nest g co budget/controllers/budget --flat --no-spec` — `@Controller('budgets')`, thin: `@Post()`, `@Get()`,
   `@Get(':budgetId')` (`@Param('budgetId')`), all pass `req.user.sub`.
9. `test/budgets.e2e-spec.ts` — create: `signupAndLogin()` copied from `test/accounts.e2e-spec.ts` (prefix
   `e2e-bud-`), `badRequest`/`unauthorized` helpers, a `budgetBody` fixture with all 11 fields (FE_Budget_Master shape:
   `nextResetDate = endDate`, `previousPeriods: []`), both models via `getModelToken`, and `await budgetModel.init();
   await historyModel.init();` in `beforeAll` (the unique index must exist before the first transaction).

**Edge cases**
- Dates arrive as ISO strings and are stored as `Date`s (`transform: true`); the response shows ISO strings.
- `previousPeriods: []` on create is stored and returned as `[]`; a raw-inserted old doc (no key) is returned without
  the key.
- Missing any of the 11 fields → 400 class-validator array, no doc in either collection.

**Test coverage**
- `budget.service.spec.ts` (models mocked, `connection = { transaction: vi.fn((fn) => fn(session)) }`): create calls
  both `create`s with the array form and `{ session }`, history gets `{ budget: <new _id>, sub, records: [] }`, response
  shape; `findByUser` uses `{ sub }` + `{ sub: 0 }`, empty → `data: null` + `'Budgets not found'`; `findOne` filter
  `{ _id, sub }`, null → `data: null` + `'Budget not found'`.
- e2e: no token → 401 (each route); POST → 201 exact envelope, `data.budget` incl. `sub`/`nextResetDate`/
  `previousPeriods`, `data.budgetHistory.records: []`, `budgetHistory.budget === budget._id`, DB history `budget` is
  an ObjectId (`historyModel.collection.findOne` → `instanceof Types.ObjectId`); missing `limit` → 400, 0 docs;
  `nextResetDate: 'not-a-date'` → 400; **atomicity**: `vi.spyOn(historyModel, 'create').mockRejectedValueOnce(new
  Error('boom'))` → 500 enveloped and 0 `budgetmodels` for that `sub` (silence `Logger.prototype.error`); GET fresh
  user → 200 `message: 'Budgets not found'`, `data: null`; GET lists own docs without `sub`, user B sees none; GET by id
  own → `data.budget` incl. `sub`; B's id / unused id → 200 `'Budget not found'`, `data: null`; `'abc'` → 400 `'Invalid
  _id'`; D8 fallback: raw `budgetModel.collection.insertOne` of an old doc with `nestResetDate` and no `nextResetDate`/
  `previousPeriods` → GET returns `nextResetDate` = that date and no `previousPeriods` key; a raw doc with both dates →
  `nextResetDate` wins.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none (the delete path comes in Phase 2; the prod run with clean-up is in Phase 3).

---

## Phase 2 — `PUT` / `DELETE /budgets`: owner-bound update, delete transaction with history + port (Q2, Q6)

**Changes**

1. `src/budget/budget.interface.ts` — create the port:
   ```ts
   export interface BudgetExpensesUnlink {
     unlinkBudget(args: { budgetId: string; sub: string; session: ClientSession }): Promise<void>;
   }
   ```
2. `src/budget/budget.constants.ts` — add `BUDGET_EXPENSES_UNLINK = Symbol('BUDGET_EXPENSES_UNLINK')`.
3. `src/budget/budget.module.ts` — `{ provide: BUDGET_EXPENSES_UNLINK, useValue: noExpensesUnlink }` (resolves
   `undefined`; comment: S7 replaces it without `BudgetModule` importing `RecordModule`, which imports this module).
4. `src/budget/dtos/budget.dto.ts` — add `UpdateBudgetDto` by hand: all 11 create fields `@IsOptional()` + their create
   decorators, then `budgetId` `@IsMongoId() @IsNotEmpty()`; `DeleteBudgetDto { budgetId }` `@IsMongoId()
   @IsNotEmpty()`.
5. `BudgetService` — inject `@Inject(BUDGET_EXPENSES_UNLINK) expensesUnlink`.
   - `updateBudget(sub, dto)` — `$set` from an 11-field allow-list (`UPDATABLE_FIELDS`, like `AccountService`),
     present and non-null only (never `budgetId`/`sub`/`nestResetDate`; `currentAmount: 0` kept);
     `findOneAndUpdate({ _id: dto.budgetId, sub }, { $set }, { returnDocument: 'after' })`; null → `NotFoundException(
     BUDGET_NOT_FOUND_ERROR)`; 200 `message: BUDGET_UPDATED_MESSAGE` (`'Budget history updated'`), `data: { budget }`.
   - `deleteBudget(sub, { budgetId })`:
     ```
     const result = await connection.transaction(async (session) => {
       budget = findOneAndDelete({ _id: budgetId, sub }, { session }); null → throw NotFound(BUDGET_NOT_FOUND_ERROR)
       await expensesUnlink.unlinkBudget({ budgetId, sub, session })
       budgetHistoryDeleted = historyModel.findOneAndDelete({ budget: budgetId, sub }, { session })
       return { budget, budgetHistoryDeleted }        // no throw on a missing history: let it commit
     });
     if (!result.budgetHistoryDeleted) throw new NotFoundException(BUDGET_HISTORY_NOT_FOUND_ERROR);   // Q6, after commit
     return 200 { message: BUDGET_DELETED_MESSAGE, data: result }
     ```
     Any other error inside `fn` (port, history delete) aborts everything.
6. `BudgetController` — `@Put()` / `@Delete()` with the id in the body (legacy).

**Edge cases**
- PUT with only `budgetId` → 200 unchanged doc. PUT with `previousPeriods` omitted (FE_Budget_Master) keeps the stored
  array. PUT `nextResetDate` on an old doc writes it; `nestResetDate` is untouched.
- PUT/DELETE foreign or unused id → 404 `'Budget not found'`; non-ObjectId → 400 `IsMongoId`.
- Q6: a budget whose history was deleted → DELETE answers 404 `'Budget history not found'`, but the budget is gone and
  the port ran; a second DELETE → 404 `'Budget not found'`.

**Test coverage**
- `budget.service.spec.ts`: update `$set` excludes `budgetId`/`sub`/null/absent, keeps 0, filter `{ _id, sub }`,
  `returnDocument: 'after'`, null → 404; delete: budget null → 404 and port/history not called; port gets `{ budgetId,
  sub, session }`; history filter `{ budget: budgetId, sub }` with session; history null → 404 history text **after**
  the transaction resolved (assert `transaction` resolved and the throw message); happy path shape.
- e2e: owner PUT (name + `currentAmount: 0` + `nextResetDate`) → 200 `'Budget history updated'` with new values;
  FE_Budget_Master edit shape (form fields + `budgetId`, no `previousPeriods`) → 200, array kept; B's PUT/DELETE → 404
  `'Budget not found'` and A's docs deep-equal before/after; unused id → 404; `sub` in body → 400; owner DELETE → 200
  `'Budget deleted'`, `data.budget` + `data.budgetHistoryDeleted`, 0 docs in both collections for that budget;
  port spy (`app.get(BUDGET_EXPENSES_UNLINK, { strict: false })`) sees `session.inTransaction() === true`; port rejects
  → 500, budget **and** history still there; `vi.spyOn(historyModel, 'findOneAndDelete').mockRejectedValueOnce(...)` →
  500, budget still there; Q6 path via a raw `historyModel.deleteOne` → 404 history text, `budgetmodels` count 0, port
  called once.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none here (Phase 3).

---

## Phase 3 — `/budget-history` (7 routes, D13, owner check), S7 helpers, docs, manual run on prod

**Changes**

1. `src/budget/dtos/budget-history.dto.ts` — create, develop's decorators (research §History DTOs): `RecordsHistoryDto`,
   `CreateBudgetHistoryDto { budget: IsString+IsNotEmpty; records: IsArray+ValidateNested({ each: true })+Type }`,
   `UpdateBudgetHistoryDto` (hand-written Partial: `budget?`, `records?` with the same decorators + `IsOptional`, then
   `budgetHistoryId` IsMongoId), `DeleteBudgetHistoryDto { budgetHistoryId }`, `AddRecordToBudgetHistoryDto { budgetId:
   IsMongoId+IsNotEmpty; record: ValidateNested({ each: true })+Type }`, `RemoveRecordFromBudgetHistoryDto { budgetId,
   record: IsMongoId }`.
2. `pnpm nest g s budget/services/budget-history --flat` — `BudgetHistoryService` (both models). No try/catch.
   - `createHistory(sub, { budget, records })` — audit Medium / Q3: `!isValidObjectId(budget)` or `!(await
     budgetModel.exists({ _id: budget, sub }))` → `NotFoundException(BUDGET_NOT_FOUND_ERROR)`, no write; then
     `historyModel.create({ budget, sub, records })` (E11000 → 409 by the filter). 201 `BUDGET_HISTORY_CREATED`,
     `data: { budgetHistory }`.
   - `findByUser(sub)` — `find({ sub }, { sub: 0 }).populate('budget')`; `[]` → `NotFoundException(
     BUDGET_HISTORY_NOT_FOUND_ERROR)`; else 200 `data: { budgetsHistory }`.
   - `findOne(sub, budgetHistoryId)` — D13: `findOne({ _id, sub }).populate('budget')` (no projection, as develop's
     intended query); null → 404 history text; CastError → 400 `'Invalid _id'`.
   - `updateHistory(sub, dto)` — `$set: { records }` only when `records` is present (`budget` ignored, no repointing);
     `findOneAndUpdate({ _id: budgetHistoryId, sub }, { $set }, { returnDocument: 'after' })`; null → 404; 200
     `'Budget history updated'`.
   - `deleteHistory(sub, { budgetHistoryId })` — `findOneAndDelete({ _id, sub })`; null → 404; 200
     `BUDGET_HISTORY_DELETED_MESSAGE`.
   - `addHistoryRecord({ budgetId, sub, record, session }: { …; session?: ClientSession }): Promise<BudgetHistoryDoc>` —
     invalid id → `BadRequestException(BUDGET_HISTORY_NOT_FOUND_ERROR)` without a query; `findOneAndUpdate({ budget:
     budgetId, sub }, { $push: { records: record } }, { session, returnDocument: 'after' })`; null → same 400.
   - `removeHistoryRecord({ budgetId, sub, recordId, session })` — same guard; `$pull: { records: { recordId } }`; null
     → 400. Unknown `recordId` → doc unchanged.
   - Thin wrappers for the HTTP routes: `addRecord(sub, dto)` → 201 `RECORD_ADDED_MESSAGE`, `data: { budgetHistory }`;
     `removeRecord(sub, dto)` → 201 `RECORD_REMOVED_MESSAGE` (no session).
3. `BudgetService.incrementBudgetAmount({ budgetId, sub, delta, session }: { budgetId: string; sub: string; delta:
   number; session: ClientSession }): Promise<{ budgetCurrentAmount: number; budgetUpdatedAmount: number } | null>` —
   invalid id → `null` without a query; `findOneAndUpdate({ _id: budgetId, sub }, { $inc: { currentAmount: delta } },
   { session, returnDocument: 'before' })`; null → `null` (Q4); else `{ budgetCurrentAmount: before.currentAmount,
   budgetUpdatedAmount: before.currentAmount + delta }` (Mongo's `$inc` is the same IEEE addition, so this equals the
   stored value; these are the two history-entry fields S7 writes).
4. `pnpm nest g co budget/controllers/budget-history --flat --no-spec` — `@Controller('budget-history')`, thin:
   `@Post()`, `@Post('add-record')`, `@Post('delete-record')`, `@Get()`, `@Get(':budgetHistoryId')`, `@Put()`,
   `@Delete()`.
5. `src/budget/budget.module.ts` — `exports: [BudgetService, BudgetHistoryService]` (comment: S7 uses
   `incrementBudgetAmount`, `addHistoryRecord`, `removeHistoryRecord`, and provides `BUDGET_EXPENSES_UNLINK`).
6. `ai-skills/REPO_CONTEXT.md` — Overview (S6), tree (`budget/`, `test/budgets.e2e-spec.ts`), the 12 routes in the
   route table (incl. the odd statuses/texts: PUT `'Budget history updated'`, empty `GET /budget-history` 404,
   add/delete-record 400, Q3/Q6), a line on `BUDGET_EXPENSES_UNLINK`, a note that the unique `{budget, sub}` index
   exists only under test until S8, and drop "budgets" from the "does not exist yet" line.

**Edge cases**
- History POST: foreign budget, unused id, `'abc'` → all 404 `'Budget not found'`, 0 new history docs. Duplicate for
  an own budget (create already made one) → 409 `'Duplicate value'` **only where the unique index exists** (tests);
  prod has no index until S8 (see Assumptions).
- add-record without `record`: characterize (expected 400 `ValidateNested` message, no write). If validation lets it
  through, the service must not `$push` `undefined`: treat as an implementation bug, not a contract.
- delete-record with an unknown `record` → 201, `records` unchanged. Both routes on a foreign `budgetId` → 400
  `'Budget history not found'`, owner's doc unchanged.
- PUT history with `budget: <other id>` → 200 and `budget` unchanged; with only `budgetHistoryId` → 200 unchanged.
- Populated `budget` in GETs shows the D8 fallback (Phase 1 transform). If mongoose doesn't apply the child schema's
  `toJSON` transform to populated docs, move the fallback into a `BudgetSchema.post('init')` hook instead.
- A history whose budget was deleted raw → populated `budget: null` (develop did the same).

**Test coverage**
- `budget-history.service.spec.ts` (models mocked): create guard order (bad id → 404 no query; `exists` null → 404 no
  `create`); filters `{ _id, sub }` / `{ budget, sub }`; list empty → 404; `findOne` null → 404; update `$set` has only
  `records`, never `budget`; add/remove use `$push` / `$pull: { records: { recordId } }`, forward the session, null or
  bad id → 400 history text.
- `budget.service.spec.ts`: `incrementBudgetAmount` filter, `$inc`, session, `returnDocument: 'before'`, returns the
  two amounts; null / bad id → `null` without throwing.
- e2e: each of the 7 routes 401 without a token; POST own budget (after `DELETE /budget-history` of the auto doc) → 201;
  POST foreign / unused / `'abc'` → 404, `countDocuments` unchanged; duplicate → 409; add-record → 201 with the record
  (subdoc `_id`, `recordDate` a date), delete-record by `recordId` → 201 without it, unknown id → 201 unchanged; B's
  add/delete-record on A's budget → 400 and A's doc unchanged; GET empty user → 404; GET lists own with populated
  `budget` and no `sub`; D13: GET by id own → 200 populated, B's → 404, `'abc'` → 400; PUT replaces `records`, ignores
  `budget`; B's PUT/DELETE → 404; DELETE → 200. S7 helpers (via `app.get`, inside `connection.transaction`):
  `incrementBudgetAmount` with A's sub `+12.5` → `{ budgetCurrentAmount, budgetUpdatedAmount }` and DB matches, B's sub
  → `null` and DB unchanged, increment-then-throw → DB unchanged; `addHistoryRecord` then throw → no record; B's sub →
  400. Schema check: `historyModel.schema.path('budget').instance === 'ObjectId'`.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e` (CI repeats e2e on the docker replica set).
- Manual (orchestrator, `pnpm run start:dev` on the owner's `.env` = **prod DB**, D16). **Creates one `users` doc, two
  `budgetmodels` docs and their two auto history docs, and deletes all of them in this phase.** Never touch the 5
  existing prod budgets; never send a duplicate history POST (no unique index on prod: it would create a doc). `TS=$(date
  +%s)`, `EMAIL=e2e-manual-$TS@example.invalid`, throwaway password, base `localhost:3000`, JSON bodies.
  1. `POST /users` `{email, password, firstName:'Manual', lastName:'Check', middleName:''}` → 201; keep
     `SUB=data.userCreated.sub`.
  2. `POST /auth/` → 201; `TOKEN` = `set-cookie[0]` value (between the first `=` and `;`). Send `Authorization: Bearer
     $TOKEN` below.
  3. `GET /budgets` → 200 `message:'Budgets not found'`, `data: null`. `GET /budget-history` → 404 `'Budget history not
     found'`.
  4. `POST /budgets` with all 11 fields (`name:'Manual A'`, `typeBudget:'periodic'`, `period:'weekly'`, `currentAmount:0`,
     `limit:500`, ISO dates, `nextResetDate = endDate`, `previousPeriods: []`) → 201 `'New budget created'`; keep
     `A=data.budget._id`, `HA=data.budgetHistory._id`. Same with `name:'Manual B'` → keep `B`, `HB`.
  5. `GET /budgets` → exactly 2, no `sub`; `GET /budgets/$A` → `data.budget` incl. `sub == SUB`.
  6. `PUT /budgets` `{budgetId: A, name:'Manual A2', limit: 600}` → 200 `'Budget history updated'`, new values,
     `previousPeriods: []` kept.
  7. `POST /budget-history` `{budget:'000000000000000000000000', records: []}` → 404 `'Budget not found'` (no write).
  8. `POST /budget-history/add-record` `{budgetId: A, record:{recordId:'manual-1', recordName:'Manual', recordDate:<ISO>,
     recordAmount:10, budgetCurrentAmount:0, budgetUpdatedAmount:10}}` → 201 with 1 record; `GET /budget-history/$HA`
     → 200 populated `budget` (D13); `POST /budget-history/delete-record` `{budgetId: A, record:<a valid ObjectId not in
     the doc>}` → 201 unchanged. (The `recordId` here is a string, not an ObjectId, so `delete-record` can't target it
     by the DTO's `IsMongoId`; the history doc is removed by step 9 anyway.)
  9. **Clean-up (before the user):** `DELETE /budgets` `{budgetId: A}` → 200 `'Budget deleted'` with
     `budgetHistoryDeleted._id == HA`. Q6 path: `DELETE /budget-history` `{budgetHistoryId: HB}` → 200, then `DELETE
     /budgets` `{budgetId: B}` → 404 `'Budget history not found'`, then `GET /budgets/$B` → `'Budget not found'`
     (budget gone). Then `GET /budgets` → `'Budgets not found'`, `data: null` and `GET /budget-history` → 404 (**0
     leftovers for `SUB`**, while the token works). Only then `DELETE /users` → 200, and `GET /budgets` with the same
     token → 401.
  - On any failure after step 1, jump to step 9 with the current token (ids from `GET /budgets` / `GET
    /budget-history`; a budget whose history is gone still deletes via `DELETE /budgets`, answering 404). The
    orchestrator's independent check: read-only `countDocuments({ sub: SUB })` on `budgetmodels` **and**
    `budgethistorymodels` against the prod URI = 0 each, and `budgetmodels` total still 5; if not, delete leftovers by
    `sub` with the owner's OK. Report `SUB` and the counts.

---

## AC Coverage Summary

| AC | Phase(s) | Automatic / manual | Coverage |
|---|---|---|---|
| AC1 — 12 routes: develop's status, envelope, `message`, `data` keys, incl. `data: null` empties, PUT text, 404 paths | 1, 2, 3 (+3 manual) | both (e2e per route and error; manual 3–9) | full (duplicate 409 is e2e-only, by design on prod) |
| AC2 — D8 persist/PUT/`nestResetDate` fallback; D13 own/foreign/missing | 1 (D8 create + fallback), 2 (PUT), 3 (D13, populated fallback) | both (e2e incl. raw old docs; manual 4, 6, 8) | full |
| AC3 — create atomic; delete atomic with history + seam; history POST missing/foreign writes nothing | 1 (create), 2 (delete, Q6), 3 (POST owner check) | both (e2e one-shot failing spies → 0 docs; manual 7, 9) | full (foreign-user cases e2e-only on prod) |
| AC4 — owner-bound `$inc` / `$push` / `$pull` helpers running in a caller's session | 3 | automatic (unit + e2e incl. rollback and foreign sub) | full (real callers are S7) |
| AC5 — unit tests for every service rule; e2e for 12 routes, cross-user, atomicity, D8, D13 | 1, 2, 3 | automatic | full |

## Decisions (beyond the research)

- Module/model names: module `budget`, classes `Budget` / `BudgetHistory` pinned to `budgetmodels` /
  `budgethistorymodels`; one constants file and one interface file for both.
- D8 fallback is a `toJSON` transform on `BudgetSchema` (applies to every response and the populated `budget`);
  `nestResetDate` is declared read-only and kept in output as develop returned it. Fallback to a `post('init')` hook only
  if populated docs skip the transform.
- Port name `BUDGET_EXPENSES_UNLINK` / `unlinkBudget({ budgetId, sub, session }): Promise<void>`, called after the
  budget delete and before the history delete, inside the transaction.
- Q6 is implemented by returning the missing history from `fn` and throwing the 404 after the commit.
- `incrementBudgetAmount` uses `returnDocument: 'before'` and returns `{ budgetCurrentAmount, budgetUpdatedAmount } |
  null` (the two history-entry numbers S7 needs) instead of develop's `{ oldBudget, updatedBudget, message }`.
- `addHistoryRecord` / `removeHistoryRecord` take an optional session (the HTTP routes reuse them without one); a
  non-ObjectId `budgetId` → 400 `'Budget history not found'` without a query.
- PUT `/budgets` allow-list excludes `nestResetDate`; PUT `/budget-history` `$set`s only `records`.
- No null-dropping on create (every create field is required and none accepts `null`); PUT drops `null` like S5.
- No transaction on history POST: check-then-insert can leave an orphan history if the budget is deleted in between
  (a snapshot transaction wouldn't prevent it either); accepted, no client calls the route.
- The manual run covers Q6 on prod with a second throwaway budget, and never sends a duplicate history POST.

## Assumptions

- Research assumptions accepted (develop = contract; no new response fields besides D8; `records` elements in prod have
  develop's shape).
- **Prod has no unique `{budget, sub}` index until S8's script** (`autoIndex` off): until then a duplicate history POST
  on prod creates a second doc (as develop did), and budget delete removes only one. No client calls the route; S8's
  index build must check for duplicates first.
- `ValidateNested({ each: true })` on a single object validates it as an object (research); e2e characterizes the
  missing-`record` case.
- Express non-strict routing makes `/budgets/` match `/budgets`; Atlas supports transactions.

## Implementation checklist

- [x] Phase 1 — module (CLI, `AppModule` verified), both entities (ObjectId `budget`, D8 fields, transform, indexes),
  constants, create DTO, `createBudget` (transaction) / `findByUser` / `findOne` + spec, controller (`budget` →
  `budgets`), e2e incl. create atomicity and D8 fallback
- [x] Phase 2 — port interface + token + no-op default, update/delete DTOs, `updateBudget`, `deleteBudget` (transaction,
  Q6) + spec, PUT/DELETE routes, e2e cross-user / port wiring / rollback / Q6
- [x] Phase 3 — history DTOs, `BudgetHistoryService` (7 routes, owner check, D13, `$push`/`$pull` helpers) + spec,
  `incrementBudgetAmount` + spec, history controller, exports, e2e; `REPO_CONTEXT.md`
- [x] Automatic: `pnpm run lint`, `pnpm run build`, `pnpm test`, `pnpm run test:e2e`
- [ ] Phase 3 manual run on the prod DB — orchestrator (steps 1–9 + leftover counts). Not run by the implementer
  (no `.env`, never touch prod); the same flow passed on `node dist/main.js` against a local in-memory replica set.

**Implementation notes (deviations):**
- `AddRecordToBudgetHistoryDto.record` got `@IsDefined()`: e2e showed a missing `record` passed validation (201). Now
  400 `['record should not be null or undefined']`, no write (the plan's "implementation bug" branch).
- D8 `toJSON` transform applies to populated `budget` (e2e-proven); the `post('init')` fallback was not needed.
- History-delete failure e2e uses a one-shot sync throw from `historyModel.findOneAndDelete` (it returns a Query, so
  `mockRejectedValueOnce` doesn't fit); same effect: 500, budget kept.
- All CLI generation (incl. Phase 3's history service/controller) ran up front; run-all, no behaviour change.
- PUT `/budget-history` reuses `BUDGET_UPDATED_MESSAGE` (same text) instead of a second constant.
