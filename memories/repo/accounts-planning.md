# accounts planning notes (2026-10-25, draft)

- `ACCOUNT_RECORDS_CASCADE` (Symbol in `account.constants.ts`, interface in `account.interface.ts`) defaults to a 0/0 `useValue` in `AccountModule`. S7 swaps that provider without `AccountModule` importing `RecordModule` (RecordModule imports AccountModule for `incrementBalance`/`assertAccountOwned`).
- PUT reads `select('sub')` only to choose the legacy message (missing 400 / foreign 400), then writes with `{_id, sub}`. DELETE does the same inside `connection.transaction` (foreign 401) and hands the session to the cascade port.
- `incrementBalance` needs a session and 404s on missing or foreign, so the caller's transaction aborts.
- `terminationFourDigits` is `String` in the schema: the one prod int hydrates to a string, and its PUT echo 400s with the digits text, as on develop. S8 repairs the doc.
- Manual prod runs: delete accounts via `DELETE /account-actions` before `DELETE /users` (no cascade until S8).
