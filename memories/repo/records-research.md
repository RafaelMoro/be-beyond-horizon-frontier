# records research notes (2026-10-25)

- Legacy `changeTimezone` depends on the server TZ: it shifts to Mexico-City-wall-as-UTC (ms dropped) only on a UTC host; on a Mexico-TZ host it stores the instant unshifted. Port it with Intl + `Date.UTC`, never the `toLocaleString` re-parse.
- Legacy `IndebtedPeople` DTO has no `_id`, so with `forbidNonWhitelisted` old-next's expense edit (echoes stored subdocs with `_id`) always 400s.
- old-next sends `expensesPaid` as objects: legacy's string/object symmetricDifference "removes" all old and "adds" all new, so bug 7 (kept expenses unpaid) never shows for this client.
- Invalid month/year in legacy → Invalid Date → BSON epoch 0 → 200 empty listing, not an error.
- Nest resolves a module's own provider first: S7 can't override the `useValue` port defaults in `AccountModule`/`BudgetModule` from `RecordModule`; the defaults must move (e.g. a global provider).
- `incrementBalance` 404s on a foreign account; call `assertAccountOwned` first wherever legacy answered 401.
