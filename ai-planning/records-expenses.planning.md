# Plan: S7a — records-expenses (`record` module, `createexpenses`, `/expenses-actions`, budget unlink port)

**Status:** APPROVED (2026-10-25) by the owner as written, including the 404 for an amount/account edit on a record
whose stored account belongs to another user. Run-all.

**Branch:** `feat/records-expenses` (stacked on `feat/budgets-and-history`, PR #8) · **Date:** 2026-10-25 · **Research:**
[`ai-research/records.research.md`](../ai-research/records.research.md) (S7a scope; §3, §4, §5.1, §5.2, §6, §8 are the
spec) · Memory: [`memories/repo/records-research.md`](../memories/repo/records-research.md),
[`memories/repo/records-expenses-planning.md`](../memories/repo/records-expenses-planning.md)

Owner decisions applied (`~/projects/notes/budget-master/be-refactor.md`, row **E7.Q1–Q10**). All are the research's
recommendations except Q9:
- Q1 one `record` module shared by S7a/b/c. Q2 `RecordModule` is `@Global()` and provides the real port; the
  `useValue` default leaves `BudgetModule` in this story (the `AccountModule` default leaves it in S7b). Q3 month
  `Jan`..`Dec` exactly and year `/^\d{4}$/`, anything else → legacy's 200 empty answer. Q4 `category` is Mixed + `ref`.
  Q5 bug 8 fixed (removed budgets lose the **old** amount; kept budgets move by `new − old` and get their history entry
  replaced). Q7 `IndebtedPeople` takes an optional `_id`. Q10 a delete whose account is missing or foreign → 404, the
  record is kept. Q6/Q8 are S7b's.
- **Q9 (owner override):** on PUT, ownership of `category`, `account` and `linkedBudgets` is checked **only when the
  edit changes that field**. An unchanged foreign or missing category/account/budget is not checked (5 prod records
  have a foreign category or account and must stay editable).
- D2 (`account` is a string, `category` mixed), D6 (unknown → 500), D9 (one-sided edits, safe to repeat), D10
  (`message: string[]` texts are free), D11 (`Jan`..`Dec` + 4 digits), D16 (tests never touch prod; the manual run
  deletes all it creates).
- Security findings fixed here: High "PUT repoints `account`" (Phase 3) and Medium "foreign `linkedBudgets`" (Phases
  2 and 3). The `expensesPaid` Medium is S7b's.

AC numbers are S7a's AC1–AC5 (research §1). This plan doesn't repeat the contract tables; it links to the research.

## Scope guard

**In:** `src/record/` (module, shared record base entity + expense schema, constants, interface, utils + spec, record
and expense DTOs, `ExpenseService` + spec, `RecordPortsService` + spec, `ExpenseController`), the 4
`/expenses-actions` routes, the real `BUDGET_EXPENSES_UNLINK`, removing its default from `BudgetModule`,
`test/records-expenses.e2e-spec.ts`, `ai-skills/REPO_CONTEXT.md`.

**Out (don't add):** the income schema, `/incomes-actions`, `expensesPaid`, the real `ACCOUNT_RECORDS_CASCADE` and
removing the `AccountModule` default (S7b); `/records/transfer` and `/records/expenses-and-incomes` (S7c); sorting the
expenses listing (legacy is unsorted); a transfer edit/delete route (D9); validation of `typeOfRecord` on PUT (legacy
doesn't check it, old-next sends `'transfer'`); timestamps or new response fields; `@nestjs/mapped-types`; the prod
index script (S8).

## Design for S7b/S7c (no rework later)

- One module `record`; one controller per legacy route group (`expense.controller.ts` now, `income.controller.ts` in
  S7b, `record.controller.ts` in S7c); one service per record kind (`ExpenseService` now, `IncomeService` in S7b).
- `entities/record.entity.ts` holds the shared `AccountRecord` base class (no schema of its own); `Expense` extends it.
  S7b's `Income` extends it too, and the two schemas keep `isPaid` / `expensesPaid` apart (research §2).
- `dtos/record.dto.ts` holds `CreateRecordDto`, `UpdateRecordDto`, `IndebtedPeopleDto`, `TransferRecordDto`,
  `DeleteRecordDto`; `dtos/expense.dto.ts` extends them. S7b adds `dtos/income.dto.ts`.
- `RecordPortsService` implements the ports and depends **only on record models** (never on `BudgetService` /
  `AccountService`, see Phase 1 "DI"). S7b adds `deleteAccountRecords` to it and binds `ACCOUNT_RECORDS_CASCADE` the
  same way.
- `record.utils.ts` (date shift, `fullDate`/`formattedTime`, currency, month bounds) is shared by all three stories.
- `ExpenseService` keeps the balance and budget steps in small private helpers (`applyBudgetLinks`, …) taking the
  session, so S7c's transfer create can call the expense-side write path with its own session.

## CLI note

Generate the module first, then services/controllers with `--flat` into it, and check generated relative imports end
in `.js`. Change the controller schematic's `@Controller('expense')` to `@Controller('expenses-actions')`.

```bash
pnpm nest g mo record                                   # registers RecordModule in AppModule (verify)
pnpm nest g s record/services/expense --flat
pnpm nest g s record/services/record-ports --flat
pnpm nest g co record/controllers/expense --flat --no-spec
```

---

## Phase 1 — Module, schema, utils, budget unlink port, `GET /expenses-actions/:accountId/:month/:year`

**Changes**

1. CLI: the 4 commands above (run all up front; Phases 2–3 fill the services and controller). Verify `RecordModule`
   in `src/app.module.ts` imports (after `BudgetModule`).
2. `src/record/record.constants.ts` — create. Legacy texts verbatim (`domain/records/constants/index.ts`,
   `repositories/expenses/expenses.constants.ts`): `TYPE_OF_RECORD_INVALID = 'Invalid type of record'` (the records
   one, not expenses' `'… for expense'`), `TRANSFER_RECORD_LINKED_BUDGET_ERROR`, `MAXIMUM_BUDGETS_LIMIT_ERROR`,
   `EXPENSE_NOT_FOUND = 'Expense not found.'`, `EXPENSES_NOT_FOUND = 'Expenses not found.'`,
   `EXPENSE_UNAUTHORIZED_ERROR = 'This expense does not belongs to the user'`, `MISSING_DATE`, `MISSING_CATEGORY`,
   `MISSING_AMOUNT`, `MISSING_LINKED_BUDGETS`, `EXPENSE_CREATED_MESSAGE = 'Expense created'`,
   `EXPENSE_DELETED_MESSAGE = 'Expense deleted'`; `MAX_LINKED_BUDGETS = 3`; `MEXICO_CITY_TZ = 'America/Mexico_City'`;
   `ABBREVIATED_MONTHS = ['Jan', …, 'Dec']` (route param), `FULL_DATE_WEEKDAYS` (`Dom Lun Mar Mie Jue Vie Sab`),
   `FULL_DATE_MONTHS` (`Ene … Ago Sept Oct Nov Dic`); `CATEGORY_POPULATE = { path: 'category', select: '_id
   categoryName icon' }`.
3. `src/record/record.utils.ts` — create (pure functions, no `process.env`):
   - `toMexicoCityWallClock(date: Date): Date` — `Intl.DateTimeFormat('en-US', { timeZone: MEXICO_CITY_TZ, hourCycle:
     'h23', year/month/day/hour/minute/second: 'numeric' }).formatToParts(date)` → `new Date(Date.UTC(y, m − 1, d, h,
     min, s))`. Milliseconds dropped (legacy). Never the `toLocaleString` re-parse (research §4). Build the formatter once
     at module scope.
   - `formatDateToString(date: Date): { fullDate: string; formattedTime: string }` — UTC getters only (`getUTCMinutes`
     too), no day padding, `HH:MM` + `am` if hour ≤ 11 else `pm`.
   - `formatNumberToCurrency(amount: number): string` — `Intl.NumberFormat('en-US', { style: 'currency', currency:
     'USD', minimumFractionDigits: 2 })`, module-scope formatter.
   - `getMonthBounds(month: string, year: string): { startDate: Date; endDate: Date } | null` — `null` unless
     `ABBREVIATED_MONTHS.indexOf(month) >= 0` and `/^\d{4}$/.test(year)`; else `[Date.UTC(y, m, 1), Date.UTC(y, m + 1,
     1))` (December rolls to next January through `Date.UTC`).
4. `src/record/record.utils.spec.ts` — create (see coverage).
5. `src/record/entities/record.entity.ts` — create the `AccountRecord` base class (no `@Schema`, research §2 types):
   `userId` String required; `shortName`, `typeOfRecord`, `amountFormatted`, `fullDate`, `formattedTime`,
   `subCategory` String required; `description` String; `amount` Number required; `date` Date (**not** required);
   `category` `{ type: mongoose.Schema.Types.Mixed, ref: Category.name, required: true }` (Q4; the stored type stays
   what was written, both populate); `tag: [String]`; `indebtedPeople` subdoc array `{ name: String, amount: Number,
   amountPaid: Number, isPaid: Boolean }` (keeps `_id`); `transferRecord` nested `raw({ transferId: String, account:
   String })`, optional; `account` **String** required, no `ref` (D2, never populated); `budgets: [String]`.
6. `src/record/entities/expense.entity.ts` — create `@Schema({ collection: 'createexpenses' }) class Expense extends
   AccountRecord` with `isPaid` Boolean required and `linkedBudgets` `[{ type: mongoose.Schema.Types.ObjectId, ref:
   Budget.name }]` (**`mongoose.Schema.Types.ObjectId`**, not mongoose's `Types.ObjectId` class, which makes it Mixed;
   S6 planning memory). No `default` (545 old docs lack the key; lean reads keep that). No timestamps. `ExpenseSchema
   .index({ userId: 1, account: 1, date: -1 })` (test-only build; S8's script for prod). `export type ExpenseDoc =
   HydratedDocument<Expense>`.
7. `src/record/record.module.ts` — `@Global() @Module({ imports: [MongooseModule.forFeature([{ name: Expense.name,
   schema: ExpenseSchema }]), AccountModule, BudgetModule, CategoryModule], providers: [ExpenseService,
   RecordPortsService, { provide: BUDGET_EXPENSES_UNLINK, useExisting: RecordPortsService }], exports:
   [BUDGET_EXPENSES_UNLINK], controllers: [ExpenseController] })`. One-line comment: global so `BudgetModule` resolves the
   port without importing this module (E7.Q2).
8. `src/record/services/record-ports.service.ts` — `RecordPortsService implements BudgetExpensesUnlink`, injects
   **only** the `Expense` model. `unlinkBudget({ budgetId, sub, session })` → `expenseModel.updateMany({ userId: sub,
   linkedBudgets: budgetId }, { $pull: { linkedBudgets: budgetId } }, { session })`. Only the owner's expenses (AC4).
9. `src/budget/budget.module.ts` — delete `noExpensesUnlink`, its `useValue` provider and the "S7 replaces this
   default" comment; drop the now-unused imports. Fix the `exports` comment (the port is provided by `RecordModule`).
   `BudgetService` is unchanged. `budget.service.spec.ts` already stubs the token.
10. `src/record/services/expense.service.ts` — inject `Expense` model, `@InjectConnection() connection`,
    `AccountService`, `CategoryService`, `BudgetService`, `BudgetHistoryService`. In this phase only
    `findByAccountAndMonth({ sub, accountId, month, year }): Promise<GeneralResponse>`:
    - `bounds = getMonthBounds(month, year)`; `null` → return `{ ...INITIAL_RESPONSE, message: EXPENSES_NOT_FOUND, data:
      { expenses: [] } }` (Q3, no query).
    - `find({ userId: sub, account: accountId, typeOfRecord: 'expense', date: { $gte, $lt } }).populate(
      CATEGORY_POPULATE).populate('linkedBudgets').lean().exec()`. Lean keeps the stored keys (no `linkedBudgets: []`
      added, `indebtedPeople[]._id` kept), as legacy's aggregate. No sort. No `verifyExpensesBelongsToUser` (the filter
      already has `userId`).
    - `[]` → same empty answer; else `{ ...INITIAL_RESPONSE, data: { expenses } }` (`message: null`).
11. `src/record/controllers/expense.controller.ts` — `@Controller('expenses-actions')`; `@Get(':accountId/:month/:year')`
    with three `@Param`s + `@Req() req: AuthenticatedRequest` → `findByAccountAndMonth({ sub: req.user.sub, … })`.
    Thin, like `AccountController`.

**DI (non-obvious):** `BudgetService` injects `BUDGET_EXPENSES_UNLINK` and `RecordModule` imports `BudgetModule`. The
port provider must therefore not depend on `BudgetService` (directly or through `ExpenseService`), or Nest hits a
provider cycle. That's why it is a separate `RecordPortsService` bound with `useExisting`. `app.get(BUDGET_EXPENSES_UNLINK,
{ strict: false })` returns that instance, so `test/budgets.e2e-spec.ts`' spies keep working. If Nest still reports a
cycle at boot, stop and report (don't add `forwardRef`).

**Edge cases**
- Non-ObjectId or foreign `accountId` → 200 empty (`account` is a String path, so no CastError).
- `Feb`/`2025` and `Dec`/`2025` bounds; `jan`, `January`, `13`, `25`, `20250` → empty, no query.
- An ObjectId `category` and a string `category` both populate to `{ _id, categoryName, icon }`; a missing category
  populates to `null`; missing budget ids are dropped from `linkedBudgets`.
- Transfers (`typeOfRecord: 'transfer'`) and other users' docs on the same account string are not listed.

**Test coverage**
- Unit `record.utils.spec.ts`: research §4 golden vectors (`2025-02-03T20:05:30.123Z` → `2025-02-03T14:05:30.000Z`,
  `'Lun, 3 Feb, 2025'`, `'14:05pm'`; `2025-03-01T03:30:00Z` → `2025-02-28T21:30:00.000Z`, `'Vie, 28 Feb, 2025'`,
  `'21:30pm'`; `2026-10-25T06:00:00Z` → `2026-10-25T00:00:00.000Z`, `'Dom, 25 Oct, 2026'`, `'00:00am'`), the DST-era
  `2022-07-01T05:30Z` → `00:30`, ms truncation, same results with `process.env.TZ` set to `America/Mexico_City` and
  `Asia/Tokyo` at runtime (restore after); `'Sept'` for September; currency `1234.5` → `$1,234.50`, `-5` → `-$5.00`,
  `0.125`-style rounding → `$0.13`, `0` → `$0.00`; month bounds incl. `Dec` roll-over and every rejected input.
- Unit `record-ports.service.spec.ts`: `updateMany` called with the owner filter, the `$pull` and `{ session }`.
- Unit `expense.service.spec.ts` (listing): bad month/year → empty answer without calling `find`; empty result → same;
  non-empty → `message: null`; the filter has `userId`, `account` string, `typeOfRecord: 'expense'`, UTC bounds.
- e2e `test/records-expenses.e2e-spec.ts` (new; `await expenseModel.init()` in `beforeAll`; signup/login + account,
  category, budget helpers like the existing specs; seed docs with `expenseModel.collection.insertOne` to keep legacy
  shapes): 401 without a token on all 4 routes; seeded legacy expense (string `account`, **ObjectId** `category`, no
  `linkedBudgets` key) and a new-shape one (string `category`, `linkedBudgets: [budget, missing id]`) in the same
  month are listed with populated category, full budget docs (missing id dropped) and no `linkedBudgets` key on the
  legacy one; a transfer, an out-of-month doc, another user's doc on the same account string are not listed; `jan` /
  `2025a` / unknown account → 200 `'Expenses not found.'`, `data: { expenses: [] }`. **AC4:** two of A's expenses and
  one of B's linked to A's budget id (seeded), `DELETE /budgets` → A's expenses no longer have it (other ids kept), B's
  untouched; a one-shot failing history delete (as in `budgets.e2e-spec.ts`) → 500 and the links are still there.
  Schema checks: `schema.path('linkedBudgets').caster.instance === 'ObjectId'`, `schema.path('category').instance ===
  'Mixed'`, `schema.path('account').instance === 'String'`.
- `test/budgets.e2e-spec.ts` keeps passing unchanged (port spies, rollback).

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none (no route here creates data; the prod run is in Phase 3).

---

## Phase 2 — `POST` and `DELETE /expenses-actions` (balance + linked budgets, one transaction each)

**Changes**

1. `src/record/dtos/record.dto.ts` — create (develop's `records.dto.ts` decorators and order, research §3 DTOs):
   - `IndebtedPeopleDto { name, amount, amountPaid, isPaid: IsNotEmpty only; _id?: IsOptional + IsMongoId }` (Q7).
   - `TransferRecordDto { transferId, account: IsNotEmpty }`.
   - `CreateRecordDto`: `shortName` IsString+IsNotEmpty · `typeOfRecord` IsString+IsNotEmpty · `description` IsString ·
     `amount` IsNumber+IsNotEmpty · `date` IsDate+`@Type(() => Date)`+IsNotEmpty · `category` IsMongoId+IsNotEmpty ·
     `subCategory` IsString+IsNotEmpty · `tag` IsArray · `indebtedPeople` ValidateNested+`Type(IndebtedPeopleDto)` ·
     `transferRecord` ValidateNested+`Type(TransferRecordDto)` · `account` IsMongoId+IsNotEmpty · `budgets` IsArray.
     No `IsOptional` on the two nested fields (omitted passes, `null` → 400, as develop).
   - `UpdateRecordDto` — hand-written partial: every field above with `@IsOptional()` + the same decorators (like
     `UpdateAccountDto`), then `recordId` IsMongoId+IsNotEmpty.
   - `DeleteRecordDto { recordId: IsMongoId + IsNotEmpty }`.
2. `src/record/dtos/expense.dto.ts` — `CreateExpenseDto extends CreateRecordDto { isPaid: IsBoolean; linkedBudgets:
   IsArray + IsMongoId({ each: true }) }` (research §14: a bad element was a CastError 400 in legacy).
   `UpdateExpenseDto extends UpdateRecordDto` with both fields `IsOptional`. `DeleteExpenseDto = DeleteRecordDto` (alias
   or re-export, no new class).
3. `src/record/record.interface.ts` — create only the types the service needs that no DTO/entity gives (e.g. the
   `{ messages, expense }` result of the transaction fn). No `any`.
4. `ExpenseService.createExpense(sub, dto): Promise<GeneralResponse>`:
   ```
   // pure checks, develop's order (no DB):
   dto.linkedBudgets.length > 0 && typeOfRecord === 'transfer' → 400 TRANSFER_RECORD_LINKED_BUDGET_ERROR
   typeOfRecord !== 'expense'                                  → 400 TYPE_OF_RECORD_INVALID
   dto.linkedBudgets.length > MAX_LINKED_BUDGETS               → 400 MAXIMUM_BUDGETS_LIMIT_ERROR
   budgetIds = [...new Set(dto.linkedBudgets)]
   { expense, messages } = await connection.transaction(async (session) => {
     messages = []                                             // fn may re-run
     await categoryService.assertCategoryOwned(dto.category, sub)   // 404 'Category not found' (no session param)
     await accountService.assertAccountOwned({ accountId: dto.account, sub, session })  // 404 / 401
     date = toMexicoCityWallClock(dto.date)
     [expense] = expenseModel.create([{ ...dto, linkedBudgets: budgetIds, date, ...formatDateToString(date),
                   amountFormatted: formatNumberToCurrency(dto.amount), userId: sub }], { session })
     await accountService.incrementBalance({ accountId: dto.account, sub, delta: -dto.amount, session })
     for id of budgetIds: await addToBudget({ budgetId: id, sub, expense, amount: dto.amount,
                                             recordDate: dto.date /* unshifted, research §4 */, session })
     return { expense, messages }
   })
   await expense.populate([CATEGORY_POPULATE, { path: 'linkedBudgets' }])   // after commit
   return 201 { ...INITIAL_RESPONSE, message: messages, data: { expense } }
   ```
   - private `addToBudget({ budgetId, sub, expense, amount, recordName, recordDate, session })` — `r =
     budgetService.incrementBudgetAmount({ budgetId, sub, delta: amount, session })`; `null` → `throw new
     BadRequestException(BUDGET_HISTORY_NOT_FOUND_ERROR)` (aborts everything: audit Medium); else
     `budgetHistoryService.addHistoryRecord({ budgetId, sub, session, record: { recordId: expense._id.toString(),
     recordName, recordDate, recordAmount: amount, ...r } })`. Reused by Phase 3.
   - private `removeFromBudget({ budgetId, sub, recordId, amount, session })` — `r = incrementBudgetAmount({ delta:
     -amount })`; `null` → skip (stale or foreign link, history included); else `removeHistoryRecord({ budgetId, sub,
     recordId, session })`. Reused by Phase 3.
   - `{ ...dto }` is safe to spread on create: the whitelist already stripped unknown keys and the DTO has no
     `userId`/`_id`.
5. `ExpenseService.deleteExpense(sub, { recordId }): Promise<GeneralResponse>`:
   ```
   { expense, messages } = await connection.transaction(async (session) => {
     old = expenseModel.findById(recordId).session(session)   // null → 404 EXPENSE_NOT_FOUND
     String(old.userId) !== sub → 401 EXPENSE_UNAUTHORIZED_ERROR
     expense = findOneAndDelete({ _id: recordId, userId: sub }, { session })   // null → 404 (race)
     await accountService.incrementBalance({ accountId: old.account, sub, delta: +old.amount, session })  // Q10: 404 aborts, record kept
     for id of (old.linkedBudgets ?? []).map(String): await removeFromBudget({ …, amount: old.amount, recordId })
     return { expense, messages }
   })
   return 200 { message: messages, data: { expense } }   // raw deleted doc, unpopulated (develop)
   ```
6. `ExpenseController` — `@Post()` (`CreateExpenseDto`) and `@Delete()` (`DeleteExpenseDto`, id in the body).

**Edge cases**
- `amount` 0 and negatives pass on create (legacy); `linkedBudgets` with a duplicate id is counted once.
- A foreign or missing budget on create → 400 `'Budget history not found'`; expense, balance and the other budgets
  are unchanged (the transaction). A budget whose history doc is gone also 400s (same helper).
- Delete of a record linked to a deleted/foreign budget → 200, that link is skipped (fixes develop's always-400).
- Delete of a record whose account is missing/foreign → 404 `'Account not found'`, record kept (Q10). Only the
  3 unreachable prod orphans hit this.
- A repeated DELETE → 404 `'Expense not found.'`, nothing changes (D9).
- `old.account` may be absent only on the one unreachable dirty doc (no `userId`, so it 401s first).

**Test coverage**
- Unit `expense.service.spec.ts` (mocked models, `transaction: vi.fn((fn) => fn(session))`, mocked helper services):
  - Create: each pre-check and its order (transfer + budgets before the type check; 4 budgets → max error); category
    404 and account 404/401 propagate and nothing after them is called; `create` gets the shifted date, `fullDate`,
    `formattedTime`, `amountFormatted`, `userId: sub`, deduped `linkedBudgets`; `incrementBalance` delta `-amount`
    (research §5.1 row "Expense create"); per budget `incrementBudgetAmount(+amount)` then `addHistoryRecord` with
    `recordDate` = the **unshifted** DTO date and the returned before/after; `null` → 400 and no history call; every call
    gets the session.
  - Delete: 404, 401 (no writes); `incrementBalance(+old.amount)`; per stored budget `incrementBudgetAmount(-old.amount)`
    + `removeHistoryRecord`; `null` → skipped (no history call); legacy doc without `linkedBudgets` works;
    `incrementBalance` 404 → propagates (Q10).
- e2e: POST happy path → 201, `message` is a string array, `data.expense` with populated `category` (`_id
  categoryName icon` only) and full `linkedBudgets` docs, stored date = Mexico wall clock (a fixed input vector),
  `isPaid` present, no `expensesPaid` key; the account balance read back (`GET /account-actions`) is `before − amount`;
  the budget's `currentAmount` is `+ amount` and its history has one entry (`recordId` = the expense id, `recordAmount`,
  before/after). Errors (each asserts **no expense, same balance, same budget**): transfer + budgets, `typeOfRecord:
  'income'`, 4 budgets, missing/foreign category (404), missing account (404), foreign account (401), foreign budget and
  unknown budget id (400 `'Budget history not found'`), `indebtedPeople: null` / `transferRecord: null` (400 nested
  text), unknown property (400). `indebtedPeople` with `_id` accepted (Q7).
  DELETE: 200 raw doc, balance back to `before`, budget `currentAmount` back and the history entry gone; repeated → 404;
  B deleting A's → 401 and nothing changes; a seeded record linked to a deleted budget → 200; a seeded record on a
  foreign account → 404 and the record is still there (Q10); a seeded record without `linkedBudgets` deletes.
  Atomicity: a one-shot failing `addHistoryRecord` (spy on the real `BudgetHistoryService` instance) on create → 500
  and expense count, balance and budget unchanged.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none here (the prod run in Phase 3 covers create and delete, and deletes all it creates).

---

## Phase 3 — `PUT /expenses-actions` (Q5, Q7, Q9, audit High), docs, manual run on prod

**Changes**

1. `ExpenseService.updateExpense(sub, dto: UpdateExpenseDto): Promise<GeneralResponse>`:
   ```
   // develop's order, pure: !dto.date → 400 MISSING_DATE; !dto.category → MISSING_CATEGORY;
   // !dto.amount → MISSING_AMOUNT (0 → 400, develop); !dto.linkedBudgets → MISSING_LINKED_BUDGETS
   { expense, messages } = await connection.transaction(async (session) => {
     old = expenseModel.findById(dto.recordId).session(session)    // null → 404 EXPENSE_NOT_FOUND
     String(old.userId) !== sub → 401 EXPENSE_UNAUTHORIZED_ERROR
     // Q9: check ownership only for a field the edit changes
     if (dto.category !== String(old.category)) await categoryService.assertCategoryOwned(dto.category, sub)  // 404
     newAccount = dto.account ?? old.account
     accountChanged = newAccount !== old.account
     if (accountChanged) await accountService.assertAccountOwned({ accountId: newAccount, sub, session })  // 404/401, audit High
     // balance (research §5.1 "Expense edit", proposed)
     if (accountChanged) {
       incrementBalance({ accountId: old.account, sub, delta: +old.amount, session })
       incrementBalance({ accountId: newAccount, sub, delta: -dto.amount, session })
     } else if (old.amount !== dto.amount) {
       incrementBalance({ accountId: old.account, sub, delta: old.amount - dto.amount, session })
     }
     // budgets (research §5.2 proposed, Q5)
     oldIds = (old.linkedBudgets ?? []).map(String); newIds = [...new Set(dto.linkedBudgets)]
     removed = oldIds − newIds → removeFromBudget({ amount: old.amount })           // null → skip
     added   = newIds − oldIds → addToBudget({ amount: dto.amount })                // null → 400, aborts
     kept    = oldIds ∩ newIds, only if old.amount !== dto.amount:
               r = incrementBudgetAmount({ delta: dto.amount - old.amount }); null → skip;
               else removeHistoryRecord(recordId) + addHistoryRecord({ recordAmount: dto.amount, ...r })
     recordName for history = dto.shortName ?? old.shortName; recordDate = dto.date (research §4)
     $set = allow-listed DTO fields present and non-null (never recordId/userId), with linkedBudgets: newIds,
            + formatDateToString(dto.date) (date NOT shifted, research §4) + amountFormatted(dto.amount)
     expense = findOneAndUpdate({ _id: dto.recordId, userId: sub }, { $set }, { session, returnDocument: 'after' })
     return { expense, messages }
   })
   await expense.populate(CATEGORY_POPULATE)          // only category, linkedBudgets stay ids (develop)
   return 200 { message: messages, data: { expense } }
   ```
   - `UPDATABLE_FIELDS` const (like `AccountService`): `shortName, typeOfRecord, description, amount, date, category,
     subCategory, tag, indebtedPeople, transferRecord, account, budgets, isPaid, linkedBudgets`. `typeOfRecord` is
     stored as sent, not checked (old-next's transfer edit sends `'transfer'`).
   - The kept-budget history entry is replaced by pull + push with the `$inc`'s before/after for `new − old`; no client
     reads history (research §4).
2. `ExpenseController` — `@Put()` (`UpdateExpenseDto`, id in the body).
3. `ai-skills/REPO_CONTEXT.md` — overview (S7a records-expenses), `src/record/` in the structure tree, the 4 routes in
   the route table, note that `BUDGET_EXPENSES_UNLINK` is provided by the global `RecordModule` while
   `ACCOUNT_RECORDS_CASCADE` is still the 0/0 default until S7b, `test/records-expenses.e2e-spec.ts` in the test list,
   and remove "records…" from "Does not exist yet" (keep incomes/transfers listed there).

**Edge cases**
- old-next's edit (same account, same category, echoed `indebtedPeople` with `_id`) → 200 (Q7 fixes the always-400 for
  the 60 prod expenses with indebted people).
- Records with a foreign or missing category, or an unchanged foreign/stale budget, stay editable (Q9).
- A record whose stored account is foreign: edits that don't change `amount`/`account` pass; an amount or account
  change hits `incrementBalance` on the old account → 404, no write (see open question 1).
- `category` stored as ObjectId compares equal to the same id sent as a string (`String(old.category)`).
- A repeated identical PUT moves nothing (amount and links unchanged; D9).
- Moving a record to another of the user's accounts with the same amount still moves the balance (old `+=`, new `−=`).
- Changing `amount` and `account` together: old `+= old`, new `−= new` (no separate delta step).
- A kept budget whose history doc is gone → 400 `'Budget history not found'`, nothing written (rare; S6 Q6 path only).
- Two concurrent edits of the same record → write conflict; Mongo aborts one (retried or 500).

**Test coverage**
- Unit (`expense.service.spec.ts`), one test per research §5.1/§5.2 edit row with the signed deltas:
  - The 4 missing-prop 400s in order, `amount: 0` → 400; 404; 401; nothing written in any of them.
  - Q9: unchanged category/account → no `assertCategoryOwned` / `assertAccountOwned` call; changed category → called
    (404 propagates, no writes); changed account → `assertAccountOwned(new)` (401 propagates, no writes).
  - Balance: same account, amount changed → one `incrementBalance(old − new)`; unchanged → no call; account changed →
    `+old` on old, `−new` on new.
  - Budgets: removed → `incrementBudgetAmount(−old)` + `removeHistoryRecord`, `null` → skipped; added →
    `+new` + `addHistoryRecord`, `null` → 400; kept with a changed amount → `new − old` + pull + push with the new
    amount; kept with the same amount → no budget calls.
  - `$set` has no `recordId`/`userId`, no null fields, the unshifted date and recomputed formats; filter `{ _id, userId:
    sub }`.
- e2e: create through POST, then PUT echoing the record (incl. `indebtedPeople[]._id`) → 200, `data.expense` with
  populated category and id `linkedBudgets`; amount 100 → 150 → balance `−50`, budget `+50`, one history entry with
  `recordAmount: 150`; unlink the budget → budget back by the old amount and its entry gone; link another budget → `+new`
  and one entry; move to the user's second account → old `+amount`, new `−amount`; move to B's account → 401 and
  nothing changes (audit High); change to B's category → 404, nothing changes; add B's budget → 400, nothing changes;
  seeded legacy doc (ObjectId category, no `linkedBudgets` key) with B's category stored → PUT keeping it → 200 (Q9);
  B's PUT on A's record → 401; unknown `recordId` → 404; missing `date`/`category`/`amount`/`linkedBudgets` and
  `amount: 0` → 400 with develop's texts; `recordId`/`userId` can't be changed (`userId` in body → 400 whitelist);
  PUT with `typeOfRecord: 'transfer'` on a seeded transfer → 200, stored type kept; repeating the same PUT → balances
  unchanged. Atomicity: a one-shot failing `incrementBalance` on the new account → 500, record, both balances and the
  budget unchanged.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e` (CI repeats e2e on the docker replica set).
- Manual (orchestrator, `pnpm run start:dev` on the owner's `.env` = **prod DB**, D16). **Creates 1 `users` doc, 1
  category, 2 accounts, 1 budget + its history doc and 1 expense, and deletes all of them in this phase.** Never touch
  existing prod docs. `TS=$(date +%s)`, `EMAIL=e2e-manual-$TS@example.invalid` (no real mail, security finding),
  throwaway password, base `http://localhost:3000`, JSON bodies, `Authorization: Bearer $TOKEN` after step 2.
  1. `POST /users` `{email, password, firstName:'Manual', lastName:'Check', middleName:''}` → 201; `SUB =
     data.userCreated.sub`.
  2. `POST /auth` `{email, password}` → 201; `TOKEN` = the `set-cookie[0]` value (between the first `=` and `;`).
  3. `POST /categories` `{categoryName:'Manual', subCategories:['Uno'], icon:'manual'}` → 201; `CAT =
     data.category._id`.
  4. `POST /account-actions` `{title:'Manual 1', alias:'m1', accountType:'Debit', amount:1000, backgroundColor:'#000',
     color:'#fff'}` → `ACC1`; same with `title:'Manual 2'`, `amount:500` → `ACC2`.
  5. `POST /budgets` with all 11 fields (S6 manual body, `currentAmount:0`, `limit:500`) → `BUD = data.budget._id`,
     `HIST = data.budgetHistory._id`.
  6. `POST /expenses-actions` `{shortName:'Manual', typeOfRecord:'expense', description:'', amount:100,
     date:<now ISO>, category:CAT, subCategory:'Uno', tag:[], indebtedPeople:[{name:'P', amount:10, amountPaid:0,
     isPaid:false}], account:ACC1, budgets:[], isPaid:true, linkedBudgets:[BUD]}` → 201, `message` an array,
     `data.expense.category == {_id:CAT, categoryName:'Manual', icon:'manual'}`, `linkedBudgets[0]._id == BUD`; keep
     `EXP`, `DATE = data.expense.date`, `IP = data.expense.indebtedPeople` (has `_id`). Check: `DATE` = Mexico City wall
     clock of the input (−6 h, ms 0); **balance** `GET /account-actions` → ACC1 `900`; `GET /budgets/$BUD` →
     `currentAmount 100`; `GET /budget-history/$HIST` → 1 record, `recordId == EXP`, `recordAmount 100`.
  7. Listing: `MON`/`YYYY` = `DATE`'s UTC month (`Jan`..`Dec`) and year → `GET /expenses-actions/$ACC1/$MON/$YYYY` →
     200, 1 expense with populated category, `message: null`; `GET /expenses-actions/$ACC1/jan/$YYYY` → 200 `'Expenses
     not found.'`, `data.expenses: []`.
  8. No-write check: the step-6 body with `linkedBudgets:['000000000000000000000000']` → 400 `'Budget history not
     found'`; ACC1 still `900`, the listing still has 1 expense.
  9. `PUT /expenses-actions` with step 6's fields, `recordId:EXP`, `date:DATE`, `indebtedPeople:IP`, `amount:150` → 200
     (Q7); ACC1 `850`, budget `currentAmount 150`, history 1 record with `recordAmount 150`.
  10. Same PUT with `account:ACC2` (amount 150) → 200; ACC1 `1000`, ACC2 `350`; budget still `150`.
  11. Same PUT (account ACC2) with `linkedBudgets:[]` → 200; budget `currentAmount 0`, history `records: []`. Repeat it
      → 200, ACC2 still `350` (D9).
  12. `GET /expenses-actions/$ACC2/$MON/$YYYY` → the expense, `linkedBudgets: []`.
  13. **Clean-up, in dependency order:** `DELETE /expenses-actions {recordId:EXP}` → 200 raw doc; ACC2 back to
      `500`; repeat → 404 `'Expense not found.'`. `DELETE /budgets {budgetId:BUD}` → 200 (history deleted with it).
      `DELETE /account-actions {accountId:ACC1}` and `{accountId:ACC2}` → 200. `DELETE /categories {categoryId:CAT}` →
      200. Then, with the token still valid: `GET /account-actions` → `accounts: []`, `GET /categories` → `[]`,
      `GET /budgets` → `'Budgets not found'`, `GET /budget-history` → 404, `GET /expenses-actions/$ACC2/$MON/$YYYY` →
      `'Expenses not found.'`. Only then `DELETE /users` → 200.
  - On any failure after step 1, jump to step 13 with the current token (ids from the GETs; delete the expense first
    so the balances are restored). The orchestrator's independent check, read-only against the prod URI:
    `createexpenses.countDocuments({ userId: SUB })`, and `categories`, `accounts`, `budgetmodels`,
    `budgethistorymodels` `countDocuments({ sub: SUB })`, and `users.countDocuments({ _id: SUB })` = 0 each. If not,
    delete leftovers by `userId`/`sub` with the owner's OK. Report `SUB` and the counts.

---

## AC Coverage Summary

| AC | Phase(s) | Automatic / manual | Coverage |
|---|---|---|---|
| AC1 — every `/expenses-actions` route matches research §3 (DTOs, statuses, texts, empty listing, `message: string[]`) | 1 (GET), 2 (POST, DELETE), 3 (PUT) | both (e2e per route and error; manual 6–13) | full |
| AC2 — balance and linked-budget `currentAmount`/history per §5.1/§5.2 after create/edit/delete, one transaction each, characterization unit tests | 2 (create, delete), 3 (edit) | both (unit per rule; e2e read-backs + one-shot failure rollbacks; manual balance/budget checks 6, 9–11, 13) | full |
| AC3 — category 404, account 404/401, budget 400, PUT can't move to another user's account, nothing written | 2 (create), 3 (edit, Q9) | both (e2e asserts no write in each case; manual 8) | full (cross-user cases are e2e-only; prod run uses one user) |
| AC4 — budget delete pulls it from the owner's expenses' `linkedBudgets`, in the budget-delete transaction | 1 | automatic (unit + e2e incl. rollback) | full (not in the manual run: the requested clean-up order deletes the expense before the budget) |
| AC5 — unit and e2e tests; `REPO_CONTEXT.md` updated | 1, 2, 3 | automatic (+ doc edit in 3) | full |

## Decisions (beyond the research)

- Names: classes `Expense` (model name, also S7b's `expensesPaid` `ref`) and abstract base `AccountRecord`;
  `ExpenseService`, `ExpenseController`, `RecordPortsService`; e2e file `test/records-expenses.e2e-spec.ts`.
- The port is a separate `RecordPortsService` bound with `useExisting` (avoids a `BudgetService` ↔ port provider cycle);
  S7b adds the account cascade to it.
- Q9 applied to existence too: an **unchanged** category is not checked at all, so the 8 records with a missing
  category become editable without picking a new one (develop 404'd). A changed category uses `assertCategoryOwned`.
- On create, `linkedBudgets` is deduped before storing and applying (legacy double-counted); the max-3 check runs on
  the raw length.
- History `recordName` on edit = `dto.shortName ?? old.shortName` (develop used `changes.shortName`, possibly
  undefined).
- PUT `$set` drops `null` fields, like S5/S6 (develop would have stored `null`).
- The kept-budget history entry on an amount change is replaced (pull + push) with the before/after of the
  `new − old` increment.
- Ownership/existence checks run inside the transaction fn (re-checked on retry); `assertCategoryOwned` has no session
  and reads outside it (accepted, read-only).
- The listing uses `find().lean()` + populate instead of `aggregate` (same stored-key shape, casts the `date` bounds).

## Assumptions

- Research assumptions accepted (develop = contract, old-next is the client, Lambda runs in UTC, D10 message texts).
- Populate works on a lean `find` over a Mixed `category` path with `ref` for both stored types (Q4); Phase 1 e2e proves
  it. If it doesn't, stop and report before changing the schema type.
- A global module importing `BudgetModule` while providing its port boots without `forwardRef` (Phase 1 e2e proves it).
- `updateMany` inside the budget-delete transaction on a non-existent `createexpenses` collection is fine (no write,
  no implicit create); budgets e2e covers it.
- `ValidateNested()` on an omitted `indebtedPeople`/`transferRecord` passes and on `null` 400s, as the research verified
  with develop's class-validator; Phase 2 e2e characterizes both.

## Implementation checklist

- [x] Phase 1 — CLI (module verified in `AppModule`), constants, utils + spec, base + expense entities, global module
  with the port, `RecordPortsService` + spec, `BudgetModule` default removed, listing + spec, GET route, e2e (listing,
  populate of both category types, AC4)
- [x] Phase 2 — record/expense DTOs, interface, `createExpense` / `deleteExpense` + budget helpers + spec, POST/DELETE
  routes, e2e (balances, budgets, errors with no write, rollback)
- [x] Phase 3 — `updateExpense` + spec, PUT route, e2e (Q5/Q7/Q9, audit High, rollback), `REPO_CONTEXT.md`
- [x] Automatic: `pnpm run lint`, `pnpm run build`, `pnpm test`, `pnpm run test:e2e`
- [ ] Phase 3 manual run on the prod DB — orchestrator (steps 1–13 + leftover counts)
  (left unchecked: the executor must not touch the prod DB; a local smoke run of `node dist/main.js` on an in-memory
  replica set covered create/list/edit/delete with balance and budget read-backs)

## Implementation notes (deviations)

- `GeneralResponse.message` widened to `string | string[] | null` (`src/response.interface.ts`) so the mutations can
  return the D10 `string[]` step log. Type only; no runtime change.
- e2e schema check uses `schema.path('linkedBudgets').embeddedSchemaType.instance` (mongoose 9 has no `.caster`).
- `linkedBudgets` is declared with `default: undefined` (the way to say "no default" in mongoose; otherwise arrays
  hydrate `[]`).
- `UPDATABLE_FIELDS` leaves out `linkedBudgets`: `$set` always writes the deduped `newIds` explicitly.
- Phase 1 assumption held: populate on a lean `find` over the Mixed `category` + `ref` resolves both string and
  ObjectId stored values (e2e).
