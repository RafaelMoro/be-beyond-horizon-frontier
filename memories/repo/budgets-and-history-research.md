# budgets-and-history research notes (2026-10-25)

- Legacy `budgethistorymodels.budget` is Mixed (SchemaFactory + `Types.ObjectId`); prod stores ObjectId ×5 because budget create passed `_id`. Legacy HTTP add-record/delete-record queried it with a string `budgetId`, so they likely never matched: declaring `ObjectId` makes them work.
- Legacy `updateBudgetAmount` silently skips a missing/foreign budget (no throw); the history add/remove helpers 400 `'Budget history not found'` (404 wrapped).
- Legacy budget delete deletes the budget, then 404s if its history is gone. In one transaction a thrown 404 would roll the delete back and make that budget undeletable.
- old-next's `GET /budgets` destructures `data.budgets`: with `data: null` (no budgets) it throws, catches and toasts a fetch error. That's develop behaviour, kept.
- Legacy ValidationPipe had no `transform`; `@Type(() => Date)` only affected validation. Ours transforms, same stored values.
