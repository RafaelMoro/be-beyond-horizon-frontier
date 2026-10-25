# records-expenses planning notes (2026-10-25, draft)

- `BUDGET_EXPENSES_UNLINK` is provided by the `@Global()` `RecordModule` via `useExisting: RecordPortsService`. That provider may depend only on record models: `BudgetService` injects the port and `RecordModule` imports `BudgetModule`, so a port backed by `ExpenseService` (which injects `BudgetService`) is a provider cycle. S7b adds `ACCOUNT_RECORDS_CASCADE` to the same service.
- E7.Q9: PUT checks category/account/added-budget ownership only when the field changes; unchanged ones aren't checked at all (not even existence). Removed or kept budgets that are missing/foreign are skipped (`incrementBudgetAmount` → null).
- Balance writes stay owner-bound: a record whose stored account is foreign can't change amount/account (404), same as Q10 on delete.
- Create stores the Mexico-wall-clock date but the budget history `recordDate` gets the unshifted DTO date; edit never shifts.
- Manual prod run deletes the expense before the budget, so AC4 (unlink) is e2e-only.
