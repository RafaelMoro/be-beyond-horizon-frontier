# Plan: S7b — records-incomes (`createincomes`, `/incomes-actions`, `expensesPaid`, account cascade port)

**Status:** APPROVED (2026-10-25, as written; run-all). Owner answers to the open questions:
- **Q1:** a malformed `expensesPaid` element (`null`, a number, `{}`, an operator object like `{_id: {$ne: null}}`) →
  400 before any write, with the new text `INVALID_EXPENSES_PAID`.
- **Q2:** an income PUT that changes the account moves the balance as expenses do: old account `−old`, new `+new`.
  Without an account change, as legacy.
- The "Decisions (beyond the research)" are approved as listed (body order, dedupe, only the caller's expenses;
  dangling/foreign ids dropped when the edit sends the list; `matchedCount`; shared `RECORD_UPDATABLE_FIELDS` with no
  S7a behavior change).

**Branch:** `feat/records-incomes` (from `main` v0.9.0, which includes S7a) · **Date:** 2026-10-25 · **Research:**
[`ai-research/records.research.md`](../ai-research/records.research.md) (S7b scope; §2, §3 income rows, §5.1 income
rows, §5.3, §7, §8 are the spec) · Pattern reference:
[`ai-planning/records-expenses.planning.md`](./records-expenses.planning.md) and `src/record/` · Memory:
[`memories/repo/records-research.md`](../memories/repo/records-research.md),
[`memories/repo/records-expenses-planning.md`](../memories/repo/records-expenses-planning.md),
[`memories/repo/records-incomes-planning.md`](../memories/repo/records-incomes-planning.md)

Owner decisions applied (`~/projects/notes/budget-master/be-refactor.md`):
- **E7.Q2** `RecordModule` (already `@Global()`) provides the real `ACCOUNT_RECORDS_CASCADE`; the `useValue` default
  leaves `AccountModule` in this story (**E7a plan gate**: "S7b the `AccountModule` one").
- **E7.Q6** a missing/foreign `expensesPaid` id is neither stored nor flipped, counted as failed, no error.
- **E7.Q8** an income PUT without `expensesPaid` = unchanged (no flag changes, stored list kept).
- **E7.Q9** on PUT, `category` / `account` ownership is checked only when the edit changes that field.
- **E7.Q10** deleting an income whose account is missing/foreign → 404, the income is kept.
- **E7.Q7** already in `IndebtedPeopleDto` (S7a); incomes reuse it.
- **E7a gate rule** reused: an amount/account edit on a record whose stored account is foreign → 404, no write.
- D2 (`account` string, `category` Mixed), D6 (unknown → 500), D9 (one-sided edits, safe to repeat), D10 (`message:
  string[]` texts free), D16 (tests never touch prod; the manual run deletes all it creates).
- Security finding fixed here: Medium "`expensesPaid` flips other users' expenses" (Phases 2 and 3). The High "PUT
  repoints `account`" gets the same fix as S7a on the income PUT (Phase 3).

AC numbers are the tracker's S7b AC1–AC5 (= research §1 S7b). This plan doesn't repeat the contract tables; it links
to the research.

## Scope guard

**In:** `src/record/entities/income.entity.ts`, `src/record/dtos/income.dto.ts`, `IncomeService` + spec,
`IncomeController`, `deleteAccountRecords` in `RecordPortsService` (+ spec), `RecordModule` wiring, removing the
`AccountModule` default, a small `toExpenseIds` util (+ spec), new constants, `test/records-incomes.e2e-spec.ts`,
`ai-skills/REPO_CONTEXT.md`.

**Out (don't add):** `/records/transfer` and `/records/expenses-and-incomes` (S7c, including any income listing); an
incomes `GET` route (develop has none); touching incomes' `expensesPaid` when an expense is deleted (research §5.3);
unpaying expenses of incomes removed by the account cascade, or any wider cascade (research §8, §14); a
`typeOfRecord` check on PUT (old-next's transfer edit sends `'transfer'`); filtering paid expenses by `typeOfRecord`;
"another income still pays this expense" bookkeeping (legacy doesn't have it); the prod index script (S8).

## Design for S7c (no rework later)

- `IncomeService` keeps the paid-flag steps in a private helper taking the session (`payExpenses` below), so S7c's
  transfer create can reuse the income-side write path inside its own transaction.
- `RecordPortsService` keeps depending only on record models (now `Expense` + `Income`), never on `AccountService`:
  `AccountService` injects `ACCOUNT_RECORDS_CASCADE` and `RecordModule` imports `AccountModule` (same cycle rule as S7a,
  memory `records-expenses-planning.md`).

## CLI note

Run both up front; check that generated relative imports end in `.js` and that the CLI added `IncomeService` /
`IncomeController` to `RecordModule` (verify). Change the schematic's `@Controller('income')` to
`@Controller('incomes-actions')`.

```bash
pnpm nest g s record/services/income --flat
pnpm nest g co record/controllers/income --flat --no-spec
```

---

## Phase 1 — Income schema, real `ACCOUNT_RECORDS_CASCADE`, `AccountModule` default removed (AC4)

**Changes**

1. CLI: the 2 commands above (Phases 2–3 fill the service and controller).
2. `src/record/entities/income.entity.ts` — create `@Schema({ collection: 'createincomes' }) class Income extends
   AccountRecord` with `expensesPaid: Types.ObjectId[]` declared as `[{ type: mongoose.Schema.Types.ObjectId, ref: Expense.name }]`
   (**`mongoose.Schema.Types.ObjectId`**, not the `Types.ObjectId` class, which makes it Mixed; same comment as
   `expense.entity.ts`). No `isPaid` path (key presence is the record kind on the client, research §2). No timestamps.
   No `default: undefined` needed (every prod income has the array and every write sets it). `IncomeSchema.index({
   userId: 1, account: 1, date: -1 })` (test-only build). `export type IncomeDoc = HydratedDocument<Income>`.
3. `src/record/record.module.ts` — `forFeature` adds `{ name: Income.name, schema: IncomeSchema }`; providers add
   `{ provide: ACCOUNT_RECORDS_CASCADE, useExisting: RecordPortsService }`; `exports` add `ACCOUNT_RECORDS_CASCADE`.
   Update the one-line "global" comment to name both ports (`AccountModule` and `BudgetModule` resolve them without
   importing this module).
4. `src/record/services/record-ports.service.ts` — also `implements AccountRecordsCascade`; inject the `Income` model.
   ```
   deleteAccountRecords({ accountId, sub, session }) →
     filter = { userId: sub, account: accountId }          // account is a String path (D2)
     e = await expenseModel.deleteMany(filter, { session })
     i = await incomeModel.deleteMany(filter, { session })  // sequential: one session, no parallel ops
     return { numberExpensesDeleted: e.deletedCount, numberIncomesDeleted: i.deletedCount }
   ```
   Research §8 narrow scope: no budget, history, paid-flag or transfer-counterpart effects. Update the class comment
   (it now serves both ports).
5. `src/account/account.module.ts` — delete `noRecordsCascade`, its `useValue` provider, the "S7 replaces this default"
   comment and the now-unused imports (`ACCOUNT_RECORDS_CASCADE`, `AccountRecordsCascade`). One-line comment where the
   provider was: the port comes from the global `RecordModule`. `AccountService` and `account.service.spec.ts` (already
   stubs the token) are unchanged.

**DI (non-obvious):** exactly S7a's shape. If Nest reports a cycle or an unresolved `ACCOUNT_RECORDS_CASCADE` at boot,
stop and report (don't add `forwardRef`). `app.get(ACCOUNT_RECORDS_CASCADE, { strict: false })` now returns the
`RecordPortsService` instance, so `test/accounts.e2e-spec.ts`' spies keep working, and its "0/0" test stays green (that
account has no records).

**Edge cases**
- Only the caller's records on that account string are deleted; another user's record carrying the same `account`
  string (dirty data) is kept.
- A transfer side on the deleted account is deleted; its counterpart on another account stays (legacy).
- A failure after the cascade (e.g. the account delete) rolls the record deletes back (same transaction).

**Test coverage**
- Unit `record-ports.service.spec.ts`: `deleteAccountRecords` calls both `deleteMany` with `{ userId: sub, account }`
  and `{ session }`, and maps the two `deletedCount`s.
- e2e `test/records-incomes.e2e-spec.ts` (new; `await expenseModel.init()` and `await incomeModel.init()` in
  `beforeAll`; signup/login + account/category helpers copied from `records-expenses.e2e-spec.ts`; seed with
  `model.collection.insertOne` to keep legacy shapes). **AC4:** on A's account seed 2 expenses (one legacy-shaped, one
  transfer) + 1 income; also seed A's records on A's other account and B's records with the same account string →
  `DELETE /account-actions` → 200 with `numberExpensesDeleted: 2`, `numberIncomesDeleted: 1`; only those 3 are gone.
  Rollback: wrap the real `RecordPortsService.deleteAccountRecords` once (call the original, then throw) → 500, the
  account and all 3 records are still there. Schema checks: `IncomeSchema.path('expensesPaid').embeddedSchemaType
  .instance === 'ObjectId'` (mongoose 9, S7a note), no `isPaid` path, `category` Mixed, `account` String.
- `test/accounts.e2e-spec.ts` keeps passing unchanged.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none here (the prod run in Phase 3 covers the cascade).

---

## Phase 2 — `POST` and `DELETE /incomes-actions` with `expensesPaid` (AC1, AC2, AC3)

**Changes**

1. `src/record/record.constants.ts` — add legacy texts (`repositories/incomes/incomes.constants.ts`):
   `INCOME_NOT_FOUND = 'Income not found.'`, `INCOME_UNAUTHORIZED_ERROR = 'This income does not belongs to the user'`,
   `UNAUTHORIZED_INCOMES_ERROR = "You're unauthorized to see these incomes."`, `INCOME_CREATED_MESSAGE = 'Income
   created'`, `INCOME_DELETED_MESSAGE = 'Income deleted'`; `EXPENSES_PAID_POPULATE = { path: 'expensesPaid', select:
   '_id shortName amountFormatted fullDate formattedTime' }`; `INVALID_EXPENSES_PAID` (new 400 text, open question 1).
   Also move S7a's field list here as `RECORD_UPDATABLE_FIELDS` (the 12 shared fields, never `recordId`/`userId`);
   `ExpenseService` uses `[...RECORD_UPDATABLE_FIELDS, 'isPaid'] as const` (no behavior change).
2. `src/record/record.utils.ts` — add `toExpenseIds(values: unknown[]): string[] | null`: each element is a 24-hex
   string, or an object whose `_id` is a 24-hex string (old-next sends expense objects, research §3); returns the
   deduped id strings, or `null` if any element is neither. Never passes an object into a query (operator injection).
3. `src/record/dtos/income.dto.ts` — `CreateIncomeDto extends CreateRecordDto { @IsArray() expensesPaid: unknown[] }`
   (required, elements checked by `toExpenseIds`; no `ValidateNested`, so the whitelist leaves the echoed expense
   objects alone). `UpdateIncomeDto extends UpdateRecordDto` with `expensesPaid` `@IsOptional() @IsArray()` (Q8).
   `export { DeleteRecordDto as DeleteIncomeDto }`. No `isPaid`/`linkedBudgets`: `forbidNonWhitelisted` 400s them, as
   develop.
4. `src/record/record.interface.ts` — add `IncomeMutationResult { income: IncomeDoc; messages: string[] }`.
5. `IncomeService` — inject `Income` and `Expense` models, `@InjectConnection() connection`, `AccountService`,
   `CategoryService`.
   - private `setPaid({ ids, sub, isPaid, session }): Promise<number>` — `ids.length === 0` → 0; else
     `expenseModel.updateMany({ _id: { $in: ids }, userId: sub }, { $set: { isPaid } }, { session })` → `matchedCount`
     (an already-paid expense still counts as paid). Owner filter = audit Medium; a missing id
     just doesn't match (bug 6).
   - private `ownedExpenseIds({ ids, sub, session }): Promise<string[]>` — `expenseModel.find({ _id: { $in: ids },
     userId: sub }).select('_id').session(session).lean()` → id strings, **in the input order** (Q6: only these are
     stored).
   - private `payExpenses({ ids, owned, sub, messages, session }): Promise<void>` — `setPaid({ ids: owned, isPaid:
     true })`; `messages.push('Expenses paid updated: n', 'Expenses paid failed to update: ids.length − owned.length')`.
     Reused by Phase 3 and S7c (owned ids are computed first because the stored list needs them before `create`).
   - `createIncome(sub, dto): Promise<GeneralResponse>`:
     ```
     // pure checks, develop's order: typeOfRecord !== 'income' → 400 TYPE_OF_RECORD_INVALID
     ids = toExpenseIds(dto.expensesPaid); null → 400 INVALID_EXPENSES_PAID
     { income, messages } = await connection.transaction(async (session) => {
       messages = []                                                       // fn may re-run
       await categoryService.assertCategoryOwned(dto.category, sub)        // 404
       await accountService.assertAccountOwned({ accountId: dto.account, sub, session })   // 404 / 401
       owned = await ownedExpenseIds({ ids, sub, session })
       date = toMexicoCityWallClock(dto.date)
       [income] = incomeModel.create([{ ...dto, expensesPaid: owned, date, ...formatDateToString(date),
                   amountFormatted: formatNumberToCurrency(dto.amount), userId: sub }], { session })
       incrementBalance({ accountId: dto.account, sub, delta: +dto.amount, session })   // research §5.1 "Income create"
       await payExpenses({ ids, owned, sub, messages, session })
       return { income, messages }
     })
     return 201 { ...INITIAL_RESPONSE, message: messages, data: { income } }   // unpopulated (develop)
     ```
   - `deleteIncome(sub, { recordId }): Promise<GeneralResponse>`:
     ```
     { income, messages } = await connection.transaction(async (session) => {
       old = findOwnedIncome(recordId, sub, session, INCOME_NOT_FOUND, INCOME_UNAUTHORIZED_ERROR)   // 404 / 401
       income = findOneAndDelete({ _id: recordId, userId: sub }, { session })   // null → 404 (race)
       incrementBalance({ accountId: old.account, sub, delta: -old.amount, session })   // Q10: 404 aborts, kept
       n = setPaid({ ids: (old.expensesPaid ?? []).map(String), isPaid: false })   // owner-filtered
       messages.push(INCOME_DELETED_MESSAGE, "Account's amount updated", `Expenses paid updated: ${n}`)
       return { income, messages }
     })
     return 200 { message: messages, data: { income } }   // raw deleted doc (develop)
     ```
   - private `findOwnedIncome(recordId, sub, session, notFound, unauthorized)` — lean `findById().session()`; `null` →
     404 `notFound`; `String(old.userId) !== sub` → 401 `unauthorized` (PUT and DELETE use different legacy texts).
6. `IncomeController` — `@Controller('incomes-actions')`; `@Post()` (`CreateIncomeDto`) and `@Delete()`
   (`DeleteIncomeDto`, id in the body). Thin, like `ExpenseController`.

**Edge cases**
- `expensesPaid` mixing objects and strings, duplicates, an unknown id and B's expense id → only A's existing ones are
  stored and set `isPaid: true`; the message counts the rest as failed; B's expense stays unpaid (Q6, audit Medium).
- An element like `{ _id: { $ne: null } }`, `null`, `42` or `{}` → 400 `INVALID_EXPENSES_PAID`, nothing written.
- `expensesPaid: []` → no expense query, no flip.
- Paying an already-paid expense is a no-op that still counts as paid.
- `amount` 0 and negatives pass on create (legacy). `isPaid` or `linkedBudgets` in the body → 400 (whitelist).
- Delete of an income whose stored `expensesPaid` has missing or foreign ids → 200; nothing crashes, foreign expenses
  stay as they are (bug 6, audit Medium).
- Delete with a missing/foreign stored account → 404 `'Account not found'`, income kept (Q10).
- A repeated DELETE → 404 `'Income not found.'`, nothing changes (D9).

**Test coverage**
- Unit `record.utils.spec.ts`: `toExpenseIds` with strings, objects, mixed, duplicates, `[]`, and each malformed
  element (`null`, number, `{}`, `{ _id: 5 }`, `{ _id: { $ne: null } }`, a 12-char string) → `null`.
- Unit `income.service.spec.ts` (mocked models, `transaction: vi.fn((fn) => fn(session))`, mocked `AccountService` /
  `CategoryService`):
  - Create: type check first; malformed `expensesPaid` → 400, no transaction; category 404 / account 404/401 propagate
    and nothing after them is called; `create` gets the shifted date, formats, `userId: sub` and **only the owned ids**;
    `incrementBalance` delta `+amount` (research §5.1); `updateMany` filter has `userId: sub` and `$in: owned`;
    `expensesPaid: []` → no `find`/`updateMany`; every call gets the session.
  - Delete: 404 `'Income not found.'`, 401 `'This income does not belongs to the user'` (no writes);
    `incrementBalance(-old.amount)`; unpay `updateMany` with `isPaid: false` and the owner filter; `incrementBalance`
    404 → propagates (Q10).
- e2e (`test/records-incomes.e2e-spec.ts`): 401 without a token on POST/PUT/DELETE. POST happy path with
  `expensesPaid` = [A's expense **object**, A's expense **id string**, B's expense id, unknown id] → 201, `message` a
  string array, `data.income` unpopulated with `expensesPaid` = the two owned ids, stored date = Mexico wall clock (S7a
  vector), no `isPaid` key; balance `before + amount`; A's two expenses `isPaid: true`, B's still `false`. Errors (each
  asserts **no income, same balance, no flag changed**): `typeOfRecord: 'expense'`, malformed `expensesPaid` element,
  `isPaid` in body, missing/foreign category (404), missing account (404), foreign account (401). DELETE: 200 raw doc,
  balance back, the paid expenses back to `false` (B's untouched even if seeded into the stored list); repeat → 404;
  B deleting A's → 401, nothing changes; seeded income on a foreign account → 404 and it stays (Q10); seeded legacy
  income with a dangling `expensesPaid` id → 200 (bug 6). Atomicity: a one-shot failing `incrementBalance` (spy on the
  real `AccountService`) on create → 500, no income, no flag flipped.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none here (the prod run in Phase 3 covers create and delete, and deletes all it creates).

---

## Phase 3 — `PUT /incomes-actions` (bug 7, Q8, Q9, audit High), docs, manual run on prod

**Changes**

1. `IncomeService.updateIncome(sub, dto: UpdateIncomeDto): Promise<GeneralResponse>`:
   ```
   // develop's order, pure: !dto.date → 400 MISSING_DATE; !dto.category → MISSING_CATEGORY;
   // !dto.amount → MISSING_AMOUNT (0 → 400). No linkedBudgets check (develop).
   newIds = dto.expensesPaid === undefined ? undefined : toExpenseIds(dto.expensesPaid)   // null → 400 INVALID_EXPENSES_PAID
   { income, messages } = await connection.transaction(async (session) => {
     old = findOwnedIncome(dto.recordId, sub, session, EXPENSE_NOT_FOUND /* sic, develop */, UNAUTHORIZED_INCOMES_ERROR)
     if (dto.category !== String(old.category)) await categoryService.assertCategoryOwned(dto.category, sub)   // Q9
     newAccount = dto.account ?? old.account; accountChanged = newAccount !== old.account
     if (accountChanged) {
       assertAccountOwned({ accountId: newAccount, sub, session })           // 404/401, audit High
       incrementBalance({ accountId: old.account, delta: -old.amount })     // mirror of expense (research §5.1)
       incrementBalance({ accountId: newAccount, delta: +dto.amount })
     } else if (old.amount !== dto.amount) {
       incrementBalance({ accountId: old.account, delta: dto.amount - old.amount })
     }
     // paid flags (bug 7 fixed, Q6, Q8)
     if (newIds !== undefined) {
       oldIds = (old.expensesPaid ?? []).map(String)
       owned = ownedExpenseIds({ ids: newIds, sub, session })
       setPaid(oldIds − owned, false)          // owner-filtered; foreign/missing stored ids match nothing
       setPaid(owned − oldIds, true)           // kept ones untouched
       messages: unpaid n / paid n / failed (newIds.length − owned.length)
     }
     $set = RECORD_UPDATABLE_FIELDS present and non-null (never recordId/userId)
            + (newIds !== undefined ? { expensesPaid: owned } : {})
            + formatDateToString(dto.date) (date NOT shifted, research §4) + amountFormatted(dto.amount)
     income = findOneAndUpdate({ _id: dto.recordId, userId: sub }, { $set }, { session, returnDocument: 'after' })
     null → 404 EXPENSE_NOT_FOUND
     return { income, messages }
   })
   await income.populate([EXPENSES_PAID_POPULATE, CATEGORY_POPULATE])   // after commit (develop's PUT response)
   return 200 { message: messages, data: { income } }
   ```
   `typeOfRecord` is stored as sent, not checked.
2. `IncomeController` — `@Put()` (`UpdateIncomeDto`, id in the body).
3. `ai-skills/REPO_CONTEXT.md` — overview (S7b records-incomes), `income.entity.ts` / `income.dto.ts` /
   `income.service.ts` / `income.controller.ts` in the `record/` tree, `record.module.ts` line (forFeature both, both
   ports), `account.module.ts` line (no default any more), the 3 `/incomes-actions` routes in the route table, the
   `DELETE /account-actions` row (real counts), replace the "`ACCOUNT_RECORDS_CASCADE` is still the 0/0 default" note,
   `test/records-incomes.e2e-spec.ts` in the test list, and drop incomes from "Does not exist yet" (keep transfers and
   the `/records` listing).

**Edge cases**
- old-next's edit echoes the populated `expensesPaid` objects (missing ids already dropped by populate) → kept ones stay
  paid and aren't touched; removed ones unpaid; added ones paid (bug 7 fixed; same end state old-next saw).
- A stored foreign/dangling id (legacy data) is dropped from the stored list on any edit that sends `expensesPaid`
  and is never flipped (Q6).
- PUT without `expensesPaid` → no flag changes, stored list kept (Q8); with `expensesPaid: []` → all owned old ones
  unpaid, list emptied.
- A repeated identical PUT moves no balance and flips nothing (D9).
- Stored foreign account + amount/account change → 404 on `incrementBalance(old.account)`, no write (E7a gate rule).
- `category` stored as ObjectId equals the same id sent as a string (`String(old.category)`); an unchanged foreign or
  missing category stays editable (Q9).
- `typeOfRecord: 'transfer'` (old-next's transfer edit, second PUT) → 200, only this side's account moves (D9).
- Changing `amount` and `account` together: old `−= old`, new `+= new`.

**Test coverage**
- Unit (`income.service.spec.ts`), one test per research §5.1 "Income edit" row and §5.3 rule, with the signed deltas:
  - The 3 missing-prop 400s in order, `amount: 0` → 400; 404 **`'Expense not found.'`**; 401 `"You're unauthorized to
    see these incomes."`; nothing written.
  - Q9: unchanged category/account → no ownership call; changed → called (errors propagate, no writes).
  - Balance: same account, amount changed → one `incrementBalance(new − old)`; unchanged → none; account changed →
    `−old` on old, `+new` on new.
  - Flags: removed → `isPaid: false` only for `old − owned`; added → `true` only for `owned − old`; kept → in neither
    call; foreign id in body → not stored, not flipped; `expensesPaid` undefined → no `find`/`updateMany` and no
    `expensesPaid` in `$set` (Q8).
  - `$set` has no `recordId`/`userId`, no null fields, the unshifted date and recomputed formats; filter `{ _id, userId:
    sub }`.
- e2e: create through POST paying E1, E2; PUT echoing the record with `expensesPaid: [E1 object]` → 200, `data.income`
  with populated `expensesPaid` (`_id shortName amountFormatted fullDate formattedTime` only) and category; E2 `false`;
  bug 7: set E1 `isPaid: false` directly in the DB before that PUT and check it stays `false` (a kept id is not
  touched); add E3 → paid; amount 200 →
  250 → balance `+50`; move to A's second account → old `−amount`, new `+amount`; move to B's account → 401, nothing
  changes; B's category → 404, nothing changes; B's expense in `expensesPaid` → 200, not stored, B's stays unpaid; PUT
  without `expensesPaid` → flags and stored list unchanged (Q8); seeded legacy income (ObjectId category of B's, a
  dangling `expensesPaid` id) kept as is → 200 (Q9, bug 6); B's PUT on A's income → 401; unknown `recordId` → 404
  `'Expense not found.'`; missing `date`/`category`/`amount` and `amount: 0` → 400 with develop's texts; `userId` in
  body → 400; `typeOfRecord: 'transfer'` on a seeded transfer income → 200, stored type kept; repeating the same PUT →
  balances and flags unchanged. Atomicity: a one-shot failing `incrementBalance` on the new account → 500; income,
  both balances and flags unchanged.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e` (CI repeats e2e on the docker replica set).
- Manual (orchestrator, `pnpm run start:dev` on the owner's `.env` = **prod DB**, D16). **Creates 1 `users` doc, 1
  category, 3 accounts, 3 expenses and 2 incomes, and deletes all of them in this phase.** Never touch existing prod
  docs. `TS=$(date +%s)`, `EMAIL=e2e-manual-$TS@example.invalid` (no real mail), throwaway password, base
  `http://localhost:3000`, JSON bodies, `Authorization: Bearer $TOKEN` after step 2. `NOW` = current ISO instant.
  1. `POST /users` `{email, password, firstName:'Manual', lastName:'Check', middleName:''}` → 201; `SUB =
     data.userCreated.sub`.
  2. `POST /auth` `{email, password}` → 201; `TOKEN` = the `set-cookie[0]` value (between the first `=` and `;`).
  3. `POST /categories` `{categoryName:'Manual', subCategories:['Uno'], icon:'manual'}` → 201; `CAT`.
  4. `POST /account-actions` `{title:'Manual 1', alias:'m1', accountType:'Debit', amount:1000, backgroundColor:'#000',
     color:'#fff'}` → `ACC1`; `title:'Manual 2'`, `amount:500` → `ACC2`; `title:'Manual 3'`, `amount:0` → `ACC3`.
  5. `POST /expenses-actions` (S7a step-6 body without budgets: `linkedBudgets:[]`, `indebtedPeople:[]`,
     `isPaid:false`, `date:NOW`, `account:ACC1`) with `amount:100` → `E1`, `amount:50` → `E2`. ACC1 `850`. Keep
     `MON`/`YYYY` = `E1`'s stored date UTC month (`Jan`..`Dec`) and year.
  6. `POST /incomes-actions` `{shortName:'Manual in', typeOfRecord:'income', description:'', amount:200, date:NOW,
     category:CAT, subCategory:'Uno', tag:[], indebtedPeople:[], account:ACC1, budgets:[], expensesPaid:[<E1 object
     from step 5's data.expense>, E2]}` → 201, `message` an array, `data.income.expensesPaid == [E1, E2]` (ids), no
     `isPaid` key; keep `INC`, `DATE = data.income.date` (Mexico wall clock, −6 h, ms 0). ACC1 `1050`;
     `GET /expenses-actions/$ACC1/$MON/$YYYY` → E1 and E2 `isPaid: true`.
  7. No-write check: step 6's body with `typeOfRecord:'expense'` → 400 `'Invalid type of record'`; ACC1 still `1050`.
  8. `PUT /incomes-actions` with step 6's fields, `recordId:INC`, `date:DATE`, `amount:250`, `expensesPaid:[{_id:E1}]`
     → 200, `data.income.expensesPaid[0]` = `{_id:E1, shortName, amountFormatted, fullDate, formattedTime}` only,
     category populated; ACC1 `1100`; listing → E1 `true`, E2 `false`.
  9. Same PUT with `account:ACC2` → 200; ACC1 `850`, ACC2 `750`. Repeat it → ACC2 still `750` (D9).
  10. Same PUT (ACC2) **without** `expensesPaid` → 200; E1 still `true`, `data.income.expensesPaid` still `[E1]` (Q8).
  11. `PUT /incomes-actions` with `recordId:'000000000000000000000000'` (+ date/category/amount) → 404 `'Expense not
      found.'`.
  12. `DELETE /incomes-actions {recordId:INC}` → 200 raw doc; ACC2 `500`; listing → E1 `false`. Repeat → 404 `'Income
      not found.'`.
  13. AC4: `POST /expenses-actions` on ACC3 `amount:10` → `E3`; `POST /incomes-actions` on ACC3 `amount:20`,
      `expensesPaid:[]` → `I3`. `DELETE /account-actions {accountId:ACC3}` → 200, `numberExpensesDeleted: 1`,
      `numberIncomesDeleted: 1`. (E3 and I3 are gone with it.)
  14. **Clean-up, in dependency order:** `DELETE /expenses-actions {recordId:E1}` and `{recordId:E2}` → 200; ACC1 back
      to `1000`. `DELETE /account-actions {accountId:ACC1}` and `{accountId:ACC2}` → 200 with `0`/`0` counts.
      `DELETE /categories {categoryId:CAT}` → 200. Then, with the token still valid: `GET /account-actions` →
      `accounts: []`, `GET /categories` → `[]`, `GET /expenses-actions/$ACC1/$MON/$YYYY` → `'Expenses not found.'`.
      Only then `DELETE /users` → 200.
  - On any failure after step 1, jump to step 14 with the current token (ids from the GETs; delete incomes, then
    expenses, so balances are restored; deleting an account also removes its remaining records). The orchestrator's
    independent check, read-only against the prod URI: `createexpenses.countDocuments({ userId: SUB })`,
    `createincomes.countDocuments({ userId: SUB })`, `categories` and `accounts` `countDocuments({ sub: SUB })`, and
    `users.countDocuments({ _id: SUB })` = 0 each. If not, delete leftovers by `userId`/`sub` with the owner's OK.
    Report `SUB` and the counts.

---

## AC Coverage Summary

| AC | Phase(s) | Automatic / manual | Coverage |
|---|---|---|---|
| AC1 — every `/incomes-actions` route matches develop (research §3), incl. `'Expense not found.'` on PUT | 2 (POST, DELETE), 3 (PUT) | both (e2e per route and error; manual 6–12) | full |
| AC2 — income balance rules (§5.1) for create/edit/delete, each in one transaction, characterization unit tests | 2 (create, delete), 3 (edit) | both (unit per row with signed deltas; e2e read-backs + one-shot failure rollbacks; manual 6, 8–12) | full |
| AC3 — `expensesPaid` accepts objects and id strings, flips only the caller's expenses, fixes bugs 6/7 (§5.3) | 2 (create, delete), 3 (edit) | both (unit + e2e incl. B's id, dangling id, kept-not-touched; manual 6, 8, 10, 12 with objects and strings) | full (cross-user cases are e2e-only; the prod run uses one user) |
| AC4 — account delete removes its records with real counts (real `ACCOUNT_RECORDS_CASCADE`, `AccountModule` default removed) | 1 | both (unit + e2e incl. rollback; manual 13) | full |
| AC5 — unit and e2e tests; `REPO_CONTEXT.md` updated | 1, 2, 3 | automatic (+ doc edit in 3) | full |

## Decisions (beyond the research)

- Names: `Income` (model, collection `createincomes`), `IncomeService`, `IncomeController`, `IncomeMutationResult`,
  util `toExpenseIds`, e2e file `test/records-incomes.e2e-spec.ts`.
- A malformed `expensesPaid` element → 400 before any write (research §14 assumption; legacy cast-failed with 400 too).
  Open question 1.
- The paid flip is one owner-filtered `updateMany` per direction (not per id); the "updated" count is `matchedCount`.
- The stored `expensesPaid` keeps the body's order, filtered to the caller's existing expenses, deduped.
- On edit with `expensesPaid`, stored foreign/dangling ids are dropped from the list (Q6 applied to old data too).
- Income edit mirrors the expense balance rule: `+= new − old` on the same account; on an account change old `−= old`,
  new `+= new` (research §5.1 "Income edit", proposed).
- `RECORD_UPDATABLE_FIELDS` moves to `record.constants.ts` and both services use it (no S7a behavior change).
- PUT `$set` drops `null` fields, like S7a; `expensesPaid` is only `$set` when sent (Q8).

## Assumptions

- Research and S7a plan assumptions accepted (develop = contract, old-next is the client, Lambda in UTC, D10 texts).
- old-next's income body has no `isPaid`/`linkedBudgets` (develop's `whitelist + forbidNonWhitelisted` would 400 them
  in prod today), so keeping them out of `CreateIncomeDto` breaks nothing.
- Unpaying an expense on income edit/delete ignores whether another income also lists it (legacy does the same).
- `deleteMany` inside the account-delete transaction on a not-yet-existing `createincomes`/`createexpenses` collection
  is fine (no write, no implicit create); `test/accounts.e2e-spec.ts`' 0/0 test proves it.
- Populate on the hydrated PUT result resolves `expensesPaid` to `Expense` docs and drops missing ids (develop).

## Implementation checklist

- [x] Phase 1 — CLI (service/controller registered in `RecordModule`), income entity, module wiring, cascade in
  `RecordPortsService` + spec, `AccountModule` default removed, e2e (AC4 counts + rollback, schema paths)
- [x] Phase 2 — constants (+ shared updatable fields), `toExpenseIds` + spec, income DTOs, interface,
  `createIncome` / `deleteIncome` + paid helpers + spec, POST/DELETE routes, e2e (balances, flags, errors with no write,
  rollback)
- [x] Phase 3 — `updateIncome` + spec, PUT route, e2e (bug 7, Q8, Q9, audit High, rollback), `REPO_CONTEXT.md`
- [x] Automatic: `pnpm run lint`, `pnpm run build`, `pnpm test`, `pnpm run test:e2e`
- [ ] Phase 3 manual run on the prod DB — orchestrator (steps 1–14 + leftover counts)
