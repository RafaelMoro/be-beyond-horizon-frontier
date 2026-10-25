# Plan: S1 — foundation (config, DB, envelope, errors, validation, test harness)

**Status:** **APPROVED** by the owner 2026-10-25, with changes (run-all authorized).
Q1 (`ValidationPipe` `transform: true`) answer: keep it.
Changes come from the review `~/projects/notes/budget-master/be-refactor-s1-plan-review.md` (M1, M2, S1–S6, N1, N3)
plus the security audit (secret scanning in CI).

**Branch:** `feat/foundation` · **Date:** 2026-10-25 · **Research:** [`ai-research/foundation.research.md`](../ai-research/foundation.research.md)
· Memory: [`memories/repo/foundation-research.md`](../memories/repo/foundation-research.md), [`memories/repo/foundation-planning.md`](../memories/repo/foundation-planning.md)

Owner decisions applied (from `~/projects/notes/budget-master/be-refactor.md`): E1.F1–E1.F5 as the research
recommended, D6 (500 for unexpected errors), D14 (browser sends `Authorization: Bearer`, so CORS must allow it),
D15 (`credentials: true`), D16 (tests never touch prod; local dev uses prod DB), D18 (origins only from env).
The research assumptions are accepted: version read from package.json, mongoose 9 + Joi 18, `.env.example`, envelope
spread per route, `GET /` stays `text/html`, e2e drops its own DB.

AC numbers below are the research's AC1–AC5.

## Scope guard

**In:** everything in the research's "Affected files" list, the review changes listed above, and a secret-scanning CI job.

**Out (don't add):** helmet (S8), `/health`, request ids, Lambda pool sizing (S9), 503 mapping for DB infrastructure
errors, `LoggedMiddleware`, guards, `ParseObjectIdPipe`, logger setup, `lambda.ts` (S9), JWT/mail env keys (S2/S3), a `PORT` default change.

## Logging rule (applies to both filters)

A log line carries `method`, the **route pattern** (`req.route?.path ?? '<unmatched>'`) and the status, plus the stack
where the stack can't contain user data (see each branch).
It **never** includes `req.originalUrl`/`req.url` (reset-password URLs carry a live token), bodies, cookies, the
`Authorization` header, `keyValue`, or emails.

---

## Phase 1 — Dependencies, typed config, envelope constants

**Changes**

1. `package.json` / `pnpm-lock.yaml` — modify via the CLI, no hand edit:
   - `pnpm add @nestjs/config @nestjs/mongoose mongoose joi cookie-parser class-validator class-transformer`
   - `pnpm add -D @types/cookie-parser mongodb-memory-server`
   - Versions per the research table (`joi` must be ≥ 18: `@nestjs/config` 12 needs Standard Schema).
   - pnpm 10 skips `mongodb-memory-server`'s postinstall, so the binary downloads on first use. CI never uses it (Phase 5 sets `MONGO_TEST_URI`).

2. `src/config.ts` — create (hand-authored, legacy file name and location).
   - `import Joi from 'joi'` (default import. `import * as Joi` crashes under `node dist/main.js`, see research).
   - `export const envSchema = Joi.object({...})`:
     - `MONGO_URI: Joi.string()` (optional).
     - `MONGO_CONNECTION`, `MONGO_USER`, `MONGO_PWD`, `MONGO_HOST`:
       `Joi.string().when('MONGO_URI', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() })`.
     - `FRONTEND_URI`, `TEST_FRONTEND_URI`, `DOMAIN_URI`:
       `Joi.string().uri({ scheme: ['http', 'https'] }).pattern(/[^/]$/, 'no trailing slash').required()` (review S5).
       CORS matches origins exactly, so a trailing `/` or a missing scheme would silently block the client. The owner's
       current legacy values were checked on 2026-10-25: all three have a scheme and no trailing slash, so they pass.
     - `MONGO_DB_NAME`, `NODE_ENV`: `Joi.string().required()`.
     - No other keys. `@nestjs/config` applies Joi's `allowUnknown`, so the legacy `.env`'s extra keys (`CLUSTER`,
       `JWT_KEY`, …) pass untouched (E1.F1: `CLUSTER` optional. E1.F2: only S1's keys required).
   - `export function buildMongoUri(env: NodeJS.ProcessEnv): string`:
     - `MONGO_URI` set → return it unchanged.
     - else → `${MONGO_CONNECTION}://${encodeURIComponent(MONGO_USER)}:${encodeURIComponent(MONGO_PWD)}@${MONGO_HOST}/?retryWrites=true&w=majority`.
   - `export default registerAs('config', () => ({ database: { uri: buildMongoUri(process.env), dbName: process.env.MONGO_DB_NAME }, frontendUri, testFrontendUri, domainUri, nodeEnv }))`.
     Consumers inject `ConfigType<typeof config>` through `config.KEY`.

3. `src/response.interface.ts` — create. `GeneralResponse { version: string; success: boolean; data: unknown; message: string | null; error: string | object | null }`.

4. `src/constants.ts` — create. **Must sit directly in `src/`** so `new URL('../package.json', import.meta.url)`
   resolves to the repo root both from `src/` (vitest) and `dist/` (build).
   - `export const VERSION_RESPONSE: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version`
     (read once at import. Comment why it is not `npm_package_version`: that is undefined on Lambda).
   - `export const INITIAL_RESPONSE: GeneralResponse = { version: VERSION_RESPONSE, success: true, message: null, data: null, error: null }`.

5. `src/config.spec.ts`, `src/constants.spec.ts` — create.

**Test coverage**
- `envSchema`, valid cases: a full legacy-style env plus `MONGO_HOST` passes. `MONGO_URI` alone (no parts) passes.
  Unknown keys pass with `{ allowUnknown: true }`.
- `envSchema`, failing cases: no `MONGO_URI` and no `MONGO_HOST` fails. Missing `FRONTEND_URI` fails.
  `FRONTEND_URI` with a trailing `/` fails, and so does one without a scheme (`example.com`).
- `buildMongoUri`: `MONGO_URI` wins over parts. Parts build the expected string. A password with `@`/`:`/`/` is percent-encoded.
- `INITIAL_RESPONSE` has exactly the 5 keys with the legacy defaults. `version` equals package.json's `version`.

**Success criteria**
- `pnpm run lint`, `pnpm run build`, `pnpm test` pass.

---

## Phase 2 — Exception filters

**Changes**

1. `src/exceptions/http-exception.filter.ts` — create. Name it `GeneralAppExceptionFilter` (legacy name). `@Catch(HttpException)`.
   - If `res.headersSent`: call `res.end()` and return (review N1, same as Nest's base filter).
   - Otherwise: `res.status(exception.getStatus()).send({ ...INITIAL_RESPONSE, success: false, error: exception.getResponse() })`.
   - If `status >= 500`: `logger.error(`${method} ${routePattern} ${status}`, exception.stack)` (review S4).
     4xx is not logged (normal client traffic).

2. `src/exceptions/catch-all.filter.ts` — create. `CatchAllExceptionFilter`, `@Catch()`, with a private `Logger`.
   It applies the same `headersSent` guard first.

   Known error classes come before the 500 fallback (review M1).
   Bodies use Nest's HttpException shape `{ message, error, statusCode }` inside the envelope (`{ ...INITIAL_RESPONSE, success: false, error }`).
   **No raw library message ever reaches the body.**

   | Match (in this order) | Status | `error` body | Log |
   |---|---|---|---|
   | `exception instanceof mongoose.Error.CastError` | 400 | `{ message: 'Invalid ' + exception.path, error: 'Bad Request', statusCode: 400 }` | `warn`: route line + `CastError` + `path` only. The message holds the client's value, so it's left out |
   | `exception instanceof Error && exception.name === 'BSONError'` (bad `new Types.ObjectId(x)`) | 400 | `{ message: 'Invalid id', error: 'Bad Request', statusCode: 400 }` | `warn`: route line + name |
   | `exception instanceof mongoose.Error.ValidationError` | 400 | `{ message: Object.values(exception.errors).map(e => e.message), error: 'Bad Request', statusCode: 400 }` | `warn` with stack. After DTO validation this is often a server bug |
   | duck-typed `code === 11000` (`MongoServerError` / `MongoBulkWriteError`) | 409 | `{ message: 'Duplicate value', error: 'Conflict', statusCode: 409 }` | `warn`: route line + `keyPattern` only. **No message, no stack, no `keyValue`**: they contain the email |
   | Framework `http-errors` (review S3, Nest's signature): `exception instanceof Error && typeof expose === 'boolean' && Number.isInteger(statusCode) && status === statusCode && 400 <= statusCode <= 599 && expose === true` | `statusCode` (e.g. 413) | `{ statusCode, message: exception.message }` (E1.F4) | none (client traffic) |
   | anything else, including non-exposed 5xx `http-errors` and non-Error throws | 500 | `{ statusCode: 500, message: 'Internal server error' }` (E1.F4, D6) | `error`: route line + stack (`String(exception)` for non-Errors) |

   - Body-parser invalid JSON (`SyntaxError`/`URIError`) never reaches here. The Express adapter turns it into a
     `BadRequestException` → `GeneralAppExceptionFilter` → 400. Nothing to code. Phase 4 adds an e2e test for it.
   - No `HttpException` branch. The registration order (Phase 3) means none ever reach this filter.

3. `src/exceptions/http-exception.filter.spec.ts`, `src/exceptions/catch-all.filter.spec.ts` — create. Fake `ArgumentsHost`:
   - `switchToHttp().getResponse()` → `{ headersSent: false, status: vi.fn().mockReturnThis(), send: vi.fn(), end: vi.fn() }`.
   - `getRequest()` → `{ method: 'GET', route: { path: '/x/:id' }, originalUrl: '/x/SECRET-TOKEN' }`.
   - Spy on `Logger.prototype.error`/`warn` and silence them.

**Test coverage**
- HttpException filter, response bodies:
  - `BadRequestException` with a message array → 400 and the exact AC1 body.
  - `UnauthorizedException` → 401 and `error: { message: 'Unauthorized', statusCode: 401 }` (the legacy probe).
- HttpException filter, logging and `headersSent`:
  - `InternalServerErrorException` → logged once. The log arguments contain `/x/:id` and never `SECRET-TOKEN`.
  - A 400 is not logged.
  - `headersSent: true` → `end()` called, `send` not called.
- Catch-all, Mongo/Mongoose errors (one case each):
  - A real `mongoose.Error.CastError` (`new mongoose.Error.CastError('ObjectId', 'bad', '_id')`) → 400 `Invalid _id`.
  - A BSONError (from `new mongoose.Types.ObjectId('bad')` caught in the test) → 400.
  - A `ValidationError` with two field errors → 400 with both messages.
  - `Object.assign(new Error('E11000 duplicate key … { email: "a@b.c" }'), { code: 11000, keyPattern: { email: 1 }, keyValue: { email: 'a@b.c' } })`
    → 409. Neither the sent body nor any log argument contains `a@b.c`.
- Catch-all, framework errors:
  - `Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, expose: true, type: 'entity.too.large' })` → 413 with that message.
  - A plain object `{ statusCode: 413, expose: true, message: 'x' }` (not an `Error`) → 500.
  - An Error with `status !== statusCode` → 500.
  - An `expose: false` 5xx http-error → 500, logged.
- Catch-all, the 500 fallback:
  - `new Error('db password leaked')` → 500 with the exact generic body, no `leaked` in the body, `logger.error` called once, and no `SECRET-TOKEN` in the log.
  - `throw 'x'` → 500 without crashing, logged.
  - `headersSent: true` → `end()` only.

**Success criteria**
- `pnpm run lint`, `pnpm test` pass.

---

## Phase 3 — `configureApp`, bootstrap, Mongo connection, `.env.example`

**Changes**

1. `src/configure-app.ts` — create. `export function configureApp(app: INestApplication): void`. It never calls `listen` or `init` (S9's Lambda uses `init`).
   - `app.use(cookieParser())` (default import).
   - `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))` (Q1 answer: keep).
   - `app.useGlobalFilters(new CatchAllExceptionFilter(), new GeneralAppExceptionFilter())`. **Order is the
     contract.** Nest 12 reverses global filters, so the catch-all goes first. Comment this on the line.
   - `const { frontendUri, testFrontendUri, domainUri } = app.get<ConfigType<typeof config>>(config.KEY)` (D18).
   - `app.enableCors({ origin: [frontendUri, testFrontendUri, domainUri], methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', credentials: true, preflightContinue: false, optionsSuccessStatus: 204 })`.
     **No `allowedHeaders`.** That keeps legacy's mirror-request-headers behaviour, so `Authorization` and `Content-Type` pass (D14).
     Comment this, so no one later "tightens" it and breaks Bearer.

2. `src/main.ts` — modify: after `NestFactory.create(AppModule)`, call `configureApp(app)`.
   Then `app.enableShutdownHooks()` (review N3). It goes **in `main.ts` only**, not in `configureApp`: Lambda and tests don't need it.
   Keep `listen(process.env.PORT ?? 3000)` and the top-level `await bootstrap()`. No `dotenv` import.

3. `src/mongoose-options.ts` — create (hand-authored, no Nest module). It lives in `src/` because the connection
   factory needs the guard (`rootDir: ./src`).
   - `export function assertTestMongoUri(uri: string): void`. E1.F5 allow-list, unchanged from the previous plan:
     - The scheme must be `mongodb://`. `mongodb+srv://` is rejected.
     - Strip credentials, take the host list up to `/` or `?`, split it on `,`, and strip `:port`. Every host must be in `['localhost', '127.0.0.1', '[::1]']`.
     - Don't use `new URL()`. The error names the rejected host, never the password.
   - `export function mongooseOptions(c: ConfigType<typeof config>): MongooseModuleOptions`:
     - `const underTest = Boolean(process.env.VITEST) || c.nodeEnv === 'test'`.
     - If `underTest`: `assertTestMongoUri(c.database.uri)` (review M2). The check is **keyed on the host allow-list,
       not on `NODE_ENV`**: the owner's prod-pointing `.env` doesn't set `NODE_ENV=production`, so `NODE_ENV` only
       decides *when* the guard runs, never whether a URI is safe. Comment this. It also means any unit spec that
       imports `AppModule` and would read the prod `.env` throws here instead of connecting.
     - Returns `{ uri, dbName, serverSelectionTimeoutMS: 5000, retryAttempts: underTest ? 0 : 2, retryDelay: 1000, autoIndex: c.nodeEnv === 'test' }`.
       This covers review S1 and S2. Comment on `autoIndex`: `start:dev` hits the prod DB, so prod indexes come from S8's script.
       `setup-env.ts` sets `NODE_ENV=test`, so e2e still builds unique indexes and the E11000 paths stay testable.
   - `src/mongoose-options.spec.ts` — create.

4. `src/app.module.ts` — modify `imports`:
   - `ConfigModule.forRoot({ envFilePath: '.env', load: [config], isGlobal: true, validationSchema: envSchema })`.
   - `MongooseModule.forRootAsync({ inject: [config.KEY], useFactory: mongooseOptions })`.
   - No separate `DatabaseModule`: `MongooseCoreModule` is already global.

5. `.env.example` — create (repo root. `.gitignore` already ignores `.env`). One line per S1 key with a placeholder
   and a short comment:
   - Option A: `MONGO_URI`.
   - Option B: `MONGO_CONNECTION`/`MONGO_USER`/`MONGO_PWD`/`MONGO_HOST` (`MONGO_HOST` = full host).
   - `MONGO_DB_NAME`.
   - `FRONTEND_URI`, `TEST_FRONTEND_URI`, `DOMAIN_URI`: scheme required, no trailing `/`.
   - `NODE_ENV`, with a comment that `autoIndex` is on only when `test`.
   - `PORT` (optional).
   - `MONGO_TEST_URI` (optional, e2e only, local replica set).
   - Note at the top: `.env` points at the prod DB (D16), and later stories add their keys under the legacy names.

**Test coverage (`mongoose-options.spec.ts`)**
- `assertTestMongoUri` accepts:
  - `mongodb://127.0.0.1:PORT/?replicaSet=testset`
  - `mongodb://localhost:27017/?replicaSet=rs0`
  - a multi-host localhost list
- `assertTestMongoUri` rejects:
  - `mongodb+srv://u:p@x.q040o.mongodb.net`
  - `mongodb://u:p@cluster.mongodb.net:27017`
  - a list with one non-local host
  - In every rejection, the message has no password.
- `mongooseOptions`:
  - With an Atlas URI it throws under `VITEST` (the default in the spec).
  - With `vi.stubEnv('VITEST', '')` and `nodeEnv: 'development'` it does **not** throw, and `autoIndex` is `false` and `retryAttempts` is `2`.
  - A local URI with `nodeEnv: 'test'` → `autoIndex: true`, `retryAttempts: 0`, `serverSelectionTimeoutMS: 5000`.

**Success criteria**
- `pnpm run lint`, `pnpm run build`, `pnpm test` pass.
- Manual (AC2). The owner's `.env` is the legacy `../be-budgt-master/.env` plus one `MONGO_HOST=` line, and it points
  at **prod** (D16). These checks only boot and create no records:
  1. `pnpm run build && pnpm run start:prod` boots and connects (this also proves the ESM runtime).
  2. Comment out `FRONTEND_URI`, then `pnpm run start:prod`: it exits with `Config validation error … "FRONTEND_URI" is required`. Restore the line.
  3. Comment out `MONGO_HOST` (no `MONGO_URI`): it fails the same way. Restore the line.
  4. Set `MONGO_HOST=localhost:1` (nothing listening): boot fails within about 20 s instead of hanging for minutes (S1 timeouts). Restore the line.

---

## Phase 4 — E2E harness and e2e spec

**Changes**

1. `test/global-setup.ts` — create (vitest `globalSetup`, default export `async function setup(project)`).
   - `const uri = process.env.MONGO_TEST_URI ?? (await MongoMemoryReplSet.create({ replSet: { count: 1 } })).getUri()` (E1.F3).
   - `project.provide('mongoUri', uri)`. Return a teardown that stops the replica set when one was started.
   - `declare module 'vitest' { interface ProvidedContext { mongoUri: string } }`.

2. `test/setup-env.ts` — create (vitest `setupFiles`).
   - `export const E2E_DB_NAME = 'budget-master-e2e'`.
   - Overwrite `process.env`, so neither the prod `.env` nor CI's missing `.env` decides the target:
     - `MONGO_URI = inject('mongoUri')`, `MONGO_DB_NAME = E2E_DB_NAME`.
     - `FRONTEND_URI = 'http://localhost:4100'`, `TEST_FRONTEND_URI = 'http://localhost:4101'`, `DOMAIN_URI = 'http://localhost:4102'`, `NODE_ENV = 'test'`.

3. `test/create-test-app.ts` — create.
   - `export async function createTestApp(extra: { controllers?: Type[] } = {}): Promise<INestApplication<App>>`:
     - First `assertTestMongoUri(config().database.uri)` (imported from `src/mongoose-options.js`). It fails before
       `compile()`. The factory guard (Phase 3.3) is the second line of defense.
     - `Test.createTestingModule({ imports: [AppModule], controllers: extra.controllers ?? [] }).compile()`,
       `createNestApplication()`, `configureApp(app)`, `await app.init()`.
   - `export async function closeTestApp(app)` (review M2):
     - `const conn = app.get<Connection>(getConnectionToken())`.
     - **Throw unless `conn.db?.databaseName === E2E_DB_NAME`.** Only then `await conn.dropDatabase()`.
     - `await app.close()` either way, in a `finally`.

4. `vitest.config.e2e.ts` — modify `test`: `globalSetup: ['./test/global-setup.ts']`, `setupFiles: ['./test/setup-env.ts']`, `fileParallelism: false`.

5. `test/app.e2e-spec.ts` — rewrite. `beforeAll(createTestApp({ controllers: [ProbeController] }))` and `afterAll(closeTestApp)`.
   - `ProbeController` and `ProbeDto` are declared **inside the spec** (test-only, never shipped):
     - `ProbeDto { @IsString() name: string }`.
     - `@Post('probe') (@Body() dto: ProbeDto)` returns `{ ...INITIAL_RESPONSE, data: dto }`.
     - `@Get('boom')` throws `new Error('internal secret')`.
     - `@Get('cookies') (@Req() req)` returns `req.cookies`.
   - If the pipe doesn't reject the unknown property, check the `design:paramtypes` emission first (assumption below).

**Test coverage (e2e)**
- `GET /` → 200, body `Hello World!`, `content-type` matches `text/html` (AC4).
- `POST /probe` (AC1):
  - `{ name: 'a', extra: 1 }` → 400, body **equal** to `{ version, success: false, data: null, message: null, error: { message: ['property extra should not exist'], error: 'Bad Request', statusCode: 400 } }`.
  - `{ name: 'a' }` → 201 with the envelope.
- `POST /probe`, framework errors on the real path (review S6):
  - A JSON body over 100 kb (`{ name: 'x'.repeat(110_000) }`) → 413, `success: false`, `data: null`, `error: { statusCode: 413, message: 'request entity too large' }`.
  - `'{bad'` with `Content-Type: application/json` → 400, `success: false`, `data: null`, `error.statusCode: 400`. Don't pin the parser's message text.
- `GET /boom` → 500, body equal to the generic envelope, no `internal secret` in the text (AC3). `Logger` silenced with a spy.
- CORS preflight (AC4, D14, D15):
  - `OPTIONS /` with `Origin: http://localhost:4100`, `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: authorization,content-type`
    → 204, `access-control-allow-origin` echoed, `access-control-allow-credentials: true`, and `access-control-allow-headers` contains `authorization`.
  - The same request from `Origin: http://evil.test` → 204 without `access-control-allow-origin`.
- `GET /cookies` with `Cookie: accessToken=abc` → `{ accessToken: 'abc' }`.

**Success criteria**
- `pnpm test` and `pnpm run test:e2e` pass locally, without `MONGO_TEST_URI` (memory-server path, binary already cached).
- Manual: `MONGO_TEST_URI='mongodb+srv://u:p@x.mongodb.net' pnpm run test:e2e` fails in `assertTestMongoUri` before any connection.
- Records: `POST /probe` persists nothing, and `closeTestApp` drops the e2e DB after the name check, so nothing is left to clean up.

---

## Phase 5 — CI (e2e + secret scan) and docs

**Changes**

1. `.github/workflows/ci.yml` — modify.
   - **`verify` job**: after `- run: pnpm test` add these steps (E1.F3):
     - `Start MongoDB replica set`:
       - `docker run -d --name mongo -p 27017:27017 mongo:8 --replSet rs0 --bind_ip_all`.
       - A `timeout 60` ping loop (`docker exec mongo mongosh --quiet --eval "db.runCommand({ping:1})"`).
       - `rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})`.
       - A `timeout 60` loop until `db.hello().isWritablePrimary` prints `true`.
       - The member host `localhost:27017` resolves to the same mongod inside the container and on the runner (port mapped), so no `directConnection=true` is needed.
     - `- run: pnpm run test:e2e` with `env: MONGO_TEST_URI: mongodb://localhost:27017/?replicaSet=rs0`.
     - Rename the job to `Lint, build, test, e2e`.
   - **Why `docker run` and not the memory server in CI:** it is the owner's call (E1.F3) and D16's literal wording.
     It is also the only way CI covers the `MONGO_TEST_URI` path. The research rates the memory server as simpler, not
     more reliable. Each depends on one network download, and `services:` can't pass `--replSet`.
   - **New `secrets` job** (security audit), in parallel with `verify`:
     - `actions/checkout@v4` with `fetch-depth: 0`, then `docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:<pinned v8 tag> git /repo --redact --exit-code 1`.
     - It scans **the full git history** on every run. This repo's history is clean; the legacy repo leaked secrets.
     - Pin an exact release tag that is at least 2 weeks old, never `latest`.
     - Use the container CLI rather than `gitleaks/gitleaks-action`: the action scans only the PR's commit range
       on `pull_request`, and needs a license key for org repos.
     - `--redact` keeps any finding's value out of the public log.
     - Default rules, no `.gitleaks.toml`. If the first run flags `.env.example` placeholders, fix the placeholders, not the rules.

2. `ai-skills/REPO_CONTEXT.md` — modify:
   - Structure tree: add the new files.
   - "Does not exist yet": drop the items that land (config/env validation, database, filters, CORS, cookie parsing, global pipe).
   - New Config section: keys, `config.KEY`, `.env` = prod, CORS origin format.
   - New Database section: connection in `AppModule` via `mongooseOptions`, `autoIndex` only in tests, timeouts, the factory guard.
   - New Response envelope section: `INITIAL_RESPONSE` spread per route, `GET /` excluded.
   - New Error filters section: order, the mapping table, the logging rule.
   - New E2E harness section: `createTestApp`/`closeTestApp`, `MONGO_TEST_URI` / memory server, the guards.
   - Update the CI line (e2e and secret scan run) and Notes (env example exists).

3. `ai-skills/IMPLEMENTATION_GUIDELINES.md` — modify:
   - "Persistence, Auth, and Config _(adopt when needed)_" → real Config and Database sections (paths, injection,
     `autoIndex` off outside tests, so prod indexes come from S8's script).
   - "Error Handling" rewrite (review M1):
     - The global filters exist.
     - **Never `throw new BadRequestException(e.message)` (or any `HttpException` wrapping a caught error's message) around service code.**
     - Generic library errors (CastError, BSONError, ValidationError, E11000, body-parser) are mapped once in `CatchAllExceptionFilter`. Unknown errors become an enveloped 500.
     - Route-specific legacy texts and statuses are mapped **explicitly in that route's story**. Examples: E11000 on signup → 400 `'Try with other email.'`; reset-password jsonwebtoken errors → 400 with `err.message`, as legacy `verifyToken` does.
     - Drop the old "try/catch + `InternalServerErrorException`" example.
   - Logging rule: route pattern + method + status, never URL/body/cookies/emails.
   - E2E subsection: use `createTestApp`/`closeTestApp`, never point e2e at `.env`.
   - DTO note from the review: with `transform: true`, property initializers become defaults, so don't add them unless the contract has that default. Nested DTOs need `@ValidateNested()` + `@Type()`.

4. `CLAUDE.md` — modify the stale lines: "no database, config module…" and "E2E is not in CI" (now e2e and secret scan run in CI).

**Success criteria**
- CI on the PR: the `verify` job (lint, build, `pnpm test`, `pnpm run test:e2e`) and the `secrets` job are green (AC5).
- Manual: the CI log shows e2e against `localhost:27017` (no memory-server download), and gitleaks reports the commit count scanned (full history).

---

## AC → phase mapping

| AC | Validated by |
|---|---|
| AC1 unknown property → 400 legacy body | P2 unit (filter body). P4 e2e `POST /probe` |
| AC2 legacy env names, missing var fails, full `MONGO_URI` or host var | P1 unit (`envSchema` incl. origin format, `buildMongoUri`). P3 manual boots (legacy `.env` + `MONGO_HOST`, missing var, dead host fails fast) |
| AC3 non-HTTP error → enveloped 500, generic, logged; client-caused errors not 500 (M1) | P2 unit (500 fallback, each Mongo/http-errors mapping, no leaks in body or log, `headersSent`). P4 e2e `GET /boom`, 413, invalid JSON |
| AC4 `configureApp` shared, `GET /`, CORS preflight + credentials | P3 (main uses it, build, manual boot). P4 e2e (`createTestApp` uses it, `GET /`, `OPTIONS`, cookies) |
| AC5 e2e on a real replica set via `MONGO_TEST_URI` / memory fallback, prod guard, unit tests for filters + envelope, e2e in CI | P1/P2 unit specs. P3 `mongoose-options.spec` (factory guard, options). P4 harness, DB-name check before drop, manual guard check. P5 CI e2e + secret scan |

## AC Coverage Summary

| AC | Phase | Check | Coverage |
|---|---|---|---|
| AC1 | P2, P4 | automatic (unit + e2e) | full |
| AC2 | P1, P3 | automatic (schema/URI unit) + manual (boot, missing-var, dead-host boots) | full |
| AC3 | P2, P4 | automatic (unit + e2e) | full |
| AC4 | P3, P4 | automatic (e2e) + manual (`start:prod` boots through `configureApp`) | full |
| AC5 | P1–P5 | automatic (unit, e2e, CI) + manual (guard rejects an Atlas `MONGO_TEST_URI`) | full |

## Decisions (beyond the research)

- **No `DatabaseModule`.** `MongooseModule.forRootAsync({ useFactory: mongooseOptions })` goes in `AppModule`.
- **Guard and options in `src/mongoose-options.ts`.** The factory needs the guard, and `rootDir: ./src` forbids importing it from `test/`. The test helper imports it from `src/`.
- **Two filters, not one `@Catch()`:** the research AC5 asks for both. Catch-all registered first.
- **409 for E11000,** not 400 (owner's change list). Stories that need the legacy 400 text (signup) map it themselves.
- **CastError message:** `Invalid <path>`. BSONError: `Invalid id`. ValidationError: the schema validators' messages.
  They're Mongoose's own messages, safe because the only value they can hold is the client's own input.
- **Secret scan:** gitleaks container CLI on the full history, with `--redact`, as a separate parallel CI job.
- **`retryAttempts` 0 under test, 2 otherwise; `retryDelay` 1000.** The review suggested these values.
- **Small fixed values:** `PORT` default stays 3000, the CI image is `mongo:8`, and the e2e DB is `budget-master-e2e`.

## Assumptions

- The Vitest (oxc) transform emits `design:paramtypes` for `@Body() dto: ProbeDto` (the research says decorator metadata works).
- Vitest 4's `project.provide` / `inject` carries the URI from `globalSetup` to the workers.
- `GET /` already answers `text/html`, so no change is planned for it.
- Mongoose 9 still exports `mongoose.Error.CastError` / `ValidationError`, and the driver's ObjectId errors still have `name === 'BSONError'`.
  The unit tests build real instances, so a rename fails loudly.

## Implementation checklist (2026-10-25)

- [x] Phase 1 — deps, `src/config.ts`, `src/response.interface.ts`, `src/constants.ts`, specs. Lint/build/test green.
- [x] Phase 2 — `GeneralAppExceptionFilter`, `CatchAllExceptionFilter`, specs. Lint/test green.
- [x] Phase 3 — `configureApp`, `main.ts`, `mongoose-options.ts` + spec, `AppModule`, `.env.example`. Lint/build/test green.
  Manual: missing `FRONTEND_URI` / missing `MONGO_HOST` → `Config validation error`; dead host `127.0.0.1:1` fails in ~12 s.
  **Not run:** boot against the owner's real `.env` (prod), left for the owner.
- [x] Phase 4 — e2e harness (`global-setup`, `setup-env`, `create-test-app`), `vitest.config.e2e.ts`, `app.e2e-spec.ts`. E2E green on the memory-server path and on the `MONGO_TEST_URI` path; Atlas `MONGO_TEST_URI` refused before connecting.
- [x] Phase 5 — `ci.yml` (replica set + e2e, `secrets` job with gitleaks v8.30.1), `REPO_CONTEXT.md`, `IMPLEMENTATION_GUIDELINES.md`, `CLAUDE.md`.
  Deviation: added `.gitleaksignore` with one fingerprint (the stock `nest new` README CircleCI badge token in the initial commit), because the full-history scan flags it. Rules stay default.
  **Pending:** CI run on the PR (AC5).
