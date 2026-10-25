# Plan: S4 — categories (`categories` collection, 5 routes, ownership, seeding in a transaction)

**Status:** APPROVED (2026-10-25) — owner approved as written, incl. `subCategories: [String]` (prod checked: string elements only).

**Branch:** `feat/categories` (stacked on `feat/mail`, PR #5) · **Date:** 2026-10-25 · **Research:**
[`ai-research/categories.research.md`](../ai-research/categories.research.md)
· Memory: [`memories/repo/categories-research.md`](../memories/repo/categories-research.md),
[`memories/repo/categories-planning.md`](../memories/repo/categories-planning.md)

Owner decisions applied (`~/projects/notes/budget-master/be-refactor.md`):
- **E4.C1–C3** (as the research recommended): C1 unknown or non-ObjectId `sub` on create-local → 400
  `'Local categories already exists'`, no write; C2 module **`category`**; C3 the 12-doc seed runs in a transaction,
  simultaneous-seed race accepted. `sub` is a `String`, stored and queried as is.
- D2 (`categories.sub` is a string; records' mixed `category` is S7's problem, the ownership assertion only checks
  incoming string ids), D4 (create-local stays public; seed only an existing user with no categories), D6 (unexpected
  errors → 500, keep the legacy texts exact), D14 (Bearer or cookie, nothing changes in `src/auth`), D16 (tests never
  touch prod; manual runs are on prod and delete everything they create).
- Security findings: High "PUT/DELETE `/categories` has no owner filter" → Phase 2; Low "create-local trusts the body
  `sub`" → Phase 3 (user must exist and have no categories; stored `sub` is the found `_id.toString()`).

The contract table, the 12 defaults and the edge-case list are in the research; this plan does not repeat them.
AC numbers are the research's AC1–AC5.

## Scope guard

**In:** the `category` module (entity, constants, DTOs, service + spec, controller), the 5 routes, `assertCategoryOwned`,
the transaction pattern (documented for S6/S7), `test/categories.e2e-spec.ts`, docs (`REPO_CONTEXT.md`,
`IMPLEMENTATION_GUIDELINES.md`).

**Out (don't add):** the dead legacy methods (research list), name uniqueness, records cleanup on delete, the user-delete
cascade (S8), the prod index script (S8), `@nestjs/mapped-types`, a custom `withTransaction` wrapper, a shared e2e auth
helper file, response DTO classes for raw docs, a fix for the double-seed race.

## Transaction pattern (first in the repo)

No custom helper: mongoose's own **`connection.transaction(fn)`** is the reusable piece (mongoose 9:
`transaction<T>(fn: (session) => Promise<T>, options?): Promise<T>`). It starts a session, runs `fn` through the
driver's `withTransaction` (retries on `TransientTransactionError` / unknown commit result), commits, aborts and
rethrows on any throw, and resets document state on abort. Services get it with `@InjectConnection() connection: Connection`
(`MongooseCoreModule` is global, no module import). Rules (Phase 3 writes them into `IMPLEMENTATION_GUIDELINES.md` →
Database → Transactions, for S6/S7):
- Every read/write inside `fn` gets `{ session }` (or `.session(session)`); an op without it runs outside the transaction.
- `fn` may run more than once: no side effects (mail, logs that claim success) inside it.
- Throwing an `HttpException` inside `fn` aborts and the global filters answer as usual.
- Needs a replica set: e2e (in-memory `MongoMemoryReplSet` locally, docker `--replSet rs0` in CI) and Atlas have one.
- Unit tests mock `connection.transaction` as `vi.fn((fn) => fn(fakeSession))`; atomicity is proven in e2e.

Shortcut accepted: no `withTransaction` wrapper of our own. Upgrade only if S6/S7 need shared behaviour mongoose lacks
(e.g. AsyncLocalStorage sessions via `mongoose.set('transactionAsyncLocalStorage', true)`).

## CLI note

Generate the module first, then the service and controller with `--flat` (S2 memory). Check generated relative imports
end in `.js`. The controller schematic writes `@Controller('category')`: change it to `@Controller('categories')`.

---

## Phase 1 — Module, `categories` schema, `GET` + `POST /categories`

**Changes**

1. `pnpm nest g mo category` — creates `src/category/category.module.ts`, adds `CategoryModule` to `AppModule` imports
   (**verify**).
2. `src/category/entities/category.entity.ts` — create (hand-authored), like `user.entity.ts`:
   - `@Schema({ collection: 'categories' })` class `Category` (no timestamps, default `versionKey`).
   - `categoryName` `{ required: true }` string; `subCategories` `{ type: [String], required: true }`; `icon`
     `{ required: true }` string; `sub` `{ type: String, required: true }` (comment: legacy's `Types.ObjectId` prop
     became `Mixed` and stored the JWT string; all prod docs are strings).
   - `CategorySchema.index({ sub: 1 })` (comment: builds under test only, prod gets it from S8's script).
   - `export type CategoryDoc = HydratedDocument<Category>`. Model name `Category.name` (S7 `ref` uses it).
3. `src/category/category.constants.ts` — create: `CATEGORY_CREATED_MESSAGE`, `CATEGORY_DELETED_MESSAGE`,
   `CATEGORY_NOT_FOUND_ERROR`, `LOCAL_CATEGORIES_EXISTS_ERROR` and `ALL_LOCAL_CATEGORIES` (the 12, in order) **copied
   verbatim from legacy `src/categories/constants.ts` on `origin/develop`** (`git -C ../be-budgt-master show
   origin/develop:src/categories/constants.ts`), typos and trailing space included. Mark it `as const` / `readonly`.
4. `src/category/dtos/category.dto.ts` — create `CreateCategoryDto` exactly as legacy `CreateCategoriesDto` (same
   decorators, same order: `categoryName` IsString IsNotEmpty; `subCategories` IsArray IsNotEmpty; `icon` IsString
   IsNotEmpty). No initializers.
5. `src/category/category.module.ts` — populate: `MongooseModule.forFeature([{ name: Category.name, schema: CategorySchema }])`;
   `exports: [CategoryService]` (S7).
6. `pnpm nest g s category/services/category --flat` — `CategoryService` (model via `@InjectModel(Category.name)`):
   - `findByUser(sub: string)` — `find({ sub }, { sub: 0 }).exec()` → 200 `{ ...INITIAL_RESPONSE, data: { categories } }`
     (`message: null`; `[]` when none).
   - `createCategory(sub: string, dto: CreateCategoryDto)` — `create({ ...dto, sub })` → `{ ...INITIAL_RESPONSE,
     message: CATEGORY_CREATED_MESSAGE, data: { category } }` (doc incl. `sub`, `__v`).
   - No try/catch: mongoose ValidationError/CastError (e.g. `subCategories: [{}]`) → 400 via the catch-all; unknown → 500 (D6).
7. `pnpm nest g co category/controllers/category --flat --no-spec` — `@Controller('categories')`, thin:
   `@Get() getCategories(@Req() req: AuthenticatedRequest)`, `@Post() createCategory(@Body() dto, @Req() req)`, both
   pass `req.user.sub`. Not public.
8. `test/categories.e2e-spec.ts` — create. `createTestApp()` / `closeTestApp()`; a local `signupAndLogin()` helper
   copied from the `signup`/`login` pattern in `test/auth-users.e2e-spec.ts` (token from `set-cookie[0]`, sent as Bearer).

**Edge cases**
- Responses are hydrated docs; Nest serializes them through `toJSON` (`_id`, `__v`), matching legacy. No response DTO
  classes: they would have to mirror mongoose output and could drift (typed as `CategoryDoc`).
- `subCategories: []` passes (`IsNotEmpty` and mongoose array `required` accept `[]`).

**Test coverage**
- `category.service.spec.ts` (model mocked via `getModelToken(Category.name)`): `findByUser` queries `{ sub }` with
  projection `{ sub: 0 }` and wraps the result; `createCategory` stores the given `sub` (string), message and shape.
- e2e: GET without token → 401; GET for a fresh user → 200 `data.categories: []`, `message: null`; POST → 201 exact
  envelope, `data.category` has `_id, categoryName, subCategories, icon, sub, __v` and `sub` equals the JWT `sub`
  string; GET then lists it **without** `sub`; missing `icon` → 400 legacy validation message; unknown body key
  (`sub`) → 400; user B's GET doesn't see user A's category.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none (no delete path yet; the full manual run is in Phase 3).

---

## Phase 2 — `PUT` / `DELETE /categories` with the owner filter, `assertCategoryOwned`

**Changes**

1. `src/category/dtos/category.dto.ts` — add:
   - `UpdateCategoryDto` by hand (no `PartialType`): the three create fields each `@IsOptional()` + their create
     decorators; `categoryId` `@IsMongoId() @IsNotEmpty()` (legacy order).
   - `DeleteCategoryDto`: `categoryId` `@IsMongoId() @IsNotEmpty()`.
2. `CategoryService.updateCategory(sub: string, dto: UpdateCategoryDto)`:
   - `$set` = only `categoryName` / `subCategories` / `icon` that are present and not `null` (`IsOptional` lets `null`
     through; never `categoryId` or `sub`).
   - `findOneAndUpdate({ _id: dto.categoryId, sub }, { $set }, { returnDocument: 'after' }).exec()`; null →
     `BadRequestException(CATEGORY_NOT_FOUND_ERROR)` (foreign = missing, H3).
   - 200 `{ ...INITIAL_RESPONSE, data: { category } }` (`message: null`).
3. `CategoryService.deleteCategory(sub: string, { categoryId }: DeleteCategoryDto)`:
   `findOneAndDelete({ _id: categoryId, sub })`; null → 400 `CATEGORY_NOT_FOUND_ERROR`; 200 `message:
   CATEGORY_DELETED_MESSAGE`, `data: { category }`. Records pointing at it are left (legacy; comment).
4. `CategoryService.assertCategoryOwned(categoryId: string, sub: string): Promise<void>` (AC4, for S7):
   `!isValidObjectId(categoryId)` → `NotFoundException(CATEGORY_NOT_FOUND_ERROR)`; else `exists({ _id: categoryId, sub })`;
   null → same 404. 404 is legacy `validateCategoryExists`'s form; S7 maps its transfer case to 400 (comment).
   Unused by any S4 route.
5. `CategoryController` — `@Put() updateCategory(@Body() dto, @Req() req)`, `@Delete() deleteCategory(@Body() dto, @Req() req)`;
   both pass `req.user.sub` (legacy didn't; that is the H3 fix). DELETE reads the **body** (legacy contract).

**Edge cases**
- PUT with only `categoryId` → empty `$set` → 200 with the unchanged doc (legacy). Assert it in e2e (mongoose may skip
  the update and just find; either way the owned doc comes back).
- A `null` field is skipped, not written (beyond research, same rule as `updateUser`).
- Non-ObjectId `categoryId` never reaches the query (`IsMongoId` → 400 validation).

**Test coverage**
- `category.service.spec.ts`: update filters by `{ _id, sub }`, `$set` excludes `categoryId`/`sub`/`null`/absent
  fields, uses `returnDocument: 'after'`, null → 400 `'Category not found'`; delete filters by `{ _id, sub }`, null →
  400, success message/shape; `assertCategoryOwned` — bad id → 404 without a query, not owned → 404, owned → resolves.
- e2e (AC2): user A creates a category; user B's PUT and DELETE on its id → 400 exact `'Category not found'` body,
  identical to a random unused ObjectId's; user A's GET shows the doc unchanged after both. A's own PUT → 200 with the
  new name (incl. `sub`); PUT with only `categoryId` → 200 unchanged; PUT with `sub` or bad `categoryId` → 400; A's
  DELETE → 200 `'Category deleted'` with the doc; second DELETE → 400 `'Category not found'`; DELETE without token → 401.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e`.
- Manual: none here (Phase 3 runs all 5 routes once, with clean-up).

---

## Phase 3 — Public `create-local-categories` in a transaction, docs, manual run on prod

**Changes**

1. `src/category/dtos/category.dto.ts` — add `CreateLocalCategoriesDto`: `sub` `@IsString() @IsNotEmpty()` (no
   `IsMongoId`, keeps legacy messages).
2. `src/category/category.module.ts` — `imports: [..., UserModule]` (exports `UserService`). Note in a comment: S8's
   cascade must not make `UserModule` import `CategoryModule` (cycle).
3. `CategoryService` — inject `UserService` and `@InjectConnection() connection: Connection`. Add
   `createLocalCategories(bodySub: string)`:
   - `user = await userService.findById(bodySub)` (null for non-ObjectId or unknown) → null →
     `BadRequestException(LOCAL_CATEGORIES_EXISTS_ERROR)` (C1, no write).
   - `sub = user._id.toString()` (never the raw body value).
   - `categories = await connection.transaction(async (session) => { if (await model.exists({ sub }).session(session))
     throw BadRequest(LOCAL_CATEGORIES_EXISTS_ERROR); return model.insertMany(ALL_LOCAL_CATEGORIES.map(c => ({ ...c, sub })), { session }); })`.
     The check is inside so a retried `fn` re-checks. Comment: two concurrent first seeds can both commit (accepted, C3).
   - 201 `{ ...INITIAL_RESPONSE, message: CATEGORY_CREATED_MESSAGE, data: { categories } }` (12 docs in default order,
     incl. `sub`, `__v`).
4. `CategoryController` — `@Public() @Post('create-local-categories') createLocalCategories(@Body() dto)` → `dto.sub`.
5. `ai-skills/IMPLEMENTATION_GUIDELINES.md` → Database: add a **Transactions** subsection with the rules in
   "Transaction pattern" above (short, with the create-local service as the example path).
6. `ai-skills/REPO_CONTEXT.md` — structure tree (`category/`, `test/categories.e2e-spec.ts`), Overview (S4), the 5
   routes in the route table, Database: "multi-doc writes use `connection.transaction`", and remove "categories" from
   the "does not exist yet" line wording if present.

**Edge cases**
- Upper-case hex `sub` finds the user (`findById` casts) but is stored as the canonical lower-case `_id` string.
- Missing / empty / non-string `sub` → legacy validation 400; extra keys → 400.
- A user with any category (even one created via POST, without defaults) can't seed (D4; research's only behaviour change).

**Test coverage**
- `category.service.spec.ts` (`UserService` mocked; `connection` mocked `{ transaction: vi.fn((fn) => fn(session)) }`):
  unknown/invalid sub → 400 `'Local categories already exists'`, `transaction` and `insertMany` not called; existing
  categories → same 400, no `insertMany`; success → `exists` and `insertMany` both get the session, 12 docs whose `sub`
  is `user._id.toString()` (fixture where body sub differs in case), names in `ALL_LOCAL_CATEGORIES` order, message
  `'New category created'`.
- e2e (`test/categories.e2e-spec.ts`; `beforeAll` awaits `app.get(getModelToken(Category.name)).init()` so collection
  and index creation don't race the first transaction):
  - Without a token: seed for a fresh user → 201, 12 docs, `sub` = the user's id, first is `'Comida y Bebida'`, last
    `'Ingreso'`, the `'Automóvil / Propiedad inmobiliaria '` subcategory keeps its trailing space; that user's GET →
    12 docs without `sub`.
  - Same call again → 400 `'Local categories already exists'`, still 12. A user with one POSTed category → 400, still 1.
  - Unknown ObjectId, `'abc'` → 400 same text; `countDocuments({ sub: <that value> })` = 0. `{}` / `sub: ''` / `sub: 1` → 400
    validation.
  - **Rollback (proves the transaction and that the session is passed):** `vi.spyOn(categoryModel, 'insertMany')
    .mockImplementationOnce(async (docs, opts) => { await original(docs.slice(0, 6), opts); throw new Error('boom'); })`
    → 500 enveloped; `countDocuments({ sub })` = 0; the next seed → 201 with 12. Silence the catch-all's `Logger`
    error for this test.
  - Phase 1/2 cases stay green.

**Success criteria**
- Automatic: `pnpm run build`, `pnpm test`, `pnpm run test:e2e` (CI repeats e2e on the docker replica set).
- Manual (orchestrator, `pnpm run start:dev` on the owner's `.env` = **prod DB**). **Creates one `users` doc and its
  categories (12 seeded + 1 posted) and deletes all of them in this phase.** `TS=$(date +%s)`,
  `EMAIL=e2e-manual-$TS@example.invalid`, a throwaway password. Base `localhost:3000`, JSON bodies.
  1. `POST /users` `{email, password, firstName:'Manual', lastName:'Check', middleName:''}` → 201; keep `SUB=data.userCreated.sub`.
  2. `POST /auth/` → 201; `TOKEN` = value of `set-cookie[0]` (between the first `=` and `;`). Send `Authorization: Bearer $TOKEN` below.
  3. `GET /categories` → 200 `data.categories: []`.
  4. `POST /categories/create-local-categories` **without a token**, `{sub: SUB}` → 201 `'New category created'`, 12 docs, all `sub == SUB`.
  5. Same again → 400 `'Local categories already exists'`. Then `{sub:'000000000000000000000000'}` and `{sub:'abc'}`
     → 400 same text (no user → no write).
  6. `GET /categories` → 12 docs, no `sub` key, `__v` present.
  7. `POST /categories` `{categoryName:'Manual', subCategories:['a'], icon:'newCategory'}` → 201; keep its `_id` as `CID`.
  8. `PUT /categories` `{categoryId: CID, categoryName:'Manual2', subCategories:['a','b']}` (no `icon`, FE shape) → 200 new values.
  9. `PUT /categories` and `DELETE /categories` with `{categoryId:'000000000000000000000000'}` → 400 `'Category not found'`
     (the foreign-id case is proven in e2e; don't touch real users' docs on prod).
  10. **Clean-up:** `GET /categories | jq -r '.data.categories[]._id'` and `DELETE /categories` `{categoryId}` for each
      (13 deletes, each 200 `'Category deleted'`). Then `GET /categories` → `data.categories: []` (**the 0-leftover
      check for `SUB`**, made while the token still works). Only then `DELETE /users` → 200, and `PUT /users` with
      the same token → 401.
  - On any failure after step 1, jump to step 10 with the current token. If the user was deleted first by mistake,
    or the orchestrator wants a second check, run a read-only `countDocuments({ sub: SUB })` on `categories` against
    the prod URI and delete leftovers by `sub` with the owner's OK. Report `SUB` and the final count.

---

## AC Coverage Summary

| AC | Phase(s) | Automatic / manual | Coverage |
|---|---|---|---|
| AC1 — 5 routes match the legacy contract | 1, 2, 3 | both (e2e per route; manual steps 3–10) | full |
| AC2 — no cross-user update/delete, same 400, doc unchanged | 2 | automatic (e2e two users + unit filter) | full (manual only checks the "missing id" side, by design on prod) |
| AC3 — create-local public, seeds only an existing user with no categories, stored `sub` = user id string | 3 | both | full (double-seed race accepted, C3; not tested) |
| AC4 — ownership assertion for S7 | 2 | automatic (unit) | full |
| AC5 — unit + e2e on the replica set, incl. cross-user and seeding | 1, 2, 3 | automatic | full |

## Decisions (beyond the research)

- No custom transaction helper: `connection.transaction()` is the shared pattern, documented in the guidelines.
- The "already has categories" check runs inside the transaction (re-checked on retry); the user lookup runs before it.
- e2e rollback test via a one-shot `insertMany` spy that writes 6 docs then throws; `beforeAll` awaits `model.init()`.
- `subCategories` declared `[String]` (legacy's bare `string[]` was a Mixed array): non-string elements are now cast
  (`1` → `'1'`) or rejected 400 instead of stored raw. FE only sends strings.
- PUT/DELETE skip `null` fields; `assertCategoryOwned` throws 404 and returns nothing.
- No response DTO classes (data is raw docs); controller `--no-spec`; the signup/login e2e helper stays local to the spec.
- Manual run never touches another user's data; the cross-user case is e2e-only.

## Assumptions

- Research assumptions accepted (develop = contract, GET drops only `sub`, guard implies the owner exists).
- `feat/mail` (PR #5) doesn't touch anything this plan edits besides `REPO_CONTEXT.md` (possible doc conflict only).
- The owner's `.env` has working `JWT_KEY` and a prod `MONGO_*`; Atlas supports transactions (replica set).
- mongoose 9's `connection.transaction` behaves as documented (retry + abort/rethrow); the e2e rollback test confirms it.

## Implementation checklist

- [x] Phase 1 — module (CLI, `AppModule` import verified), entity, constants (verbatim from legacy develop), create DTO, service `findByUser`/`createCategory` + spec, controller (path fixed `category` → `categories`), e2e GET/POST
- [x] Phase 2 — update/delete DTOs, owner-filtered `updateCategory`/`deleteCategory`, `assertCategoryOwned` + spec, PUT/DELETE routes, e2e cross-user + owner cases
- [x] Phase 3 — `CreateLocalCategoriesDto`, `UserModule` import, `createLocalCategories` via `connection.transaction` + spec, public route, e2e incl. rollback
- [x] Phase 3 — `IMPLEMENTATION_GUIDELINES.md` → Database → Transactions; `REPO_CONTEXT.md` (overview, tree, Database, routes)
- [x] Automatic: `pnpm run lint`, `pnpm run build`, `pnpm test`, `pnpm run test:e2e` (in-memory replica set); built app smoke run (`node dist/main.js`, local in-memory replica set): signup → create-local → `GET /categories` = 12
- [ ] Phase 3 manual run on the prod DB — left to the orchestrator (steps 1–10 above)
