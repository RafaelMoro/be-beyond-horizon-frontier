# Research: S4 — categories (`categories` collection, 5 routes, ownership, seeding)

**Branch:** `feat/categories` (stacked on `feat/mail`, PR #5) · **Date:** 2026-10-25 · **Type:** single story, full research

Sources: `~/projects/notes/budget-master/be-refactor.md` (S4, ground rules, D0/D2/D4/D6/D14, Security findings H3/L2),
`be-refactor-survey.md` §2.2 Categories, §4 Categories, §5 #3/#4/#16/#17, `be-refactor-db-checks.md` §4–§5,
`be-refactor-next-clients.md`, `be-refactor-frontend-usage.md` (D4, rows 3/10–13), `be-refactor-security-audit.md` H3/L2.
Legacy contract = `be-budgt-master` **`origin/develop`** `src/categories/**` (identical to main per the develop survey).
Live client = `old-next-budget-master@main` (clone read only).

## Story

Port the per-user categories: the `categories` schema, the 12 default categories byte-for-byte, and the 5 routes.
Improve what clients can't see: owner filter on PUT/DELETE (audit H3), seeding only for an existing user with no
categories (D4, audit L2), `insertMany`, a `{sub: 1}` index, and a shared ownership check S7 records will use.

## Acceptance criteria

1. The 5 routes return the legacy status, envelope, `message` and `data` keys in the contract table below, including
   400 `'Local categories already exists'`, 400 `'Category not found'`, `GET` without `sub`, every POST → 201.
2. A user can't update or delete another user's category: the response is the same 400 `'Category not found'` as
   for a missing id, and the document is unchanged.
3. `POST /categories/create-local-categories` stays public; it inserts the 12 defaults (stored `sub` = the user's id
   string) only when that `sub` is an existing user with no categories; otherwise 400 with no write.
4. The category service exposes an ownership assertion (`assertCategoryOwned` or equivalent) for S7.
5. Unit tests (mocked model) for every service rule; e2e against the in-memory/CI replica set for all 5 routes,
   including the cross-user PUT/DELETE and the seeding cases.

## Legacy contract (develop)

`@Controller('categories')`, all routes behind the JWT guard except create-local. All legacy errors are wrapped in
`BadRequestException(error.message)` → 400. Responses are mongoose docs (default `toJSON`: `_id`, `__v`).

| Method | Path | Body (DTO) | Success | Errors |
|---|---|---|---|---|
| GET | `/categories` | – | 200 `message:null`, `data:{categories:[{_id,categoryName,subCategories,icon,__v}]}` (projection `{sub:0}`); `[]` when none | 401 guard |
| POST | `/categories` | `CreateCategoriesDto`: `categoryName` IsString+IsNotEmpty, `subCategories` IsArray+IsNotEmpty (elements unchecked), `icon` IsString+IsNotEmpty | 201 `'New category created'`, `data:{category:{…incl. sub, __v}}` | 400 validation; no name uniqueness |
| POST | `/categories/create-local-categories` | `CreateLocalCategoriesDto`: `sub` IsString+IsNotEmpty (not IsMongoId) | 201 `'New category created'`, `data:{categories:[12 docs incl. sub]}` | 400 `'Local categories already exists'` (checked only by the first default's name for that `sub`) |
| PUT | `/categories` | `UpdateCategoriesDto` = `PartialType(Create)` (from `@nestjs/swagger`) + `categoryId` IsMongoId+IsNotEmpty | 200 `message:null`, `data:{category}` (updated doc, incl. sub) | 400 `'Category not found'` |
| DELETE | `/categories` | body `DeleteCategoryDto`: `categoryId` IsMongoId+IsNotEmpty | 200 `'Category deleted'`, `data:{category}` (deleted doc) | 400 `'Category not found'` |

Constants (`src/categories/constants.ts`): `CATEGORY_CREATED_MESSAGE 'New category created'`, `CATEGORY_DELETED_MESSAGE
'Category deleted'`, `CATEGORY_NOT_FOUND_ERROR 'Category not found'`, `LOCAL_CATEGORIES_EXISTS_ERROR 'Local categories
already exists'`. `ALL_LOCAL_CATEGORIES` = 12 objects `{categoryName, subCategories, icon}` in this order: Comida y
Bebida, Vivienda, Servicios básicos, Suscripciones, Transporte, Gastos financieros (`debtAndLoans`), Salud, Niños,
Compras, Entretenimiento, Ahorro, Ingreso (`income`). Copy verbatim, typos included (`'Pensión alimenticiat'`,
`'Communicación móvil'`, trailing space in `'Automóvil / Propiedad inmobiliaria '`).

Dead code not to port: `findById`, `findOrCreateByNameAndUserId` (only used by create-local), `updateSubcategories`,
`findOrCreateCategoriesByNameAndUserIdForRecords`, `LOCAL_CATEGORIES`, `SUBCATEGORY_*`, `CATEGORY_EXISTS_MESSAGE`,
`utils/getLocalCategory`. `validateCategoryExists({categoryId})` (id only, `NotFoundException('Category not found')`)
is the one S7 needs, and it is what the ownership assertion replaces.

## Clients (what must not break)

- **old-next (live):** only `GET /categories` from the server (`src/shared/lib/categoires.lib.ts:23`, Bearer),
  destructures `data.categories`; type `{_id, __v, categoryName, subCategories, icon}`. Never calls the mutations or
  create-local, so old-next signups have no categories (same as legacy; out of scope).
- **FE_Budget_Master:** all 5. Reads only `data.categories[]` (`_id, categoryName, subCategories, icon`) from GET;
  mutation responses are unread. POST sends `{categoryName, subCategories, icon:'newCategory'}`; PUT
  `{categoryName, subCategories, categoryId}` (no `icon`); DELETE `{categoryId}`. create-local is sent **without auth**
  with `{sub}` right after signup (from `data.userCreated.sub`; a failure lands in the signup catch) and after login
  whenever GET returns `[]`.

## Prod data (db-checks)

- `categories`: 133 docs, **`sub` stored as a string in all 133** (no ObjectId), 12 owners, 5 orphan owners with 55 docs,
  only the `_id_` index.
- Why strings although the legacy entity says `@Prop({ type: Types.ObjectId, ref: User.name })`: through
  `@nestjs/mongoose`'s `SchemaFactory` that prop becomes **`Mixed`** (checked against legacy node_modules: plain
  `new Schema({type: Types.ObjectId})` → `ObjectId`, the decorated class → `Mixed`). So legacy stores and queries
  whatever it is given: the JWT `sub` string. Same pattern on records' `category` and `account`, which explains D2's
  mixed values (S7). db-checks' "`countDocuments({account: string})` returns 0" used a plain-schema `ObjectId` and does
  not describe legacy runtime.
- Consequence: declare `sub` as `String` and query with `req.user.sub` as is; no dual-form matching needed for
  `categories.sub`. `_id` is always an ObjectId.

## Affected files and modules

- New module (name to confirm in planning, guideline: singular kebab-case, e.g. `category`) with controller path
  `categories`, entity pinned to `collection: 'categories'`, model name `Category` (S7 `ref`/populate use it),
  constants (messages + the 12 defaults), DTOs, service + spec. Registered in `src/app.module.ts`.
- Imports `UserModule` (exports `UserService`; `findById` already returns `null` for a non-ObjectId id) for the
  create-local user-exists check.
- `test/categories.e2e-spec.ts` (new); `ai-skills/REPO_CONTEXT.md` (structure, route table).
- Nothing in `src/auth` changes: `@Public()` on the create-local handler, `AuthenticatedRequest` + `req.user.sub`
  on the others.

## Existing patterns to follow

- Entity like `src/user/entities/user.entity.ts`: `@Schema({ collection })`, default `versionKey` (prod docs have
  `__v`), no timestamps, `HydratedDocument` type alias. Schema-declared indexes only build under test (`autoIndex`).
- Responses: `{ ...INITIAL_RESPONSE, message, data }` (`src/constants.ts`); legacy texts in `<module>.constants.ts`.
- `@nestjs/mapped-types` is not installed: the PUT DTO is written by hand with `@IsOptional()` on the three create
  fields (as `UpdateUserDto` was in S2).
- Global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`): extra body keys → 400 (so PUT can't set
  `sub`); legacy had the same flags.
- Errors: throw `BadRequestException(<legacy text>)` for the known cases; never wrap caught messages. Unexpected
  errors → 500 per D6; CastError → 400 via the catch-all.
- mongoose 9: `returnDocument: 'after'`, not `{ new: true }` (S2 memory).

## Decisions taken in research (from the given data)

- **`sub` type:** `String`, stored and queried as the string id. Prod has no ObjectId `sub`.
- **Stored `sub` on seeding:** the found user's `_id.toString()`, not the raw body value (an upper-case hex `sub`
  passes `findById` but would be stored in a form `GET` never matches).
- **Seed condition (D4):** the user exists and has **no** category at all (not legacy's "first default name exists").
  Only behaviour change: a user who deleted "Comida y Bebida" but kept others can no longer re-seed; no client does
  that (FE seeds only on signup or on `[]`).
- **Ownership (H3):** PUT/DELETE match `{_id: categoryId, sub}`; foreign = missing = 400 `'Category not found'`.
- **Index:** declare `{sub: 1}` on the schema; it builds in tests only. Prod gets it from **S8's index script**
  (`autoIndex` is off outside tests). 133 docs, so no prod impact meanwhile.
- **Multi-doc write:** ground rule 3 asks for a transaction on multi-document writes; the 12-doc `insertMany` is one.
  Tests and CI already run replica sets. No transaction helper exists in the repo yet (S4 would be first).

## Edge cases and constraints

- create-local responses: unknown `sub`, non-ObjectId `sub` and already-seeded user (see open question Q1).
  Missing/empty/non-string `sub` → legacy validation 400s (keep `IsString`+`IsNotEmpty`, no `IsMongoId`, or the
  messages change).
- Concurrent create-local calls for the same new user can both see "no categories" and seed twice; a transaction does
  not prevent it (no write conflict between two inserts). Legacy has the same race; clients don't trigger it in
  practice.
- PUT with only `categoryId` → legacy returns the doc unchanged (200). `categoryId` itself is in the legacy `$set`
  but dropped by strict mode; don't persist it.
- `subCategories: []` passes `IsNotEmpty`; elements aren't type-checked in legacy (keep).
- DELETE leaves records pointing at the deleted category (legacy, contract). Records cleanup isn't in S4.
- Orphan-owner categories (55 docs) are untouched; the user-delete cascade (S8) will need to remove `categories` by
  string `sub`. If S8 adds the cascade inside `UserModule`, mind the import direction (this module imports
  `UserModule`).
- For S7: legacy records return 404 `'Category not found'` from `validateCategoryExists` on expense/income
  create/update, and 400 (wrapped) on transfer. The ownership assertion throws the 404 form; S7 maps the transfer case.
  Records' stored `category` may be string or ObjectId (D2), but the assertion only checks incoming DTO ids (strings).

## Open questions

- **Q1 — create-local for an unknown or invalid `sub`.** Legacy seeds for any id. Recommendation: answer exactly like
  "already seeded", 400 `'Local categories already exists'`, with no write. It keeps a legacy text, gives no oracle for
  which ids are users, and no client sends an unknown `sub`. Alternative: 201 with `data:{categories:[]}` (misleading).
- **Q2 — module name.** Recommendation: `category` (singular per guidelines); route stays `/categories`, collection
  `categories`.
- **Q3 — transaction around the seed `insertMany`.** Recommendation: yes (ground rule 3; all-or-nothing matters
  because the "has any category" check would block a retry after a partial insert). Accept the double-seed race above.

## Assumptions

- Contract is develop; develop's categories code equals main's (develop survey).
- `GET` keeps `__v` and drops only `sub`; the POST/PUT/DELETE docs keep `sub` (string) as legacy did.
- The JWT guard's user-exists check makes "owner exists" implicit for the protected routes.
- FE_Budget_Master's behaviour comes from `be-refactor-frontend-usage.md`; its source wasn't re-read.
