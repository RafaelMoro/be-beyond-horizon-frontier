# hardening-scripts (S8b) planning notes (2026-10-25, approved)

- Scripts live in `src/scripts/` (built to `dist/scripts/`), boot `AppModule` via `createApplicationContext`; logic
  files are separate from the `*.cli.ts` entries (top-level `await`) so specs can import them.
- Index script: `diffIndexes()` + `createIndexes()` only. `diffIndexes().toDrop` is printed, never acted on.
- E2E can't get a prod-like index state from config (`autoIndex` is on under `NODE_ENV=test`): `model.init()`, then
  `dropIndexes()` on the raw collections and recreate `users.email_1` + the undeclared `date_1` / `userId_1`.
- Data repair: detect and fix in the same transaction per case (exact `_id`s from that snapshot); R8 runs last and
  keeps orphan accounts/categories still referenced by a record (else R8 creates R4/R5 cases for the next run).
- Never print `terminationFourDigits` (partial card digits), names, emails or amounts (Q11).
- Document `node dist/scripts/…` for the owner, not `pnpm run x -- --apply`: the strict `parseArgs` rejects a stray `--`.
