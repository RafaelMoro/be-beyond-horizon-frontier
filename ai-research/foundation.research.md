# Research: S1 — foundation (config, DB, envelope, errors, validation, test harness)

**Branch:** `feat/foundation` · **Date:** 2026-10-25 · **Type:** single story, full research

Sources: `~/projects/notes/budget-master/be-refactor.md` (S1, ground rules, decisions D0/D6/D15/D16/D17),
`be-refactor-survey.md` §0–§3.1/§5, `be-refactor-survey-develop.md`, `be-refactor-frontend-usage.md`,
`be-refactor-db-checks.md` §6. Legacy contract = `be-budgt-master` **`origin/develop`** (v1.5.5, D0).

## Story

Give the empty `nest new` app the cross-cutting plumbing every later story needs, keeping the legacy
HTTP contract: env config with the legacy names, the Mongo connection, the `{version, success, message,
data, error}` envelope, the legacy HttpException error body, a catch-all 500 inside the envelope (D6),
the global ValidationPipe, cookie-parser, CORS (+`credentials: true`, D15), `GET /` → `Hello World!`,
one shared `configureApp(app)`, and an e2e harness on a real, non-prod Mongo (D16).

## Acceptance criteria

1. A request with an unknown body property gets 400 and the legacy body:
   `{version, success:false, data:null, message:null, error:{message:['property X should not exist'], error:'Bad Request', statusCode:400}}`.
2. The app boots with the legacy env var names; a missing required var fails at startup with a config
   validation error. A full `MONGO_URI` (or a host var) can replace the hardcoded Atlas host.
3. A non-HTTP error thrown in a handler gives 500 inside the envelope (`success:false`, `data:null`,
   `message:null`, `error` = generic, no internals) and is logged.
4. `configureApp(app)` (pipe, filters, cookie-parser, CORS) is used by `main.ts` and by the e2e harness;
   `GET /` → 200 `Hello World!`; `OPTIONS` from a listed origin → 204 with `Access-Control-Allow-Credentials: true`.
5. `pnpm run test:e2e` runs against a real Mongo **replica set** given by `MONGO_TEST_URI` (or a local
   `mongodb-memory-server` fallback); it refuses to start if the target URI looks like prod. Unit tests
   cover both filters and the envelope. E2E runs in CI.

## Legacy contract (origin/develop)

| Piece | Legacy file | Fact |
|---|---|---|
| Bootstrap | `src/main.ts`, root `lambda.ts` | Identical setup in both: `cookieParser()`, `ValidationPipe({whitelist, forbidNonWhitelisted})` (no `transform`), `useGlobalFilters(new GeneralAppExceptionFilter())`, `enableCors({origin:[FRONTEND_URI, TEST_FRONTEND_URI, DOMAIN_URI], methods:'GET,HEAD,PUT,PATCH,POST,DELETE', preflightContinue:false, optionsSuccessStatus:204})`. `dotenv.config()` runs first because CORS origins are read from `process.env` before Nest starts. `PORT ?? 8080`. Lambda: cached bootstrap, `app.init()`, `event.path ''→'/'` |
| Env | `src/app.module.ts:28-47` | `ConfigModule.forRoot({envFilePath:'.env', load:[config], isGlobal:true, validationSchema: Joi})`; all 16 keys `Joi.string().required()`: `CLUSTER, MONGO_USER, MONGO_PWD, MONGO_DB_NAME, MONGO_CONNECTION, JWT_KEY, ONE_TIME_JWT_KEY, PUBLIC_KEY, FRONTEND_URI, TEST_FRONTEND_URI, MAILER_MAIL, FRONTEND_PORT, ENVIRONMENT, DOMAIN_URI, NODE_ENV, RESEND_API_KEY` |
| Typed config | `src/config.ts` | `registerAs('config', …)` → `database{cluster,mongoDbName,user,password,connection}`, jwt keys, URIs, `mailer{…}`; injected as `ConfigType<typeof config>` via `config.KEY` |
| DB | `src/database/database.module.ts` | `@Global` `MongooseModule.forRootAsync`: `uri = ${connection}://${user}:${password}@${cluster}.q040o.mongodb.net/?retryWrites=true&w=majority` (host suffix hardcoded) plus `user`, `pass`, `dbName` options |
| Envelope | `src/constants.ts`, `src/response.interface.ts` | `INITIAL_RESPONSE = {version: VERSION_RESPONSE, success:true, message:null, data:null, error:null}`; `GeneralResponse {version:string; success:boolean; data:unknown; message:string\|null; error:string\|object}`. `VERSION_RESPONSE = process.env.npm_package_version` |
| Error filter | `src/exceptions/GeneralExceptionFilter.filter.ts` | `@Catch(HttpException)` → `status(getStatus()).send({version, success:false, data:null, message:null, error: getResponse()})` (key order differs from INITIAL_RESPONSE; JSON-irrelevant) |
| Dead | `src/exceptions/CustomizedException.exception.ts` | unused; don't port |
| Middleware | `src/middleware/Logged.middleware.ts` | cookie → `Authorization: Bearer` — **S2**, not this story |

Runtime probes (db-checks §6): `GET /` → 200 `text/html` `Hello World!` (no envelope). 401 body:
`{"version":"1.5.0","success":false,"data":null,"message":null,"error":{"message":"Unauthorized","statusCode":401}}`.
Preflight from a listed origin → 204, origin echoed, methods as above, headers mirrored, `Vary: Origin, Access-Control-Request-Headers`,
no `Allow-Credentials`; unlisted origin → 204 without `Allow-Origin`.

Non-HttpException errors today: Nest's raw `{statusCode:500, message:'Internal server error'}`, **no envelope**.
FE (frontend-usage D6/envelope): reads only `error.data.error.message` (4 exact texts, all S2) and 2xx vs non-2xx;
never reads `version`, `success`, `statusCode`. So the 500 change (D6) and the `version` value are invisible to it.

## Target repo today

Unmodified starter: `src/main.ts` (top-level `await bootstrap()`, `PORT ?? 3000`), `src/app.module.ts`
(no imports), `src/app.controller.ts` / `app.service.ts` (`GET /` → `Hello World!`), `src/app.controller.spec.ts`,
`test/app.e2e-spec.ts` (builds the app with `createNestApplication()` + `init()`, no global setup).
Deps: only `@nestjs/common|core|platform-express` 12.2, express 5.3, cors 2.8.6. No `.env`, no
`.env.example`. `tsconfig.build.json` has `rootDir: ./src`. `ci.yml` runs lint, build, `pnpm test` —
**not e2e** (S1 stories need e2e green in CI, so `ci.yml` is in scope). Vitest 4.1 on Vite 8.3 (oxc);
decorator metadata already works (the existing DI spec passes in CI).

## Affected files and modules

- `package.json` / `pnpm-lock.yaml` — new deps (below).
- `src/main.ts` — use `configureApp`.
- New: a `configureApp(app)` module; config (`registerAs` + Joi schema); a database module; envelope
  type + `INITIAL_RESPONSE` + version constant; HttpException filter; catch-all filter; their specs.
- `src/app.module.ts` — import ConfigModule + DatabaseModule.
- `test/app.e2e-spec.ts`, `vitest.config.e2e.ts` (global setup / env for the DB), a prod guard.
- `.github/workflows/ci.yml` — e2e job with a Mongo.
- `.env.example` (new; documents legacy names + the new Mongo vars, test URI).
- `ai-skills/REPO_CONTEXT.md`, `ai-skills/IMPLEMENTATION_GUIDELINES.md` (Config/Database/error sections become real).

## Dependencies (registry, 2026-10-25) and ESM behaviour

| Package | Version | Notes |
|---|---|---|
| `@nestjs/config` | 12.0.1 | ESM (`type: module`). **`validationSchema` is now Standard Schema** (`StandardSchemaV1`); it special-cases vendor `joi` and applies Joi default options (`dist/utils/validate-with-schema.util.js`). Undeclared vars are merged back. `forRoot()` returns `Promise<DynamicModule>` (fine in `imports`). Bundles dotenv 18 — no separate `dotenv` dep needed if CORS origins are read from `ConfigService` |
| `joi` | 18.3.0 | Implements `~standard` (lib/base.js:1248) → required for `@nestjs/config` 12 (Joi 17, the legacy version, does not). CJS `module.exports = internals.root()` — **use the default import**; `import * as Joi` has no named exports under Node ESM (works under Vitest's interop, then crashes in `node dist/main.js`) |
| `@nestjs/mongoose` | 12.0.0 | ESM; peers mongoose `^7 \|\| ^8 \|\| ^9` |
| `mongoose` | 9.11.4 | CJS, `import mongoose from 'mongoose'`; Node ≥ 20.19 (repo on 22.16). Legacy is 8.15; 9 is a major (later stories port schemas — note for them) |
| `cookie-parser` + `@types/cookie-parser` | 1.4.7 / 1.4.10 | CJS function export → default import (`esModuleInterop` is on) |
| `class-validator` / `class-transformer` | 0.15.1 / 0.5.1 | Nest 12 loads both with dynamic `import()` from ValidationPipe; must be installed or the pipe throws at startup |
| `mongodb-memory-server` | 11.3.0 | dev; Node ≥ 20.19; `MongoMemoryReplSet` for a 1-node replica set. A `mongod-x64-ubuntu-8.2.6` binary is already cached in `~/.cache/mongodb-binaries` |

## Nest 12 facts that constrain the design

- **Filter order:** global filters are reversed before matching (`core/router/router-exception-filters.js:26`),
  so with two filters the catch-all must be registered **first** and the HttpException filter last — or use one `@Catch()` filter.
- Global filters also handle Nest's 404 not-found handler and Express errors (`routes-resolver.js` `registerExceptionHandler`):
  invalid JSON (`SyntaxError`) / bad `%` encoding become `BadRequestException` → enveloped 400, same as legacy.
  Other Express errors from `http-errors` (e.g. 413 payload too large) keep their status in Nest's base filter
  (`base-exception-filter.js` `isHttpError`); a naive catch-all would turn them into 500.
- `HttpException.createBody` (Nest 12) is the same shape as legacy (`{message, error, statusCode}`), plus `errorCode` only if one is passed.
- ValidationPipe 12: `forbidUnknownValues:false` default, list error format, new `maxErrorMessagesLength` (1,000,000 chars) —
  no visible change. `transform:true` returns the DTO instance (legacy returned `classToPlain`, same `Date` effect, survey §2.1).
- Nest's default 500 body is `{statusCode:500, message:'Internal server error'}`; `new InternalServerErrorException().getResponse()`
  is `{message:'Internal Server Error', statusCode:500}` (different casing).
- `useGlobalFilters/Pipes` in `main.ts` are not picked up by `Test.createTestingModule` apps — hence `configureApp` must also run in the e2e harness.

## `version` field

Legacy value = `npm_package_version`: set under `pnpm run`, **undefined on Lambda → key dropped**. FE never reads it.
This repo's `package.json` version is the real release (bumped by `update-changelog.yml`). Reading it:
- JSON import attribute needs `resolveJsonModule` and fails `rootDir: ./src` (package.json is outside).
- Runtime `fs` read relative to `import.meta.url`: a file directly in `src/` resolves `../package.json`
  from both `src/` (vitest) and `dist/` (build) — but only if the file sits at that depth, and on Lambda only if
  the package step ships `package.json` (S9).
- Recommended: read package.json at startup; keep the key present (string) everywhere.

## Mongo connection / env

- Legacy names must keep working (AC2) but the host suffix `q040o.mongodb.net` must not stay hardcoded (ground rule 3).
  The legacy `.env` has no host var, so "boot with the old `.env` unchanged" and "no hardcoded host" conflict → open question 1.
- If a URI is assembled from parts, user/password need URL-encoding (legacy avoided it by also passing `user`/`pass` options, which win).
- `MONGO_DB_NAME` as `dbName` applies whichever way the URI is given (also lets tests pick a db).
- Which legacy keys S1 makes required → open question 2.
- `.env` points at **the live prod DB** (db-checks; D16). `ConfigModule` loads `.env` from cwd in tests too; a value already
  in `process.env` wins over `.env` (`ignoreEnvVars`/override not set). So the prod guard must check the **URI the app actually
  connects with**, not only `MONGO_TEST_URI`.

## Test harness: container vs mongodb-memory-server

| | Mongo container (`MONGO_TEST_URI`) | `mongodb-memory-server` |
|---|---|---|
| Local today | Docker CLI is Windows' Docker Desktop **without WSL integration** — not usable | Works now (binary cached) |
| Replica set | Needs `--replSet rs0` + `rs.initiate()`; connect with `directConnection=true` (member host is container-internal) | `MongoMemoryReplSet({replSet:{count:1}})`, built in |
| GitHub CI | `services:` **cannot pass a command/args**, so a plain `services: mongo` is standalone (no transactions). Needs a `docker run … --replSet` step + init, or an image that self-initializes | Downloads the binary (cache `~/.cache/mongodb-binaries`); no Docker needed |
| D16 fit | Exactly D16 | Not D16's wording, but never prod |

What makes both work: one entry (vitest `globalSetup`) that uses `MONGO_TEST_URI` when set, otherwise starts a
`MongoMemoryReplSet`; passes the URI to workers (`provide`/`inject` or env before workers spawn); runs the prod guard
on the final URI; overrides the app's Mongo env so `.env` can't win; drops the test db between specs/files. → open question 3.

Prod-guard heuristics: legacy prod URI is `mongodb+srv://…@<cluster>.q040o.mongodb.net`. A deny-list (`mongodb+srv`,
`*.mongodb.net`, equals the app's `MONGO_URI`) can miss a renamed host; an allow-list (`localhost`, `127.0.0.1`, CI service name) cannot.

## Edge cases and constraints

- `GET /` must stay outside the envelope; legacy content type is `text/html` (Express `send(string)`), not `text/plain`.
- CORS with `credentials:true` and an origin array: allowed origins are echoed, `Allow-Credentials: true` added; unlisted → 204 without headers. All three origin vars are required, so no `undefined` in the list.
- Catch-all must log the original error (nothing is logged in legacy) and must not leak messages (survey §5.9).
- Unit tests for filters need a fake `ArgumentsHost` (`switchToHttp().getResponse()` with `status().send()` or `json()`); legacy uses `send`.
- A root-level `lambda.ts` (legacy location) would fall outside `rootDir: ./src`; `configureApp` must not call `listen` (S9 uses `init`).
- PORT default: legacy 8080, starter 3000, FE fallback 6006 — not a contract.

## Open questions

1. **Mongo host with the legacy `.env`.** Recommend: accept `MONGO_URI` (full), else build from `MONGO_CONNECTION`/`MONGO_USER`/`MONGO_PWD` + a new `MONGO_HOST` (full host, e.g. `<cluster>.q040o.mongodb.net`); `CLUSTER` stays accepted but optional. The old `.env` needs one added line; no hardcoded host.
2. **Which env vars S1 requires.** Recommend: only what S1 consumes (Mongo vars, `FRONTEND_URI`, `TEST_FRONTEND_URI`, `DOMAIN_URI`, `NODE_ENV`); each later story adds its own keys (JWT_*, RESEND_*, MAILER_MAIL, FRONTEND_PORT, ENVIRONMENT) with the legacy names. `PUBLIC_KEY` is dropped in S2 (survey §5.10). Avoids dummy secrets in tests now.
3. **D16 vs AC3 / ground rule 4 (container vs memory-server).** D16 wins, but a plain GH `services: mongo` has no replica set. Recommend: harness honours `MONGO_TEST_URI` (container, D16) and falls back to `MongoMemoryReplSet` locally; in CI either a `docker run --replSet` step (strict D16) or the memory server (simpler). Owner picks the CI side.
4. **Catch-all `error` body.** Recommend Nest's legacy default object `{statusCode:500, message:'Internal server error'}` inside the envelope; keep `http-errors` statuses (413 etc.) instead of forcing 500.
5. **Prod guard style.** Recommend an allow-list of local/CI hosts over a deny-list of Atlas patterns.

## Assumptions

- `version` = package.json version read at startup (instruction + survey §5.22); FE never reads it.
- Mongoose 9 + Joi 18 (latest), not the legacy 8/17; Joi 18 is forced by `@nestjs/config` 12.
- `.env.example` is in scope (new vars must be documented); the `LoggedMiddleware`, guards, `ParseObjectIdPipe` and logger are not (S2+/later).
- Success responses use `INITIAL_RESPONSE` spread per route (legacy pattern); no response interceptor.
- Data written by e2e never touches prod; tests drop their db.
