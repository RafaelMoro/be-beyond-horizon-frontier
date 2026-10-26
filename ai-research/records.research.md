# Research: S7 records — expenses, incomes, transfers, monthly listing

**Date:** 2026-10-25 · **Branch:** `feat/records` (stacked on `feat/budgets-and-history`, PR #8)
**Sources:** legacy `be-budgt-master` `origin/develop` (contract), notes `be-refactor.md` (D2, D6, D9, D10, D11, E4–E6,
security findings), `be-refactor-survey.md` §2.2/§4/§5, `be-refactor-db-checks.md` §1, `be-refactor-next-clients.md`,
`be-refactor-frontend-usage.md`, the old-next clone (`main` 2e02a8f), and this repo's `src/account`, `src/budget`, `src/category`.
Legacy paths below are `origin/develop:<path>`. old-next paths are relative to its repo root.

## 1. Story and split

Port the five record route groups onto `createexpenses`/`createincomes` with the legacy contract, and implement the two
ports S5/S6 left behind. The work is too big for one plan: it splits into three stories (an epic). Each one is a
separate PR in dependency order: **S7a → S7b → S7c**. All three share one `record` module (Q1).

### S7a — records-expenses
`record` module, `createexpenses` schema, the date/format helpers, `POST/PUT/DELETE /expenses-actions`,
`GET /expenses-actions/:accountId/:month/:year`, linked-budget effects, and `BUDGET_EXPENSES_UNLINK`.
- AC1: Every `/expenses-actions` route matches §3 (DTO fields and required-ness, statuses, error texts,
  `'Expenses not found.'` with `data.expenses: []`). `message` is a `string[]` on mutations (D10).
- AC2: The account balance and the linked budgets' `currentAmount`/history after create, edit and delete follow §5.1 and
  §5.2. Each mutation runs in one transaction: a failure leaves nothing written. Unit tests (characterization) cover
  each rule.
- AC3: Ownership: a foreign or missing category gives 404 `'Category not found'`, account 404/401, budget 400, and a
  PUT can't move a record to another user's account. Nothing is written in any of these cases.
- AC4: Deleting a budget pulls it from the owner's expenses' `linkedBudgets` (port), in the budget-delete transaction.
- AC5: Unit and e2e tests; `REPO_CONTEXT.md` updated.

### S7b — records-incomes (depends on S7a)
`createincomes` schema, `POST/PUT/DELETE /incomes-actions`, `expensesPaid` paid flags, `ACCOUNT_RECORDS_CASCADE`.
- AC1: Every `/incomes-actions` route matches §3 (incl. the `'Expense not found.'` (sic) on PUT).
- AC2: Balance rules in §5.1 for income create, edit and delete, each in one transaction, with characterization unit tests.
- AC3: `expensesPaid` accepts expense objects and id strings. Only the caller's expenses are flipped or stored. Edit
  unpays only the removed ones and pays the added ones. A missing id doesn't crash (§5.3).
- AC4: Account delete removes the account's expenses and incomes in its transaction and returns the real counts.
- AC5: Unit and e2e tests; `REPO_CONTEXT.md` updated.

### S7c — records-transfers-listing (depends on S7b)
`POST /records/transfer`, `GET /records/expenses-and-incomes/:accountId/:month/:year`, and the D9 flows.
- AC1: Transfer create matches §3 (validation order, every error is 400, `data { expense, income }` with
  `transferRecord` on both). Both docs and both balances are written in one transaction.
- AC2: The listing returns old (string `account`, string or ObjectId `category`) and new records for `Jan`..`Dec` +
  4-digit year, in UTC month bounds, sorted by date descending, with the four legacy `message` variants (§6).
- AC3: old-next's transfer edit (two PUTs) and delete (two DELETEs, sent in parallel) leave both balances right,
  and a repeated second call changes nothing (D9). e2e coverage.
- AC4: Unit and e2e tests; `REPO_CONTEXT.md` updated.

## 2. Data model (prod facts, db-checks §1)

| field | createexpenses (4195) | createincomes (881) | Declare as |
|---|---|---|---|
| `account` | string ×4194, missing ×1 | string ×881 | `String`, required (D2). Query with the string |
| `userId` | string | string | `String`, required (the JWT `sub`) |
| `category` | string 3819 / ObjectId 375 | string 849 / ObjectId 32 | **Mixed + `ref: Category.name`** (Q4). Writes store the DTO string |
| `transferRecord` | `{transferId, account}` strings, 692 docs | 690 docs | nested `{transferId: String, account: String}`, optional |
| `linkedBudgets` | ObjectId elements (19, arrays on 3650 docs, missing on 545) | absent | `[mongoose.Schema.Types.ObjectId]`, `ref: Budget.name` |
| `expensesPaid` | absent | ObjectId elements (2396, array on all) | `[mongoose.Schema.Types.ObjectId]`, `ref` = the expense model name |
| `date` | Date | Date | `Date`, **not** required (legacy) |

Other legacy paths (`records.entity.ts`, `expenses.entity.ts`, `incomes.entity.ts`): `shortName`, `typeOfRecord`,
`amount` (Number), `amountFormatted`, `fullDate`, `formattedTime`, `subCategory` are required. `description` is
optional. `tag: [String]`, `budgets: [String]` (deprecated, the FE sends `[]`). `indebtedPeople` is a subdoc array
`{name, amount, amountPaid, isPaid}` and keeps its `_id`. Expenses add `isPaid` (Boolean, required); incomes have no
`isPaid`. No timestamps, default `__v`. Collections are pinned with `collection: 'createexpenses'` / `'createincomes'`.

- Why legacy wrote strings: `@Prop({ type: Types.ObjectId })` through `SchemaFactory` becomes **Mixed** (S4 research
  memory). So `category` and `account` were Mixed in the legacy runtime, and populate on the Mixed `category` + `ref`
  path worked against both stored types (prod listing shows categories).
- **Key presence is the record kind on the client** (frontend-usage §4, old-next `DeleteRecordModal.tsx:66`):
  expenses must never get `expensesPaid` and incomes must never get `isPaid`, transfers included. The two schemas must
  keep those paths separate.
- Hydrated docs add `[]` for missing array paths (545 old expenses lack `linkedBudgets`). Legacy listings were
  `aggregate` output, so they show the stored keys only. Use lean reads for the listings to keep that shape.
- Dirty prod data: 1 expense with only `_id, isPaid, budgets, __v` (no `userId`, so it can't be reached). 3 records
  point to missing accounts and 8 to missing categories. None of them can be reached through the client (a missing
  account is never listed; editing a record with a missing category makes the user pick one).
- Existing prod indexes: `createexpenses` has `date_1` and `userId_1`; `createincomes` has only `_id_`.

## 3. HTTP contract (develop)

All routes need the JWT. POST → 201, others → 200. `message` is a `string[]` step log on mutations. Its texts are
free to change (D10), but the type should stay. Legacy texts are in `domain/records/constants/index.ts`,
`repositories/expenses/expenses.constants.ts` and `repositories/incomes/incomes.constants.ts`.

### DTOs (legacy `records.dto.ts`, `expenses.dto.ts`, `incomes.dto.ts`, `transfer.dto.ts`)
`CreateRecordDto`: `shortName` IsString+IsNotEmpty · `typeOfRecord` IsString+IsNotEmpty · `description` IsString
(required, `''` ok) · `amount` IsNumber+IsNotEmpty (0 and negatives pass) · `date` IsDate + `@Type(() => Date)` ·
`category` IsMongoId · `subCategory` IsString+IsNotEmpty · `tag` IsArray · `indebtedPeople` ValidateNested +
`Type(IndebtedPeople{name, amount, amountPaid, isPaid: IsNotEmpty only})` · `transferRecord` ValidateNested +
`Type(TransferRecord{transferId, account: IsNotEmpty})` · `account` IsMongoId · `budgets` IsArray (required).
Both nested fields are optional only when omitted: `null` → 400 `nested property … must be either object or array`.
- Expense: `+ isPaid` IsBoolean, `+ linkedBudgets` IsArray (elements not validated; the FE sends id strings).
- Income: `+ expensesPaid` IsArray, required on create (elements not validated; **the FE sends expense objects**).
- Update DTOs: every field optional (`PartialType`), plus `recordId` IsMongoId. This repo writes partials by hand (see
  `account.dto.ts`). Delete DTOs: `{recordId}` IsMongoId.
- Transfer: `{expense: CreateExpenseDto, income: CreateIncomeDto}`, both IsNotEmpty + ValidateNested.
- **Legacy bug, verified with legacy class-validator:** `IndebtedPeople` has no `_id`, so with `forbidNonWhitelisted`
  an element carrying `_id` gives 400 `property _id should not exist`. Stored subdocs have `_id`, and old-next echoes
  `editRecord.indebtedPeople` on expense edit (`ExpenseTemplate.tsx:142,208`). So **editing an expense that has
  indebted people always fails today**. Q7.

### Routes

| Route | Success | Errors (in check order) |
|---|---|---|
| `POST /expenses-actions` | 201, `data.expense` with `category` (`_id categoryName icon`) and `linkedBudgets` (full budget docs) populated | `typeOfRecord==='transfer'` and budgets present → 400 `'Transfer record cannot be linked to budget'`; type ≠ `'expense'` → 400 `'Invalid type of record'`; more than 3 budgets → 400 `'The maximum number of budgets are 3'`; category → 404 `'Category not found'`; account → 404 `'Account not found'` / 401 `'Account does not belong to the user'` |
| `PUT /expenses-actions` | 200, `data.expense` (only `category` populated) | missing/falsy, in this order: 400 `'date prop is missing.'`, `'category prop is missing.'`, `'amount prop is missing.'` (so amount 0 → 400), `'linkedBudgets prop is missing.'`; 404 `'Expense not found.'`; 401 `'This expense does not belongs to the user'`; category 404. `typeOfRecord` is **not** checked (old-next's transfer edit sends `'transfer'`) |
| `DELETE /expenses-actions` | 200, `data.expense` = the deleted doc (raw) | 404 `'Expense not found.'`; 401 `'This expense does not belongs to the user'` |
| `GET /expenses-actions/:accountId/:month/:year` | 200, `data.expenses` = `typeOfRecord:'expense'` only (no transfers), category and linkedBudgets populated, **unsorted**, `message: null`. Empty → `message:'Expenses not found.'`, `data:{expenses:[]}` | none in practice (see §6) |
| `POST /incomes-actions` | 201, `data.income` **unpopulated** | type ≠ `'income'` → 400 `'Invalid type of record'`; category 404; account 404/401 |
| `PUT /incomes-actions` | 200, `data.income` with `expensesPaid` (`_id shortName amountFormatted fullDate formattedTime`) and `category` populated | 400 missing date/category/amount (same texts, no linkedBudgets check); 404 **`'Expense not found.'`** (sic, `incomes.service.ts:66`); 401 `"You're unauthorized to see these incomes."`; category 404. A missing `expensesPaid` gives a TypeError 400 *after* the writes (Q8) |
| `DELETE /incomes-actions` | 200, `data.income` raw | 404 `'Income not found.'`; 401 `'This income does not belongs to the user'` |
| `POST /records/transfer` | 201, `data { expense, income }`, raw, each with `transferRecord {transferId: <other _id>, account: <other account>}` | **all 400** (the catch wraps everything), in order: either type ≠ `'transfer'` → `'Invalid type of record'`; `!expense.isPaid` → `'The expense transfer record must have value isPaid as true'`; expense budgets present → `'The expense transfer record cannot have linked budgets'`; same account → `'Income account and expense account must be different'`; then `'Transfer records has different short name\|amounts\|dates\|category\|subCategory. Both must have the same value'` (`date` compared by `getTime()` before the shift); then `'Category not found'`, `'Account not found'`, `'Account does not belong to the user'` (expense account first) |
| `GET /records/expenses-and-incomes/:accountId/:month/:year` | §6 | none in practice |

Legacy error statuses come from `catch (e) { if 404/401 rethrow; else throw new BadRequestException(e.message) }`.
Unknown errors become 500 here (D6). Clients compare only `'No incomes or expenses found.'` (old-next
`dashboard.lib.ts:81`) and `'Expenses not found.'` (FE_Budget_Master only). The old-next mutations read nothing from a
success body; on error they show a fixed toast (`ExpenseTemplate.tsx:166`, `DeleteRecordModal.tsx:20`).

### What old-next sends (`src/shared/utils/records.utils.ts`, the templates)
- Expense create/edit: `{account: selectedAccount, amount, budgets: [], category, date, description, indebtedPeople,
  isPaid, linkedBudgets: [] | [budgetId], shortName, subCategory, tag, typeOfRecord:'expense'}` (+ `recordId`). On edit,
  `account` is the account currently shown, i.e. the record's own account.
- Income create/edit: the same base + `expensesPaid: ExpensePaid[]` objects (from `GET /expenses-actions` or from the
  populated listing subset), `indebtedPeople: []`, `typeOfRecord:'income'`.
- Transfer create: `{expense: {…, account: origin, typeOfRecord:'transfer', isPaid:true, linkedBudgets:[],
  indebtedPeople:[]}, income: {…, account: destination, expensesPaid: objects, typeOfRecord:'transfer'}}`.
- Transfer edit (`useEditTransfer.tsx`): `PUT /expenses-actions` then `PUT /incomes-actions`, each with its own side's
  `recordId` and account (resolved through `transferRecord`), `typeOfRecord:'transfer'`.
- Transfer delete (`DeleteRecordModal.tsx:59-76`): two DELETEs (own side + `transferRecord.transferId`) fired **in
  parallel**, both through the BFF (`/api/records/{expense,income}`, which maps any error to 400 `{message}`).
- Months are `Jan..Dec` (`ABBREVIATED_MONTHS`), the year is `String(year)`, and the current month comes from
  `dayjs().tz('America/Mexico_City')`.

## 4. Dates and formatting (legacy `utils/`)

- **Create** (expense, income, transfer): `changeTimezone(date, 'America/Mexico_City')` stores a "fake-UTC" instant:
  the Mexico City wall-clock time written as UTC, **with milliseconds dropped** (it re-parses `toLocaleString`).
  This holds only when the server runs in UTC (Lambda). On a Mexico-TZ machine legacy stores the instant unshifted
  (checked: `TZ=America/Mexico_City` → no shift). The TZ database handles pre-2022 DST: `2022-07-01T05:30Z` →
  `00:30`. The port must compute this explicitly (Intl `formatToParts` + `Date.UTC`) and not depend on the server's
  TZ. Don't port the `toLocaleString` re-parse, which depends on ICU output formats.
- **Edit**: the date is **not** shifted (`formatExpenseOnEdit`, `formatEditIncome`). old-next sends back
  `new Date(editRecord.date)`, the stored value, unless the user picks a new date. In that case the record is stored
  in real UTC and shows +6 h. Keep this; fixing it would move existing records the client can see.
- `fullDate` = `${WEEKDAY[getUTCDay]}, ${getUTCDate} ${MONTH[getUTCMonth]}, ${getUTCFullYear}` with WEEKDAY
  `Dom Lun Mar Mie Jue Vie Sab` and MONTH `Ene Feb Mar Abr May Jun Jul Ago Sept Oct Nov Dic` (no zero padding of the day).
- `formattedTime` = 2-digit **24 h** UTC hour + `:` + 2-digit minutes + `am` if hour ≤ 11 else `pm` (`'14:05pm'`,
  `'00:30am'`). Legacy reads the minutes with local `getMinutes()`: the same under UTC, so use UTC.
- `amountFormatted` = `Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:2})`
  → `$1,234.50`, `-$5.00`, `$0.13`. Recomputed from `amount` on create and edit.
- Golden vectors (legacy under `TZ=UTC`): `2025-02-03T20:05:30.123Z` → stored `2025-02-03T14:05:30.000Z`,
  `'Lun, 3 Feb, 2025'`, `'14:05pm'`; `2025-03-01T03:30:00Z` → `2025-02-28T21:30:00.000Z`, `'Vie, 28 Feb, 2025'`,
  `'21:30pm'`; `2026-10-25T06:00:00Z` → `2026-10-25T00:00:00.000Z`, `'Dom, 25 Oct, 2026'`, `'00:00am'`.
- Budget history `recordDate`: create stores the **unshifted** DTO date; edit stores `changes.date`. No client reads
  history, so keep it.

## 5. Characterization rules (unit-test spec)

`A(x)` = the balance of account x. "Legacy" is develop. "Proposed" is the fixed rule; **(obs)** marks a change the
client could observe.

### 5.1 Account balance
| Operation | Legacy | Proposed |
|---|---|---|
| Expense create | `A(acc) -= amount` | same, `$inc` |
| Expense delete | `A(acc) += amount` (the account is checked *after* the delete; on 404/401 the record is already gone) | same, in one transaction; a missing or foreign account aborts (404) and the record stays |
| Expense edit | only if `amount` changed: `A(old acc) += old − new`. An `account` change is stored but no balance moves (High finding: the next edit or delete then rewrites the other account) | `A(old acc) += old`, `A(new acc) −= new`; on the same account that is `+= old − new` and it is skipped when 0. The new account is checked like on create (404/401). **(obs)** only when `account` changes, which old-next never sends |
| Income create | `A(acc) += amount` | same |
| Income delete | `A(acc) −= amount` | same, transactional |
| Income edit | only if `amount` changed: `A(old acc) += new − old` | mirror of the expense rule. **(obs)** only on an account change |
| Transfer create | `A(expense acc) −= amount`, `A(income acc) += amount` | same, one transaction |
| Transfer edit/delete | no transfer route: each side goes through its own `/expenses-actions` or `/incomes-actions` call and adjusts only its own account (D9) | same. A repeated identical PUT finds the amount unchanged and moves nothing; a repeated DELETE → 404 `'Expense not found.'` / `'Income not found.'` and changes nothing |
| Account delete | its records are deleted, no other effect | same (§8) |

`AccountService.incrementBalance` 404s on a missing **or foreign** account. The create paths must call
`assertAccountOwned` first to keep the legacy 401 for a foreign account.

### 5.2 Linked budgets (expenses with `typeOfRecord:'expense'`)
Legacy (`expenses-actions.service.ts`):
- Create: for each linked budget (after populate, so ids that don't exist are silently skipped but stay stored):
  `currentAmount += amount` (silently skipped if foreign) and push the history entry `{recordId, recordName: shortName,
  recordDate, recordAmount: amount, budgetCurrentAmount: before, budgetUpdatedAmount: before + amount}`. A foreign
  budget fails the history push with 400 `'Budget history not found'` after the expense and balance were written.
- Edit: `removed = old − new ids`, `added = new − old` (the FE sends id strings, so the diff works). Removed:
  `currentAmount −= **new** amount` (bug 8) and pull the history entry. Added: `+= new amount` and push. Kept budgets are
  **not** adjusted when the amount changes (bug 8).
- Delete: for each stored id: `−= amount` and pull the history entry. A budget deleted earlier (legacy never unlinked
  it) makes the history pull 400, after the delete.

Proposed, using `BudgetService.incrementBudgetAmount` (returns `null` on missing/foreign) and
`BudgetHistoryService.addHistoryRecord`/`removeHistoryRecord` (400 `'Budget history not found'`), all in the session:
- Add (create, or added on edit): a missing or foreign budget → 400 `'Budget history not found'`, nothing written
  (Medium finding). Otherwise `+= amount` and push the entry.
- Remove (removed on edit, or delete): `−= **old** amount` and pull the entry. A missing or foreign budget (`null`) is
  skipped, history included. That fixes the always-400 path for stale links.
- Kept on edit with a changed amount: `+= new − old`, and replace the history entry (pull + push with the new amount).
  **(obs)** through `GET /budgets` `currentAmount`, toward the correct value (Q5).

### 5.3 `expensesPaid` paid flags (incomes, transfer income side)
Legacy: create and transfer set `isPaid:true` on every given id, with no owner check (Medium finding). Edit computes
`symmetricDifference(old ids, body)` and, if anything was removed, unpays **all old** ones, then pays the added ones
(bug 7). Delete unpays every stored id. A missing id crashes `updateMultipleExpensesPaidStatus` (`record._id` on
null, bug 6) after earlier writes.
- With old-next the body holds **objects**, so the string/object diff marks every old id removed and every new one
  added. The end state is therefore already right for old-next: kept ones end paid. Fixing bug 7 is not observable
  for this client.
- Mongoose casts `{_id: …}` objects to ObjectId (`cast/objectid`), so legacy stored ObjectIds from objects.

Proposed: normalize each element to an id (`string` or `obj._id`). Unpay `old − new`, pay `new − old`, and leave
kept ones alone. Only the caller's expenses (`userId: sub`) are flipped and stored (Q6). Missing ids count as failed
and never crash. Expense deletes don't touch incomes' `expensesPaid`; the populate drops missing ids, as in legacy.

## 6. Listings

- Month param: legacy `new Date(\`${month} 1, 2021\`).getMonth()` accepts English names in any case. Bounds are
  `new Date(year, m, 1)`..`new Date(year, m+1, 1)` in **server-local** time, compared against the fake-UTC dates.
  On Lambda (UTC) that is `[Date.UTC(y,m,1), Date.UTC(y,m+1,1))`, i.e. the Mexico City wall-clock month.
  **Proposed:** `Jan`..`Dec` (D11) and explicit `Date.UTC`. The result is identical to prod; it differs only from
  legacy run on a non-UTC dev machine, so the client can't notice.
- Invalid month or year: legacy computes an Invalid Date, BSON writes epoch 0, and the answer is a 200 empty result.
  Keep the 200 empty answer (Q3).
- Filter: `{userId: sub, account: <string>, date: {$gte, $lt}}` (+ `typeOfRecord:'expense'` for
  `/expenses-actions`). A foreign or non-ObjectId `accountId` simply matches nothing (200, empty). The legacy
  `verify*BelongsToUser` check is redundant.
- `/records/...`: expenses (incl. transfer expenses) + incomes (incl. transfer incomes) for the account, merged and
  sorted by `date` **descending** (`compareDateAndTime`; the stable sort keeps expenses before incomes on ties, and
  ties have no defined order otherwise). Responses: none → `message:'No incomes or expenses found.'`, `data:null`; only
  incomes → `'No expenses found.'`, `data.records`; only expenses → `'No incomes found.'`; both → `message:null`.
- Record shape = stored keys (aggregate/lean: `_id`, `__v`, `userId`, `account`, `transferRecord`, `indebtedPeople[]._id`…).
  Expenses: `category` → `{_id, categoryName, icon}` (null if missing), `linkedBudgets` → full budget docs (incl. `sub`;
  missing ids dropped). Incomes: `expensesPaid` → `{_id, shortName, amountFormatted, fullDate, formattedTime}`,
  `category` as above. old-next reads these fields (`records.types.ts` `BankMovement`); `GET /expenses-actions` items
  need `_id, shortName, amount, amountFormatted, fullDate, formattedTime, isPaid, date`.
- With lean populate, the D8 `toJSON` transform on budgets doesn't run. No prod budget has either field, so it doesn't matter.

## 7. Ownership and security (audit rows for S7)
| Finding | Legacy | Proposed |
|---|---|---|
| High: PUT repoints `account` to another user's account | stored as given | assert the new account is owned (404/401); every balance write is owner-bound (`incrementBalance`) |
| Medium: `expensesPaid` flips other users' expenses | any id | `userId: sub` filter on the read and the flip; foreign ids are neither stored nor flipped |
| Medium: foreign `linkedBudgets` (populated in listings) | stored, then 400 after the writes | 400 `'Budget history not found'`, no write |
| Category of another user | `validateCategoryExists` checks existence only | `CategoryService.assertCategoryOwned` → 404 (400 inside transfer) **(obs?)** see Q9 |
| Mass assignment | `$set: changes` (incl. `recordId`; `userId` is blocked by the whitelist) | `$set` only DTO record fields, never `recordId`/`userId` |

## 8. Ports, transactions, existing helpers

- Transactions: `connection.transaction(async (session) => …)`, `{ session }` on every op, no side effects inside
  (IMPLEMENTATION_GUIDELINES → Transactions). Populate and build the response after the commit.
- Helpers ready on this branch: `AccountService.assertAccountOwned({accountId, sub, session?})` (404/401),
  `incrementBalance({accountId, sub, delta, session})` (404 missing/foreign, returns the doc);
  `CategoryService.assertCategoryOwned(categoryId, sub)` (404, **no session param**, a read outside the transaction);
  `BudgetService.incrementBudgetAmount({budgetId, sub, delta, session})` → `{budgetCurrentAmount, budgetUpdatedAmount} | null`;
  `BudgetHistoryService.addHistoryRecord({budgetId, sub, record, session?})` / `removeHistoryRecord({budgetId, sub, recordId, session?})`
  (one `$push`/`$pull`, 400 `'Budget history not found'`). Entry type `BudgetHistoryRecord` (`budget-history.entity.ts`).
- `ACCOUNT_RECORDS_CASCADE` (`account.interface.ts`): `deleteAccountRecords({accountId, sub, session}) →
  {numberExpensesDeleted, numberIncomesDeleted}`, called in the account-delete transaction after the ownership check.
  Legacy (`accounts.-actions.service.ts:109-182`) matched `{userId, account: <string>}` with aggregate and deleted
  one by one. Its counts were numbers: the number of matched ids, including any `"record id … not found"` strings
  from a race. Proposed: `deleteMany({account, userId: sub}, {session})` on both collections, counts =
  `deletedCount`. Like legacy, it does not touch budgets, history, other incomes' paid flags or transfer counterparts.
- `BUDGET_EXPENSES_UNLINK` (`budget.interface.ts`): `unlinkBudget({budgetId, sub, session})`, called inside the
  budget-delete transaction. Proposed: `updateMany({userId: sub, linkedBudgets: budgetId}, {$pull: {linkedBudgets: budgetId}}, {session})`.
- **DI constraint:** `AccountModule`/`BudgetModule` provide the no-op defaults themselves, and Nest resolves a
  module's own provider first. A provider in `RecordModule` therefore can't replace them, and both modules must not
  import `RecordModule` (E5/E6 gates). Q2.
- Existing e2e specs fetch the ports with `app.get(TOKEN, { strict: false })` and spy on them
  (`test/accounts.e2e-spec.ts:455`, `test/budgets.e2e-spec.ts:110`). They must keep resolving after the swap.

## 9. Indexes (for S8's script; declared in the schemas, built only under test)
`{ userId: 1, account: 1, date: -1 }` on `createexpenses` and `createincomes`. It serves both listings and the
cascade (prefix). Prod's `createexpenses` `userId_1` is a prefix of it, so S8 can drop it; `date_1` serves no S7
query. The unlink (`userId` + `linkedBudgets`) is rare and uses the same prefix.

## 10. Tests (what to cover)
- Unit (mocked models, `transaction: vi.fn((fn) => fn(session))`): every row of §5.1–5.3 as a characterization test
  with the signed deltas passed to the helpers; validation order and texts from §3; date/format golden vectors
  from §4 (incl. ms truncation, DST-era dates, and running independent of `process.env.TZ`); month parsing and bounds;
  listing messages and sort.
- e2e (replica set): each route's happy path and errors; balances read back from `accounts`; budget `currentAmount` +
  history entries; atomicity (a failing step, e.g. a foreign budget, leaves expense, balance and budget unchanged);
  seed legacy-shaped docs directly (string `account`, ObjectId `category`, no `linkedBudgets` key) and check they
  are listed, populated and editable; `expensesPaid` as objects and as strings; a foreign `expensesPaid` id stays
  unpaid; old-next's transfer edit/delete sequences (parallel deletes), and repeating them; account-delete counts
  and budget-delete unlink through the real ports; `model.init()` before the first transaction.

## 11. Affected files and patterns
- New: `src/record/` (module, `entities/` for the expense and income schemas, `dtos/`, `services/`, `controllers/`
  for `/expenses-actions`, `/incomes-actions`, `/records`, `record.constants.ts` with the legacy texts,
  `record.utils.ts` for the date/currency/month helpers), `test/records*.e2e-spec.ts`.
- Touched: `src/account/account.module.ts` and `src/budget/budget.module.ts` (port wiring, Q2), `src/app.module.ts`
  (the CLI registers the module), `ai-skills/REPO_CONTEXT.md`.
- Patterns: `src/account/services/account.service.ts` (owner-bound writes, transaction, legacy-message reads),
  `src/budget/services/budget.service.ts` (`deleteBudget`: post-commit 404), hand-written partial DTOs
  (`account.dto.ts`), `{ ...INITIAL_RESPONSE, message, data }` responses, the e2e helpers in the existing specs.

## 12. Edge cases and constraints
- Transaction retries: `fn` may run twice. Pre-generate both transfer `_id`s so each doc is written once with its
  `transferRecord`; nothing may be logged or mailed inside.
- Parallel transfer deletes touch different docs and accounts, so they don't conflict. Two concurrent edits of the same
  record would write-conflict: Mongo aborts one of them, and it is retried or 500s.
- `transferRecord` stays client-writable on create and PUT (legacy). A forged `transferId` only makes the FE's second
  DELETE 404 or 401.
- Duplicate ids in `linkedBudgets` double-count in legacy; an expense has ≤ 3 and the FE sends at most 1.
- Floating point: `$inc` is the same IEEE addition as legacy's read-modify-write.
- Prod-run caution (D16): manual checks create records against prod balances. Delete them through the routes,
  which reverses the balances.

## 13. Open questions (recommendation first)
1. **Q1 Module/split.** One `record` module (collections `createexpenses`/`createincomes`), delivered as
   S7a → S7b → S7c on branches `feat/records-expenses`, `feat/records-incomes`, `feat/records-transfers`, each
   stacked on the previous one. *Recommend yes.* Research S7a first.
2. **Q2 Port wiring.** *Recommend:* `RecordModule` provides `ACCOUNT_RECORDS_CASCADE` and `BUDGET_EXPENSES_UNLINK`
   from a `@Global()` module (or as global exports), and the `useValue` defaults are removed from
   `AccountModule`/`BudgetModule`. Their unit specs already stub the tokens. The alternative is to register the record
   models in those modules and bind an implementation class there: no cycle, but it duplicates `forFeature` and
   couples them to record entities.
3. **Q3 Bad month/year.** *Recommend:* keep legacy's 200 empty answer (`'No incomes or expenses found.'`,
   `'Expenses not found.'`). Accept only `Jan`..`Dec` (exact case) and `/^\d{4}$/`. No client sends anything else.
4. **Q4 `category` type.** *Recommend:* Mixed + `ref`, exactly the legacy runtime, so both stored types populate.
   The e2e must prove a seeded ObjectId category and a string category both populate. (`String` + `ref` should work too
   but would cast stored ObjectIds on hydrate.)
5. **Q5 Bug 8 fix (budget math on edit).** *Recommend:* remove with the old amount, add the new amount to kept
   budgets and replace their history entry. Observable only as corrected `currentAmount` in `GET /budgets`.
6. **Q6 Foreign or missing `expensesPaid` ids.** *Recommend:* don't store them and don't flip them, and count them
   in the "failed" step message (no error). The alternative, 400 on any foreign id, would also reject the dangling
   ids old incomes may echo back on edit.
7. **Q7 Indebted people `_id` on edit.** *Recommend:* accept an optional `_id` (IsOptional + IsMongoId) on
   `IndebtedPeople`. It fixes an always-400 edit (ground rule 3); stored subdocs keep their `_id`.
8. **Q8 Income PUT without `expensesPaid`.** *Recommend:* treat it as "unchanged" (no flag changes, list kept)
   instead of legacy's 400 after the writes.
9. **Q9 Category ownership on existing data.** Before enabling the owner check on PUT, run a read-only prod count of
   records whose `category` belongs to another `sub` (and of `linkedBudgets` pointing to another user's budget). If
   any belong to live users, editing those records would start returning 404. *Recommend:* run the count; if it is 0,
   enforce ownership.
10. **Q10 Missing/foreign account on record delete.** *Recommend:* abort with 404 (the record stays). Today the record
    is deleted and the call 404s. Only the 3 orphan records can hit this, and they can't be reached from the client.

## 14. Assumptions
- develop is the contract. old-next is the client to keep working; new-next and FE_Budget_Master are not.
- The deployed Lambda runs in UTC, so explicit-UTC bounds and Intl-based shifting reproduce prod exactly.
- `message` arrays may change text and length (D10); the types (`string[]` on mutations, string/null on listings) stay.
- Array elements may be validated where legacy didn't (`linkedBudgets` → `IsMongoId({each:true})`, `expensesPaid`
  → id or `{_id}`). A bad element was already a 400 (CastError) in legacy; only the text changes, and no client compares it.
- Record mutations stay one-sided for transfers (D9). No transfer update/delete route is added.
- The account-delete cascade keeps legacy's narrow scope. Budgets, history, paid flags and transfer counterparts of
  the deleted records are left as they are.
