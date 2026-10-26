# records-transfers-listing planning notes (2026-10-25, approved + implemented)

- `POST /records/transfer` lives in `RecordService`, which reuses `IncomeService.ownedExpenseIds` / `payExpenses` (made public) for the income side's paid flags.
- Both transfer `_id`s are generated before `connection.transaction`, so each doc is inserted once with its `transferRecord` and a retry keeps the cross-links right.
- develop answers every transfer error with 400: only our own `NotFoundException`/`UnauthorizedException` (category, accounts) are rethrown as 400 with the same text; unknown errors stay 500 (D6, owner OK).
- The `/records` listing has no `typeOfRecord` filter (transfers included), lean reads keep key presence (`isPaid` = expense, `expensesPaid` = income), and the merged sort is stable (expenses first on equal dates).
- D9 needs no new code: S7a/S7b PUT/DELETE already move only their own side; Phase 3 is e2e + manual proof only; the D9 e2e passed with no new code.
