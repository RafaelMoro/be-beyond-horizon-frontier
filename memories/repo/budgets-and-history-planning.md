# budgets-and-history planning notes (2026-10-25, draft)

- History `budget` must be `mongoose.Schema.Types.ObjectId` in `@Prop`; `Types.ObjectId` (mongoose's class) makes it Mixed, which is legacy's bug.
- Q6: budget delete returns the (possibly null) history from `connection.transaction`'s `fn` and throws 404 `'Budget history not found'` after the commit. Throwing inside `fn` would roll the budget delete back.
- `BUDGET_EXPENSES_UNLINK` port (no-op default in `BudgetModule`) runs inside the delete transaction; S7 provides it, like `ACCOUNT_RECORDS_CASCADE`.
- D8 fallback (`nestResetDate` → `nextResetDate`) is a `toJSON` transform on `BudgetSchema`; `previousPeriods` has `default: undefined`.
- Prod has no unique `{budget, sub}` index until S8: never send a duplicate history POST in a prod manual run.
- Manual prod runs: delete budgets via `DELETE /budgets` (it removes the history) before `DELETE /users`; check both collections by `sub`.
