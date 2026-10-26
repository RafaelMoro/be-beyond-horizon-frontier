# Plan: S7c — records-transfers-listing (`POST /records/transfer`, `GET /records/expenses-and-incomes`, D9 flows)

**Status:** APPROVED (2026-10-25). Owner answers: Q1 as recommended (contract errors stay 400 with develop's texts,
category/account 404/401 → 400 with the same text; a genuinely unexpected error → 500, D6). Q2 approved as written,
including the decisions beyond the research and Phase 3's stop-and-report rule for a failing D9 flow.

**Branch:** `feat/records-transfers-listing` (from `main` v0.10.0, which includes S7a and S7b) · **Date:** 2026-10-25 ·
**Research:** [`ai-research/records.research.md`](../ai-research/records.research.md) (S7c scope; §3 transfer row and
"What old-next sends", §4, §5.1 transfer rows, §6, §12 are the spec) · Pattern reference:
[`records-expenses.planning.md`](./records-expenses.planning.md), [`records-incomes.planning.md`](./records-incomes.planning.md)
and `src/record/` · Memory: [`records-research.md`](../memories/repo/records-research.md),
[`records-expenses-planning.md`](../memories/repo/records-expenses-planning.md),
[`records-incomes-planning.md`](../memories/repo/records-incomes-planning.md)

Owner decisions applied (`~/projects/notes/budget-master/be-refactor.md`):
- **D2** `account` is a string (query with the string), `category` Mixed (both stored types populate). **D11 / E7.Q3**
  `Jan`..`Dec` + 4-digit year, anything else → legacy's 200 empty answer (`getMonthBounds` already does it).
- **D9** no transfer edit/delete route; each side goes through its own S7a/S7b route, and a repeated call is safe.
- **E7.Q6 / E7b gate Q1** on the transfer income side: only the caller's existing expenses are stored and paid; a
  malformed `expensesPaid` element → 400 before any write.
- **D6** unknown errors → 500; **D10** `message: string[]` texts free; **D16** tests never touch prod, the manual run
  deletes all it creates.
- Research §7: category ownership on create (S7a/S7b do the same), here answered as 400 like every transfer error.

AC numbers are the tracker's S7c AC1–AC4 (= research §1 S7c). Contract tables are in the research, not repeated here.

Verified in the old-next clone (`main` 2e02a8f): transfer create body = `getValuesIncomeAndExpense`
(`src/shared/utils/records.utils.ts`): expense `{…, account: origin, typeOfRecord:'transfer', isPaid:true,
linkedBudgets:[], indebtedPeople:[]}`, income `{…, account: destination, expensesPaid: ExpensePaid[] objects,
typeOfRecord:'transfer', indebtedPeople:[]}`, no `transferRecord`. Edit (`useEditTransfer.tsx`): `PUT /expenses-actions`
then `PUT /incomes-actions`, accounts and ids resolved from the record and its `transferRecord`, no `transferRecord` in
either body, `typeOfRecord:'transfer'`. Delete (`DeleteRecordModal.tsx:66-76`): the two DELETEs fired without `await`
(parallel), through the BFF. Listing (`dashboard.lib.ts:76-90`): compares only `message === 'No incomes or expenses
found.'`, else reads `data.data.records`; the client tells the kind by key presence (`expensesPaid` / `isPaid`).

## Scope guard

**In:** `RecordService` + spec and `RecordController` (`/records`), `src/record/dtos/transfer.dto.ts`, new constants,
two `IncomeService` helpers made public (no behavior change), `test/records-transfers.e2e-spec.ts`,
`ai-skills/REPO_CONTEXT.md`.

**Out (don't add):** a transfer PUT/DELETE route or any cross-side effect on edit/delete (D9); keeping the two sides
in sync on edit; `transferRecord` validation on the S7a/S7b PUTs (research §12: stays client-writable); legacy's
unreachable `'Transfer record is missing.'` check; budget effects for transfers (the expense side must have no
budgets); pagination; the prod index script (S8, the index is already declared on both schemas).

## CLI note

Run both up front; check that generated relative imports end in `.js` and that the CLI added `RecordService` /
`RecordController` to `RecordModule` (verify). Change the schematic's `@Controller('record')` to
`@Controller('records')`.

```bash
pnpm nest g s record/services/record --flat
pnpm nest g co record/controllers/record --flat --no-spec
```

---

## Phase 1 — `GET /records/expenses-and-incomes/:accountId/:month/:year` (AC2)

**Changes**

1. CLI: the 2 commands above (Phase 2 adds the transfer to the same service and controller).
2. `src/record/record.constants.ts` — add develop's `domain/records/constants` texts: `NO_EXPENSES_INCOMES_FOUND = 'No
   incomes or expenses found.'`, `NO_EXPENSES_FOUND = 'No expenses found.'`, `NO_INCOMES_FOUND = 'No incomes found.'`.
3. `RecordService` — inject `Expense` and `Income` models (Phase 2 adds the rest).
   ```
   findByAccountAndMonth({ sub, accountId, month, year }): Promise<GeneralResponse>
     bounds = getMonthBounds(month, year)
     null → 200 { ...INITIAL_RESPONSE, message: NO_EXPENSES_INCOMES_FOUND, data: null }    // no query (Q3)
     filter = { userId: sub, account: accountId, date: { $gte: start, $lt: end } }         // no typeOfRecord: transfers included
     expenses = expenseModel.find(filter).populate(CATEGORY_POPULATE).populate('linkedBudgets').lean()
     incomes  = incomeModel.find(filter).populate(EXPENSES_PAID_POPULATE).populate(CATEGORY_POPULATE).lean()
     both empty   → message NO_EXPENSES_INCOMES_FOUND, data: null
     no expenses  → message NO_EXPENSES_FOUND, data: { records: sorted incomes }
     no incomes   → message NO_INCOMES_FOUND,  data: { records: sorted expenses }
     both         → message null,              data: { records: sorted [...expenses, ...incomes] }
     sort = (a, b) => +b.date − +a.date        // legacy compareDateAndTime; stable, so expenses first on ties
   ```
   Lean keeps the stored keys (no `linkedBudgets: []` / `expensesPaid: []` added to docs that lack them), as legacy's
   aggregate. The two queries run one after the other (no session involved, either order is fine).
4. `RecordController` — `@Controller('records')`, `@Get('expenses-and-incomes/:accountId/:month/:year')` with the three
   `@Param`s and `req.user.sub`, like `ExpenseController.getExpenses`.

**Edge cases**
- A foreign, unknown or non-ObjectId `accountId` matches nothing → 200 `'No incomes or expenses found.'` (no cast: the
  path is `String`).
- Bounds are UTC `[start, end)`: a record at `YYYY-MM-01T00:00:00.000Z` is in, one at the next month's first instant is out.
- Legacy-shaped docs (ObjectId `category`, no `linkedBudgets` key, `transferRecord` strings) are listed and populated; a
  missing category populates to `null`, missing `expensesPaid`/`linkedBudgets` ids drop out (develop).
- Another user's record carrying the same `account` string is never listed (`userId: sub`).

**Test coverage**
- Unit `record.service.spec.ts` (mocked models with chainable `find().populate().populate().lean()`): bad month/year →
  no query and the empty answer; the filter has `userId`, the account string and the UTC bounds and **no**
  `typeOfRecord`; the populate paths per model; the four message/data variants; sort is date desc and keeps expenses
  before incomes on equal dates.
- e2e `test/records-transfers.e2e-spec.ts` (new; `await expenseModel.init()`, `await incomeModel.init()` in
  `beforeAll`; signup/login + account/category helpers copied from `records-incomes.e2e-spec.ts`; seed with
  `model.collection.insertOne` to keep legacy shapes): 401 without a token; seed on A's account in one month: a
  legacy expense (ObjectId category, no `linkedBudgets` key), a new-shape expense with a linked budget, a transfer
  expense, an income with a string category and an `expensesPaid` id, a transfer income; plus one record at
  `start − 1 ms`, one at `end`, one on A's other account and one of B's with the same account string → 200, `message:
  null`, exactly the 5 in date-desc order, populated shapes per research §6 (expenses: category `{_id, categoryName,
  icon}`, full budget docs; incomes: `expensesPaid` `{_id, shortName, amountFormatted, fullDate, formattedTime}`),
  no `linkedBudgets` key on the legacy expense, no `isPaid` on incomes, no `expensesPaid` on expenses. Only incomes →
  `'No expenses found.'`; only expenses → `'No incomes found.'`; none → `'No incomes or expenses found.'`, `data:
  null`; `jan`, `January`, `13`, year `25` → the empty answer; B listing A's account → empty.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none here (no data created; the prod run in Phase 3 covers the listing).

---

## Phase 2 — `POST /records/transfer` (AC1)

**Changes**

1. `src/record/dtos/transfer.dto.ts` — create `CreateTransferDto { @IsNotEmpty() @ValidateNested() @Type(() =>
   CreateExpenseDto) expense; @IsNotEmpty() @ValidateNested() @Type(() => CreateIncomeDto) income }` (develop's
   `transfer.dto.ts`). Nested whitelisting keeps key presence: `isPaid` on the income or `expensesPaid` on the
   expense → 400.
2. `src/record/record.constants.ts` — `TRANSFER_ACCOUNT_ERROR = 'Income account and expense account must be
   different'`, `TRANSFER_EXPENSE_NOT_PAID = 'The expense transfer record must have value isPaid as true'`,
   `TRANSFER_EXPENSE_BUDGETS = 'The expense transfer record cannot have linked budgets'`, and
   `transferMismatch(field) => \`Transfer records has different ${field}. Both must have the same value\`` used with
   `'short name' | 'amounts' | 'dates' | 'category' | 'subCategory'` (develop's exact texts).
3. `src/record/record.interface.ts` — `TransferMutationResult { expense: ExpenseDoc; income: IncomeDoc; messages:
   string[] }`.
4. `IncomeService` — `ownedExpenseIds` and `payExpenses` go from `private` to public (their comment already names
   S7c). No other change.
5. `RecordService` — also inject `@InjectConnection() connection`, `AccountService`, `CategoryService`, `IncomeService`
   (same module, no cycle).
   ```
   createTransfer(sub, { expense, income }): Promise<GeneralResponse>
     // develop's validateTransferData order, pure, all 400:
     expense.typeOfRecord !== 'transfer' || income.typeOfRecord !== 'transfer' → TYPE_OF_RECORD_INVALID
     !expense.isPaid                         → TRANSFER_EXPENSE_NOT_PAID
     expense.linkedBudgets.length > 0        → TRANSFER_EXPENSE_BUDGETS
     expense.account === income.account      → TRANSFER_ACCOUNT_ERROR
     shortName / amount / date.getTime() / category / subCategory differ → transferMismatch(...)   // in that order
     ids = toExpenseIds(income.expensesPaid); null → 400 INVALID_EXPENSES_PAID
     expenseId = new Types.ObjectId(); incomeId = new Types.ObjectId()       // outside fn: a retry rewrites the same ids
     try {
       { expense, income, messages } = await connection.transaction(async (session) => {
         messages = []
         await categoryService.assertCategoryOwned(expense.category, sub)
         await accountService.assertAccountOwned({ accountId: expense.account, sub, session })   // expense first (develop)
         await accountService.assertAccountOwned({ accountId: income.account, sub, session })
         date = toMexicoCityWallClock(expense.date)                         // both sides get the same shifted date
         common = { date, ...formatDateToString(date), amountFormatted: formatNumberToCurrency(expense.amount), userId: sub }
         [e] = expenseModel.create([{ ...expense, ...common, _id: expenseId,
                 transferRecord: { transferId: String(incomeId), account: income.account } }], { session })
         owned = incomeService.ownedExpenseIds({ ids, sub, session })
         [i] = incomeModel.create([{ ...income, ...common, _id: incomeId, expensesPaid: owned,
                 transferRecord: { transferId: String(expenseId), account: expense.account } }], { session })
         incrementBalance({ accountId: expense.account, sub, delta: −expense.amount, session })   // research §5.1
         incrementBalance({ accountId: income.account,  sub, delta: +income.amount,  session })
         await incomeService.payExpenses({ ids, owned, sub, messages, session })
         return { expense: e, income: i, messages }
       })
     } catch (e) {
       // develop answers every transfer error with 400; our own 404/401 texts only, never a library message.
       if (e instanceof NotFoundException || e instanceof UnauthorizedException) throw new BadRequestException(e.message)
       throw e                                                             // unknown → 500 (D6), open question 1
     }
     return 201 { ...INITIAL_RESPONSE, message: messages, data: { expense, income } }   // unpopulated (develop)
   ```
   A body `transferRecord` is overwritten (develop overwrote it with its `$set`). The expense stores the DTO's
   `linkedBudgets: []` and `isPaid: true`.
6. `RecordController` — `@Post('transfer')` (`CreateTransferDto`, `req.user.sub`); Nest's default 201.

**Edge cases**
- `expense.date` and `income.date` equal to the millisecond pass; 1 ms apart → 400 `'… different dates …'`.
- Foreign or missing category → 400 `'Category not found'`; missing account → 400 `'Account not found'`, foreign →
  400 `'Account does not belong to the user'`; the expense account is checked first. Nothing is written.
- `expensesPaid` with A's expense object, A's id string, B's id and an unknown id → the income stores the two owned ids
  and they become paid; B's stays unpaid (Q6). A malformed element → 400 after the legacy checks, nothing written.
- `amount` 0 and negatives pass (develop has no check); balances move by the signed amount.
- A transaction retry reuses `expenseId`/`incomeId` (the aborted inserts were rolled back), so the cross-links stay right.

**Test coverage**
- Unit `record.service.spec.ts` (mocked models, `transaction: vi.fn((fn) => fn(session))`, mocked `AccountService`,
  `CategoryService`, `IncomeService`): one test per validation step in develop's order with its text, each making
  no transaction call (the first failing check wins when two fail); malformed `expensesPaid` → 400 after them;
  category/account 404 and 401 → 400 with the same text and no `create`; an unknown error is not wrapped; both
  `create` calls get the same shifted date and formats, `userId: sub`, the cross-linked `transferRecord`s and the
  session; the income gets only the owned ids; `incrementBalance` deltas `−amount` on the expense account and
  `+amount` on the income account; `payExpenses` gets `ids` and `owned`.
- e2e: happy path with old-next's body (`expensesPaid` = [A's expense object, A's id string, B's id, unknown id]) →
  201, `message` a string array, `data.expense.transferRecord == {transferId: income._id, account: income account}`
  and vice versa, both dates = the Mexico wall clock (S7a vector), no `expensesPaid` key on the expense, no `isPaid`
  on the income, `income.expensesPaid` = the two owned ids; balances origin `−amount`, destination `+amount`; A's two
  expenses paid, B's not. Errors (each asserts 400 with develop's text, **no new doc in either collection, both
  balances and all flags unchanged**): each validation step; `isPaid` on the income; malformed `expensesPaid`;
  B's category; missing account; B's account as destination. Atomicity: a one-shot failing `incrementBalance` on the
  second (income) call, via a spy on the real `AccountService` → 500, no transfer doc, origin balance unchanged.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none here (the prod run in Phase 3 creates and deletes a transfer).

---

## Phase 3 — old-next's transfer edit/delete flows (D9), docs, manual run on prod (AC3, AC4)

No production code is expected here: S7a/S7b's PUT and DELETE already move only their own side's account and skip
unchanged amounts. If a flow below fails, stop and report instead of adding a transfer-aware path (D9).

**Changes**

1. `test/records-transfers.e2e-spec.ts` — the D9 block (test coverage below).
2. `ai-skills/REPO_CONTEXT.md` — overview (S7c records-transfers-listing), `record.service.ts` (+ .spec),
   `record.controller.ts` and `dtos/transfer.dto.ts` in the `record/` tree, `record.constants.ts` line (listing and
   transfer texts), `record.interface.ts` line (`TransferMutationResult`), `income.service.ts` line (the two shared
   helpers), the 2 `/records` routes in the route table, `test/records-transfers.e2e-spec.ts` in the test list, and
   remove "transfers and the `/records` listing (S7c)" from "Does not exist yet", so records no longer appear there.

**Edge cases**
- old-next sends the record's own accounts on edit, so no balance moves to another account; only an amount change
  moves both sides (expense account `−(new − old)`, income account `+(new − old)`), each through its own call.
- `transferRecord` is not in the edit bodies, so both stay as created.
- The two DELETEs touch different docs and accounts: no write conflict; if one ever happens, mongoose's
  `connection.transaction` retries it.
- The income DELETE unpays its `expensesPaid` (S7b); the transfer expense is never in that list.
- A repeated DELETE → 404 `'Expense not found.'` / `'Income not found.'` and nothing changes.

**Test coverage**
- e2e (all through the routes, starting from a `POST /records/transfer` of 200 from A1 to A2 that pays expense E1):
  - Edit, old-next's two bodies in sequence (expense side: `recordId`, `account: A1`, `amount: 250`, `budgets: []`,
    `category`, `date` = the stored date, `description`, `indebtedPeople: []`, `isPaid: true`, `linkedBudgets: []`,
    `shortName`, `subCategory`, `tag`, `typeOfRecord: 'transfer'`; income side: the same without `isPaid` /
    `linkedBudgets`, with `account: A2` and `expensesPaid: [E1 object]`) → both 200; A1 `−50`, A2 `+50`; both stored
    `typeOfRecord: 'transfer'`, `transferRecord` unchanged; E1 still paid. Repeat both PUTs → balances, flags and docs
    unchanged.
  - Same from the income side (the record opened is the income: its own `_id`, `transferRecord.transferId` for the
    expense) → same result.
  - Delete with `Promise.all([DELETE /expenses-actions, DELETE /incomes-actions])` → both 200; A1 and A2 back to their
    pre-transfer balances, both docs gone, E1 unpaid. Repeat in parallel → 404 / 404, nothing changes.
  - The listing after each step shows both sides on their accounts (A1 lists the transfer expense, A2 the income).

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e` (CI repeats e2e on the docker replica set).
- Manual (orchestrator, `pnpm run start:dev` on the owner's `.env` = **prod DB**, D16). **Creates 1 `users` doc, 1
  category, 2 accounts, 1 expense and 1 transfer (1 expense + 1 income), and deletes all of them in this phase.**
  Never touch existing prod docs. `TS=$(date +%s)`, `EMAIL=e2e-manual-$TS@example.invalid` (no real mail), throwaway
  password, base `http://localhost:3000`, JSON bodies, `Authorization: Bearer $TOKEN` after step 2. `NOW` = current
  ISO instant. Balances are read with `GET /account-actions`.
  1. `POST /users` `{email, password, firstName:'Manual', lastName:'Check', middleName:''}` → 201; `SUB =
     data.userCreated.sub`.
  2. `POST /auth` `{email, password}` → 201; `TOKEN` = the `set-cookie[0]` value (between the first `=` and `;`).
  3. `POST /categories` `{categoryName:'Manual', subCategories:['Uno'], icon:'manual'}` → 201; `CAT`.
  4. `POST /account-actions` `{title:'Manual 1', alias:'m1', accountType:'Debit', amount:1000, backgroundColor:'#000',
     color:'#fff'}` → `ACC1`; `title:'Manual 2'`, `amount:500` → `ACC2`.
  5. `GET /records/expenses-and-incomes/$ACC1/Jan/2000` → 200 `'No incomes or expenses found.'`, `data: null`;
     `…/$ACC1/jan/2025` → the same.
  6. `POST /expenses-actions` `{shortName:'Manual', typeOfRecord:'expense', description:'', amount:100, date:NOW,
     category:CAT, subCategory:'Uno', tag:[], indebtedPeople:[], account:ACC1, budgets:[], isPaid:false,
     linkedBudgets:[]}` → `E1` (keep `data.expense` as `E1OBJ`); ACC1 `900`. `MON`/`YYYY` = `E1`'s stored date UTC
     month (`Jan`..`Dec`) and year. `GET /records/expenses-and-incomes/$ACC1/$MON/$YYYY` → `'No incomes found.'`,
     `records` = [E1].
  7. `POST /records/transfer` with old-next's body: `expense = {shortName:'Manual tr', description:'', amount:300,
     date:NOW2, category:CAT, subCategory:'Uno', tag:[], budgets:[], indebtedPeople:[], account:ACC1,
     typeOfRecord:'transfer', isPaid:true, linkedBudgets:[]}`, `income` = the same fields without `isPaid` /
     `linkedBudgets`, with `account:ACC2` and `expensesPaid:[E1OBJ]` (`NOW2` = a fresh ISO instant, later than E1) →
     201, `message` an array; keep `TE = data.expense._id`, `TI = data.income._id`, `DATE = data.expense.date`.
     Check `data.expense.transferRecord == {transferId:TI, account:ACC2}`, `data.income.transferRecord ==
     {transferId:TE, account:ACC1}`, `data.income.expensesPaid == [E1]`, no `isPaid` key on the income, no
     `expensesPaid` key on the expense. ACC1 `600`, ACC2 `800`; `GET /expenses-actions/$ACC1/$MON/$YYYY` → E1 `isPaid:
     true` (the transfer expense isn't listed there: `typeOfRecord:'expense'` only).
  8. No-write checks, each → 400 with develop's text and ACC1 `600`, ACC2 `800` afterwards: step 7's body with
     `income.amount:301` (`'Transfer records has different amounts. Both must have the same value'`); with
     `income.account:ACC1` (`'Income account and expense account must be different'`); with
     `expense.account:'000000000000000000000000'` (`'Account not found'`).
  9. Listings: `…/$ACC1/$MON/$YYYY` → `'No incomes found.'` (ACC1 has only expenses; develop; corrected in the manual run), `records` = [TE, E1] (date desc), TE with `isPaid` and
     populated `category`; `…/$ACC2/$MON/$YYYY` → `'No expenses found.'`, `records` = [TI] with `expensesPaid[0] ==
     {_id:E1, shortName, amountFormatted, fullDate, formattedTime}`. (If step 7 crossed into the next Mexico City
     month, use TE's month for these two calls.)
  10. Edit like old-next: `PUT /expenses-actions {recordId:TE, account:ACC1, amount:350, budgets:[], category:CAT,
      date:DATE, description:'', indebtedPeople:[], isPaid:true, linkedBudgets:[], shortName:'Manual tr',
      subCategory:'Uno', tag:[], typeOfRecord:'transfer'}` → 200; then `PUT /incomes-actions {recordId:TI,
      account:ACC2, amount:350, budgets:[], category:CAT, date:DATE, description:'', expensesPaid:[{_id:E1}],
      indebtedPeople:[], shortName:'Manual tr', subCategory:'Uno', tag:[], typeOfRecord:'transfer'}` → 200. ACC1
      `550`, ACC2 `850`. Repeat both PUTs → ACC1 `550`, ACC2 `850` (D9). The listings still show both
      `transferRecord`s unchanged.
  11. Delete like old-next, in parallel: `curl … DELETE /expenses-actions {recordId:TE} & curl … DELETE
      /incomes-actions {recordId:TI} & wait` → both 200. ACC1 `900`, ACC2 `500`; E1 `isPaid: false`. Repeat both in
      parallel → 404 `'Expense not found.'` and 404 `'Income not found.'`; balances unchanged.
  12. **Clean-up, in dependency order:** `DELETE /expenses-actions {recordId:E1}` → 200; ACC1 `1000`. `DELETE
      /account-actions {accountId:ACC1}` and `{accountId:ACC2}` → 200 with `0`/`0` counts. `DELETE /categories
      {categoryId:CAT}` → 200. Then, with the token still valid: `GET /account-actions` → `accounts: []`, `GET
      /categories` → `[]`, `GET /records/expenses-and-incomes/$ACC1/$MON/$YYYY` → `'No incomes or expenses found.'`.
      Only then `DELETE /users` → 200.
  - On any failure after step 1, jump to step 12 with the current token (ids from the GETs; delete the transfer
    income and expense and E1 through their routes so balances are restored; deleting an account also removes its
    remaining records). The orchestrator's independent check, read-only against the prod connection:
    `createexpenses.countDocuments({ userId: SUB })`, `createincomes.countDocuments({ userId: SUB })`, `categories`
    and `accounts` `countDocuments({ sub: SUB })`, and `users.countDocuments({ _id: SUB })` = 0 each. If not, delete
    leftovers by `userId`/`sub` with the owner's OK. Report `SUB` and the counts.

---

## AC Coverage Summary

| AC | Phase(s) | Automatic / manual | Coverage |
|---|---|---|---|
| AC1 — transfer validation order kept, every error 400, both docs + both balances in one transaction | 2 | both (unit per step and order; e2e per error with no write + one-shot failure rollback; manual 7–8) | full for the contract errors; an unexpected server error is 500 (D6, open question 1) |
| AC2 — listing returns old and new records (D2/D11), UTC month bounds, date desc, four `message` variants | 1 | both (unit; e2e with seeded legacy shapes and boundary records; manual 5, 6, 9, 12) | full (legacy-shaped docs are e2e-only; the prod run creates new-shape docs) |
| AC3 — old-next's transfer edit (two PUTs) and parallel deletes keep both balances right; a repeated second call changes nothing (D9) | 3 (on 2's create) | both (e2e from both sides, repeats; manual 10–11) | full |
| AC4 — unit + e2e (+ `REPO_CONTEXT.md` without "Does not exist yet" for records) | 1, 2, 3 | automatic (+ doc edit in 3) | full |

## Decisions (beyond the research)

- Names: `RecordService`, `RecordController` (`/records`), `CreateTransferDto`, `TransferMutationResult`,
  `transferMismatch`, e2e file `test/records-transfers.e2e-spec.ts`.
- The transfer lives in `RecordService`, which reuses `IncomeService.ownedExpenseIds` / `payExpenses` (made public)
  instead of duplicating the paid-flag path.
- Both `_id`s are generated before the transaction and each doc is inserted once with its `transferRecord` (no
  create-then-`$set` as develop): same stored result, one write per doc.
- Only our own `NotFoundException` / `UnauthorizedException` are turned into 400 (same text); unknown errors stay 500
  (open question 1).
- The malformed-`expensesPaid` 400 comes after develop's checks and before any read.
- The paid-flag step messages are always pushed (develop pushed them only when `expensesPaid` was non-empty; D10).
- Phase 3 adds no production code; a failing D9 flow is a stop-and-report, not a new path.

## Assumptions

- Research and S7a/S7b plan assumptions accepted (develop = contract, old-next is the client, Lambda in UTC, D10 texts).
- `CATEGORY_NOT_FOUND_ERROR` is `'Category not found'` and `ACCOUNT_NOT_FOUND` / `ACCOUNT_UNAUTHORIZED_ERROR` are
  develop's texts (S4/S5), so the 400s carry develop's messages.
- Nested `ValidateNested` + `@Type` applies the global `whitelist` / `forbidNonWhitelisted` and the `date` transform
  inside `expense` / `income` (as develop's pipe did).
- Lean populate over the Mixed `category` + `ref` resolves both stored types (proven in S7a's e2e).
- `Array.prototype.sort` is stable (Node ≥ 12), which keeps develop's expenses-first order on equal dates.

## Open questions (before implementation)

1. **Unexpected errors on `POST /records/transfer`.** develop wraps every error, including DB failures, into 400.
   *Recommend:* every contract error (validation, category, accounts, malformed `expensesPaid`) is 400 with develop's
   text; a genuinely unexpected error (e.g. the DB down) is 500 per D6. old-next shows the same fixed toast on any
   non-2xx (`TransferTemplate.tsx:113-121`), so it can't tell them apart.
2. **Plan approval.** *Recommend:* approve as written (3 phases, no new code for D9).

## Implementation checklist

- [x] Phase 1 — CLI (service/controller registered in `RecordModule`), listing constants, `findByAccountAndMonth` +
  spec, GET route, e2e (legacy shapes, bounds, order, 4 messages, bad month/year)
- [x] Phase 2 — transfer DTO, constants, interface, `IncomeService` helpers public, `createTransfer` + spec, POST route,
  e2e (happy path, each error with no write, rollback)
- [x] Phase 3 — D9 e2e (edit both sides + repeat, parallel delete + repeat), `REPO_CONTEXT.md`
- [x] Automatic: `pnpm run lint`, `pnpm run build`, `pnpm test`, `pnpm run test:e2e`
- [ ] Phase 3 manual run on the prod DB — orchestrator (steps 1–12 + leftover counts)

### Implementation notes (2026-10-25)

- `pnpm nest g s record/services/record --flat` generated `RecordService` with no clash with `record.module.ts`; the
  CLI registered `RecordService` and `RecordController` in `RecordModule`. No deviation in names.
- D9 flows passed as-is (edit from both sides + repeat, parallel deletes + repeat): no production code in Phase 3.
- The listing e2e's "B listing A's account": B's own record carrying A's account string is listed for B (only it);
  B listing A's other account (no B records there) → the empty answer. Both prove the `userId` scope.
- `createTransfer` pushes only `payExpenses`' messages (the plan's pseudocode); no extra step texts.
