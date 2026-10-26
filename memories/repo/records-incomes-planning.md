# records-incomes planning notes (2026-10-25, approved and implemented)

- `ACCOUNT_RECORDS_CASCADE` joins `BUDGET_EXPENSES_UNLINK` on `RecordPortsService` (`useExisting`, global `RecordModule`). It may inject only record models: `AccountService` injects the port and `RecordModule` imports `AccountModule`.
- `expensesPaid` elements are normalized by `toExpenseIds` (24-hex string or `{_id: 24-hex}`); anything else → 400 before writes, and no object ever reaches a query (operator injection).
- Paid flags: one owner-filtered `updateMany` per direction. Edit flips only `old − owned` (false) and `owned − old` (true); kept ids are never touched (bug 7). Stored list = the caller's existing expenses only (Q6); stored foreign/dangling ids drop out on the next edit that sends `expensesPaid`.
- Income PUT uses develop's odd texts: 404 `'Expense not found.'`, 401 `"You're unauthorized to see these incomes."`; DELETE uses `'Income not found.'` / `'This income does not belongs to the user'`.
- Account cascade deletes by `{userId: sub, account}` on both collections with `deleteMany` (sequential, same session); counts are `deletedCount`. No paid-flag or transfer-counterpart effects (legacy scope).
