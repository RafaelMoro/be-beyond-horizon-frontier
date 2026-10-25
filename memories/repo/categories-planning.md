# categories planning notes (2026-10-25, draft)

- First transaction in the repo: no custom helper. Inject `@InjectConnection() connection: Connection` and use `connection.transaction(async (session) => …)`; pass `{ session }` to every op inside; `fn` can re-run (no side effects inside). S6/S7 reuse it.
- Unit tests mock `connection.transaction` as `vi.fn((fn) => fn(session))`. Atomicity is proven in e2e by a one-shot `insertMany` spy that writes part of the batch with the real session, then throws → 0 docs left.
- e2e awaits `model.init()` before the first transaction so collection/index creation doesn't race it.
- `CategoryModule` imports `UserModule` (create-local user check). S8's cascade must not make `UserModule` import `CategoryModule`.
- Manual runs on prod: delete the throwaway user's categories via `DELETE /categories` per id, check `GET` → `[]`, then `DELETE /users` (no cascade until S8).
