# Repository Context - be-beyond-horizon-frontier

**Last Updated:** 2026-10-25

Architecture and conventions for the be-beyond-horizon-frontier NestJS backend.

> Sections marked _(planned)_ describe intended conventions, not existing code. Update this document as modules land.

## Overview

Backend for Budget Master. Today it has the S1 foundation (config, Mongo connection, response envelope, global error filters, validation, CORS, cookies, e2e harness) and one controller returning `Hello World!`. No feature modules yet.

_(planned)_ It is the rewrite of the legacy backend `be-budgt-master` (sibling checkout `../be-budgt-master`) (MongoDB/mongoose, JWT cookie auth, AWS Lambda). The existing frontend's HTTP contract must keep working — no breaking API changes. The plan and progress live outside this repo, in `~/projects/notes/budget-master/be-refactor.md` (local notes, not in this repo).

**Tech Stack:**

- NestJS 12 (`@nestjs/core` 12.2), Express platform (`@nestjs/platform-express`)
- `@nestjs/config` 12 + Joi 18 (env validation), `@nestjs/mongoose` 12 + mongoose 9, class-validator / class-transformer, cookie-parser
- TypeScript 6, ESM (`"type": "module"`, `module`/`moduleResolution: nodenext`, `strict: true`)
- pnpm (`pnpm-lock.yaml`; CI pins pnpm 10, Node 22)
- Vitest 4 (unit + e2e), supertest for e2e
- oxlint (lint), Prettier (format)

## Current Structure

```
src/
├── main.ts                 # bootstrap: configureApp + enableShutdownHooks; listens on process.env.PORT ?? 3000
├── configure-app.ts        # configureApp(app): cookie-parser, ValidationPipe, filters, CORS (shared with e2e)
├── app.module.ts           # root module: ConfigModule + MongooseModule.forRootAsync, AppController + AppService
├── config.ts               # envSchema (Joi), buildMongoUri, registerAs('config') typed config
├── mongoose-options.ts     # mongooseOptions factory + assertTestMongoUri (prod-DB guard)
├── constants.ts            # VERSION_RESPONSE (from package.json), INITIAL_RESPONSE envelope
├── response.interface.ts   # GeneralResponse
├── exceptions/
│   ├── http-exception.filter.ts  # GeneralAppExceptionFilter (@Catch(HttpException))
│   └── catch-all.filter.ts       # CatchAllExceptionFilter (@Catch())
├── app.controller.ts       # GET /
├── app.controller.spec.ts
└── app.service.ts
test/
├── global-setup.ts         # MONGO_TEST_URI or MongoMemoryReplSet → provide('mongoUri')
├── setup-env.ts            # overwrites process.env for e2e; E2E_DB_NAME
├── create-test-app.ts      # createTestApp / closeTestApp
└── app.e2e-spec.ts
.env.example                # every S1 key, documented
.gitleaksignore             # known gitleaks false positives (by fingerprint)
vitest.config.ts            # unit: **/*.spec.ts
vitest.config.e2e.ts        # e2e: **/*.e2e-spec.ts, globalSetup + setupFiles, no file parallelism
oxlint.json                 # no-explicit-any off, no-floating-promises warn
```

Does **not** exist yet — don't assume it: feature modules, auth, guards, interceptors, a custom logger, request ids, helmet, `/health`, OpenAPI docs, path aliases (`tsconfig.json` has no `paths`).

## Config

- `src/config.ts`. `ConfigModule.forRoot({ envFilePath: '.env', load: [config], isGlobal: true, validationSchema: envSchema })` in `AppModule`. Missing/invalid keys fail at startup with `Config validation error`.
- Keys (legacy names): `MONGO_URI` **or** `MONGO_CONNECTION` + `MONGO_USER` + `MONGO_PWD` + `MONGO_HOST` (full host); `MONGO_DB_NAME`; `FRONTEND_URI`, `TEST_FRONTEND_URI`, `DOMAIN_URI`; `NODE_ENV`; optional `PORT`. Unknown keys are allowed. Later stories add their keys to `envSchema`, the `registerAs` object and `.env.example`.
- Read config by injecting `@Inject(config.KEY) c: ConfigType<typeof config>` (or `app.get(config.KEY)`), never `process.env` in services.
- The owner's `.env` points at the **prod** DB (local dev uses prod data). Tests never read it for Mongo.
- CORS origins are the three `*_URI` keys: scheme required, no trailing slash (CORS matches exactly).

## Database

- Connection in `AppModule`: `MongooseModule.forRootAsync({ inject: [config.KEY], useFactory: mongooseOptions })`. No separate `DatabaseModule` (`MongooseCoreModule` is global).
- `mongooseOptions`: `serverSelectionTimeoutMS: 5000`, `retryAttempts` 0 under test / 2 otherwise, `retryDelay: 1000`, `autoIndex` only when `NODE_ENV=test` (prod indexes come from S8's script).
- Prod-DB guard: whenever `VITEST` is set or `NODE_ENV=test`, `assertTestMongoUri` requires `mongodb://` and every host in `localhost` / `127.0.0.1` / `[::1]`.

## Response envelope

- Success responses spread `INITIAL_RESPONSE` per route: `{ ...INITIAL_RESPONSE, data }` → `{ version, success, message, data, error }`. `version` is package.json's version. No response interceptor.
- `GET /` is excluded: it returns plain `Hello World!` (`text/html`).

## Error filters

Registered in `configureApp` as `useGlobalFilters(new CatchAllExceptionFilter(), new GeneralAppExceptionFilter())`. Nest reverses global filters, so this order makes `HttpException`s hit `GeneralAppExceptionFilter` and everything else the catch-all. Both answer inside the envelope (`success: false`, `data: null`, `message: null`).

| Error | Status | `error` |
|---|---|---|
| `HttpException` (incl. ValidationPipe, 404, invalid JSON) | its status | `exception.getResponse()` (legacy `{ message, error, statusCode }`) |
| mongoose `CastError` | 400 | `{ message: 'Invalid <path>', error: 'Bad Request', statusCode: 400 }` |
| `BSONError` (bad ObjectId) | 400 | `{ message: 'Invalid id', … }` |
| mongoose `ValidationError` | 400 | `{ message: [validator messages], … }` |
| `code === 11000` | 409 | `{ message: 'Duplicate value', error: 'Conflict', statusCode: 409 }` |
| exposed `http-errors` (e.g. 413) | its status | `{ statusCode, message }` |
| anything else | 500 | `{ statusCode: 500, message: 'Internal server error' }` |

Logging rule: method + route pattern (`req.route?.path`) + status (+ stack where safe). Never the URL, body, cookies, `Authorization`, `keyValue` or emails. 4xx `HttpException`s and exposed http-errors are not logged; 5xx and unknown errors are logged as `error`, Mongo mappings as `warn`.

## E2E harness

- `createTestApp({ controllers? })` builds `AppModule` (+ optional test-only controllers), runs `configureApp`, `init()`. It calls `assertTestMongoUri` before compiling.
- `closeTestApp(app)` drops the DB only if its name is `budget-master-e2e`, then closes the app.
- `test/global-setup.ts` uses `MONGO_TEST_URI` (CI: docker replica set) or starts a `MongoMemoryReplSet` locally; `test/setup-env.ts` overwrites `process.env` so `.env` never decides the target.

## Controllers and API Routes

| Controller      | Route   | Guards | Purpose                               |
| --------------- | ------- | ------ | ------------------------------------- |
| `AppController` | `GET /` | none   | Starter route, returns `Hello World!` (`text/html`, no envelope) |

## Testing Structure

- **Unit tests:** `*.spec.ts` co-located with source — `pnpm test` (`vitest run`, config `vitest.config.ts`)
- **E2E tests:** `test/*.e2e-spec.ts` — `pnpm run test:e2e` (config `vitest.config.e2e.ts`)
- **Coverage:** `pnpm run test:cov` → `coverage/` (`@vitest/coverage-v8`)
- Both configs use `globals: true` and `vite-tsconfig-paths`.

## Branching & Release

- PRs target `main` (no `develop`). Feature branches are named `feat/<topic>`.
- `check-label.yml`: every PR needs a `major`, `minor` or `patch` label.
- `ci.yml`: on PRs to and pushes to `main` — job `verify`: `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run build`, `pnpm test`, then a `mongo:8` replica set via `docker run --replSet rs0` and `pnpm run test:e2e` with `MONGO_TEST_URI`. Job `secrets` (parallel): gitleaks (`ghcr.io/gitleaks/gitleaks:v8.30.1`) over the full git history with `--redact`.
- `update-changelog.yml`: on merge to `main`, bumps `package.json` version per the label (highest wins), prepends the PR to `CHANGELOG.md`, commits `chore(release): vX.Y.Z (<bump>)`, tags `vX.Y.Z` and pushes.

## Adding New Modules

1. Scaffold with the Nest CLI (see `IMPLEMENTATION_GUIDELINES.md`).
2. Confirm the module is registered in `src/app.module.ts` (`nest g mo` does this).
3. Export services other modules need, via the module's `exports` array.
4. Update this document: module details and the route table.

## Common Patterns

### Module Export Pattern

```typescript
@Module({
  providers: [MyService],
  exports: [MyService], // ← makes the service available to importing modules
})
```

### ESM relative imports

Relative imports end in `.js` (`import { AppService } from './app.service.js';`).

### Guard Stacking _(planned)_

No guards exist yet. When they do: authentication guard first, then authorization.

## Notes

- `.env.example` documents every key; `.env` is gitignored.
- `package.json` has a `deploy` script (`nest deploy`, with `@nestjs/mau` installed), but there is no deployment config or deploy workflow in the repo. _(planned)_ deployment target is not decided here; check the external plan.
- `dist/` and `*.tsbuildinfo` are build output (gitignored).
