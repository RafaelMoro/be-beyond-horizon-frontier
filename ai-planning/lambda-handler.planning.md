# Plan: S9a — lambda-handler (ESM Lambda handler, `serverless.yml`, offline run, pnpm-aware package, owner runbook)

**Status:** APPROVED (2026-10-25, as written, run-all). Open questions resolved with the plan's recommendations:
Q1 names `beyond-horizon-frontier-api` (stacks `-beta` / `-production`), SSM prefix `/beyond-horizon-frontier/<stage>/`;
Q2 non-secret config in SSM as String; Q3 `logRetentionInDays: 14` during the cutover (lower it after S9b); Q4 a new
Atlas DB user for the new stack, the shared legacy password stays untouched (rollback keeps working); Q5 CI runs
`pnpm run package:lambda`; Q6 3 phases as written.

**Branch:** `feat/lambda-handler` (from `main` v0.13.0) · **Date:** 2026-10-25 · **Research:**
[`ai-research/lambda-deploy.research.md`](../ai-research/lambda-deploy.research.md) (S9 as a whole; this plan is S9a only) ·
Memory: [`lambda-deploy-research.md`](../memories/repo/lambda-deploy-research.md) · Pattern references: `src/main.ts`,
`src/configure-app.ts`, `test/create-test-app.ts`, `test/rate-limit.e2e-spec.ts` (per-IP block), CI's "Built app loads
under Node ESM" step, legacy `origin/develop:lambda.ts`.

Owner decisions applied (E9.Q1–Q9; they win over the research where they differ):
- **Q8** split: S9a = handler with a cached bootstrap (`configureApp` + `init()`), `serverless.yml`, offline run with
  parity against `main.ts`, pnpm-aware package without `.env*` / `src` / `test` / `dist/scripts`, owner runbook. S9b
  (secrets in SSM, beta deploy, old-next smoke, prod deploy, Vercel switch, rollback) is the owner's and out of scope.
- **Q1** `trust proxy` stays **off**: the adapter sets `req.ip` from API Gateway's `sourceIp` (research §5.1). Reverts
  the E8a hand-off. A test proves a spoofed `X-Forwarded-For` doesn't move the forgot-password IP bucket.
- **Q2** live legacy stack unknown; the runbook says how to find it (Vercel `NEXT_PUBLIC_BACKEND_URI`) = rollback target.
- **Q3** Node 22 (`nodejs22.x`). **Q4** SSM SecureString resolved at deploy (`${ssm:…}`). **Q5** Atlas `0.0.0.0/0`,
  no VPC. **Q6** osls 3.x. **Q7** REST API (`http` events) `ANY /` + `ANY /{proxy+}`, stages `production` and `beta`.
  **Q9** beta runs `NODE_ENV=production` once the domain is verified in Resend.
- Pins: `@codegenie/serverless-express` **4.17.1** (5.x needs Node ≥ 24), no bundler.

S9a acceptance criteria (CA): **1.** offline serves every route the same as `main.ts`; **2.** a spoofed
`X-Forwarded-For` is ignored; **3.** the package has no `.env*` and loads under Node ESM; **4.** the runbook lists every
owner step (rotate 4 secrets + SSM, Resend + `MAILER_MAIL`, `MONGO_HOST`, CORS origins — today
`https://next-budget-master.vercel.app` —, S8b `--apply` before the prod switch (TTL index), AWS credentials, beta
deploy, smoke, prod deploy, Vercel redeploy, rollback).

HTTP contract: unchanged (legacy `develop` v1.5.5). No route, controller, DTO, guard, filter or response is touched;
`configureApp` stays the only app setup.

Hard limits for the implementer: never create or read `.env`; never read `~/.aws`; never run AWS CLI commands or an
`osls deploy` / `package` that needs credentials or resolves `${ssm:…}`. Tests never touch prod.

## Scope guard

**In:** `src/lambda.ts` (+ unit spec), `test/lambda.e2e-spec.ts`, `serverless.yml`, `deploy/env.aws.yml`,
`deploy/env.local.yml`, `scripts/package-lambda.sh`, `package.json` (deps + 3 scripts), `.gitignore`,
`.github/workflows/ci.yml` (one step), `ai-skills/REPO_CONTEXT.md`, `CLAUDE.md` (commands).

**Out (don't add):** `trust proxy`; any change to `main.ts` / `configureApp` / routes; esbuild or any bundler;
`serverless-jetpack`; HTTP API / Function URL; VPC / NAT; runtime secret fetch (Secrets Manager); a CI deploy job;
API Gateway custom domain; API Gateway throttling settings; Mongo pool sizing for Lambda (S1 N4, undecided); the
Node 24 bump; the helmet CORP fallback (only if the S9b smoke fails); any real deploy, SSM write or AWS call; S9b.

## Design (applies to every phase)

- **Handler** `src/lambda.ts` → `dist/lambda.js`, ESM, next to `main.ts` so `constants.ts`' `../package.json` resolves
  to the zip root. Same bootstrap as `main.ts` minus `listen` / `enableShutdownHooks`: `NestFactory.create(AppModule)`
  → `configureApp(app)` → `await app.init()` → `serverlessExpress({ app: app.getHttpAdapter().getInstance() })`.
  The **promise** of that bootstrap is cached in a module variable (concurrent first invocations share one bootstrap);
  a rejected bootstrap clears the cache so the next invocation retries instead of the container failing forever.
- **`req.ip`:** nothing to configure. The adapter's fake socket gets `requestContext.identity.sourceIp`; with Express's
  default `trust proxy: false`, `X-Forwarded-For` is ignored (research §5.1). A missing `sourceIp` becomes `''`
  (one shared bucket) — only possible in hand-built events.
- **Env per stage, no AWS for `local`:** `provider.environment: ${file(./deploy/${self:custom.envFile.${sls:stage}})}`
  with `custom.envFile: { local: env.local.yml, beta: env.aws.yml, production: env.aws.yml }`. Only the selected file
  is read, so `--stage local` never resolves an `${ssm:…}` and needs no credentials. `env.aws.yml` uses
  `${ssm:/beyond-horizon-frontier/${sls:stage}/<KEY>}` (osls 3 decrypts SecureString itself; a missing parameter fails
  the deploy = fail closed). An unknown stage fails resolution; `provider.stage: ${opt:stage}` has **no default**, so a
  bare `osls deploy` can't hit production by accident.
- **Package = prebuilt artifact** (`package.artifact: .lambda/api.zip`): osls never zips `node_modules` itself, so its
  `npm ls`-based dev-dep exclusion and pnpm's symlinked layout (research §5.2) don't matter. The zip is built by
  `scripts/package-lambda.sh` from a staging dir with a **hoisted production install** of the same lockfile. Zipping uses
  `python3 -m zipfile` (stdlib; `zip` is not installed locally, research machine has python3 3.14; ubuntu-latest has
  both). The script verifies its own output (no `.env*`, no `src/` / `test/` / `dist/scripts/`, Node-ESM import of the
  unzipped `dist/lambda.js` with a dummy env and `env -i`), so CA3 is checked without AWS.
- **Offline:** `serverless-offline` 13.x runs `dist/lambda.handler` from the repo (repo `node_modules`, not the zip) on
  `--stage local`, `NODE_ENV=test`, a local replica set: `assertTestMongoUri` then refuses any non-localhost Mongo, and
  every config key is set in `env.local.yml` so a developer's `.env` (prod) can't decide anything (process env wins over
  `.env`; `MONGO_URI` wins over the `MONGO_*` parts; Resend keys blank).
- **Names** (must differ from legacy `budget-master-api` / `budget-master-test-api`): service
  `beyond-horizon-frontier-api` → stacks `beyond-horizon-frontier-api-beta` / `-production`; SSM prefix
  `/beyond-horizon-frontier/<stage>/` (approved Q1). Legacy values kept: `us-east-1`, function `api`, `timeout: 15`,
  default memory (1024 MB). `logRetentionInDays: 14` (approved Q3, legacy is 1): longer logs for the S9b cutover; the
  runbook lowers it after S9b.

## Phase 1 — handler + adapter, parity and `X-Forwarded-For` tests (CA1, CA2)

### `package.json` — modify (via pnpm, exact pins)
- `pnpm add -E @codegenie/serverless-express@4.17.1` (dependency; CJS, default export = `configure`, ships its own
  `.d.ts` that imports `aws-lambda` types).
- `pnpm add -DE @types/aws-lambda@8.10.164` (2026-09-29, > 2 weeks old).

### `src/lambda.ts` — create (hand-authored; not a Nest module/service/controller)
- `import serverlessExpress from '@codegenie/serverless-express'` (default import: CJS-safe under Node ESM, like `joi`).
  Types: `import type { APIGatewayProxyEvent, Context, Callback, Handler } from 'aws-lambda'`.
- `export async function bootstrap(): Promise<Handler>` — create → `configureApp` → `init` → `serverlessExpress({ app })`.
  No `listen`, no `enableShutdownHooks`.
- `let server: Promise<Handler> | undefined;`
- `export const handler: Handler<APIGatewayProxyEvent> = async (event, context, callback) => { … }`:
  - `if (!event.path) event.path = '/';` — legacy develop's root fix (`ee.on is not a function`, serverless-offline#1832).
  - `server ??= bootstrap().catch((e) => { server = undefined; throw e; });`
  - `return (await server)(event, context, callback);`
- One-line comments only for the why: cached promise, reset on failure, root-path fix, "no trust proxy: `req.ip` is
  `sourceIp`".

### `src/lambda.spec.ts` — create (unit)
`vi.mock` `./app.module.js` (importing the real one runs Joi validation at import), `./configure-app.js`,
`@codegenie/serverless-express` (returns a `vi.fn` proxy) and spy `NestFactory.create` (fake app with `init`,
`getHttpAdapter().getInstance()`). Coverage:
- two invocations → one `create`, one `init`, `configureApp` once, proxy called twice with the same event/context;
- `init` order: `configureApp` before `init`; `listen` never called;
- first bootstrap rejects → that invocation rejects, the next one bootstraps again and succeeds;
- `event.path` `''` and `undefined` → `'/'`; `'/auth'` unchanged.
(Fresh module per test: `vi.resetModules()` + dynamic `import('./lambda.js')`, since the cache is module state.)

### `test/lambda.e2e-spec.ts` — create (e2e, local replica set via the existing harness)
- Two apps on the same e2e DB: `createTestApp()` (the `main.ts` path: same `configureApp` + `init`) driven by supertest,
  and the real exported `handler` driven by hand-built REST v1 events. `vi.spyOn(NestFactory, 'create')` before the first
  `handler` call (calls through) to grab the Lambda app for teardown and to assert **one** `create` over the whole file
  (caching against the real stack). `afterAll`: `app.close()` on the Lambda app, `closeTestApp()` on the harness app
  (drops `budget-master-e2e`).
- Event helper in the spec (no new file): `restEvent({ method, path, headers?, body?, sourceIp? })` → `httpMethod`,
  `path`, `resource: '/{proxy+}'`, `pathParameters: { proxy }` (or `null` for `/`), `headers` + `multiValueHeaders`,
  `multiValueQueryStringParameters: null`, `body` (JSON string or `null`), `isBase64Encoded: false`,
  `requestContext: { stage: 'production', identity: { sourceIp } }` (default `198.51.100.1`). Context `{}` as
  `Context`, no-op callback (adapter's default PROMISE mode).
- Response normalizer: lowercase `multiValueHeaders`; compare against supertest's `status`, parsed body, `content-type`,
  every `access-control-*` header, the set of helmet header names, and `set-cookie` (count + attributes; the JWT value
  differs by `iat`, so compare the cookie minus its value).
- **Parity cases (CA1)** — same request through both, assert equal:
  - `GET /` and the root-bug event `path: ''` → 200 `Hello World!` `text/html`.
  - signup `POST /users` (unique `@example.invalid` email) via supertest, then `POST /auth` through both → 201, same
    envelope; Lambda's first `multiValueHeaders['set-cookie']` is `accessToken=<bare JWT>; … HttpOnly; Secure;
    SameSite=Strict` and it's the only one.
  - with the Lambda login cookie (`Cookie` header) one protected route per controller: `GET /categories`,
    `GET /account-actions`, `GET /budgets`, `GET /budget-history`, `GET /expenses-actions/<id>/Jan/2026`,
    `GET /records/expenses-and-incomes/<id>/Jan/2026`, `PUT /users` with a body, `DELETE /incomes-actions` with
    `{ recordId: <unknown ObjectId> }` (no GET there) → same status/body. Same with `Authorization: Bearer`.
  - no token → 401 envelope; `GET /does-not-exist` → 404 envelope; invalid JSON body on `POST /auth` → 400 envelope.
  - preflight `OPTIONS /auth` with `Origin: http://localhost:4100`, `Access-Control-Request-Method: POST`,
    `Access-Control-Request-Headers: authorization,content-type` → 204, allows `authorization`, origin echoed,
    `access-control-allow-credentials: true`.
  - cleanup in the same phase: `DELETE /users` through the handler with the cookie (cascade) → 200; the DB drop in
    `closeTestApp` removes the rate-limit docs.
- **Spoofed `X-Forwarded-For` (CA2)** — all through `handler`, unknown `@example.invalid` emails (no send):
  10 × `POST /users/forgot-password` with `sourceIp: 198.51.100.7` and `X-Forwarded-For: 203.0.113.<i>` → 201;
  11th with a new `X-Forwarded-For` → 429 envelope; then the same request with `sourceIp: 198.51.100.8` → 201
  (the bucket follows `sourceIp`, not a shared `''` and not the header). Uses its own `sourceIp`s so the parity cases
  and `rate-limit.e2e-spec.ts` (main path, already proves `X-Forwarded-For` is ignored there) don't interfere.

### Success criteria
- `pnpm run build` → `dist/lambda.js` exists; `dist/main.js` unchanged in behavior.
- `pnpm test lambda` (unit) and `pnpm run test:e2e lambda` pass; full `pnpm test` and `pnpm run test:e2e` still pass.

## Phase 2 — `serverless.yml`, pnpm-aware package, offline run (CA3; CA1/CA2 manual)

### `package.json` — modify
- `pnpm add -DE osls@3.78.0 serverless-offline@13.10.1` (osls 3.78.0: 2026-09-06; offline 13.10.1: 2026-06-15 —
  13.10.2 is 6 days old; 13.x is the line for a v3 CLI, peer `serverless ^3.2` warns under osls, accepted).
- Scripts (the existing `deploy: nest deploy` is left alone):
  - `"package:lambda": "bash scripts/package-lambda.sh"`
  - `"offline:lambda": "pnpm run build && osls offline --stage local"`
  - `"deploy:lambda": "bash scripts/package-lambda.sh && osls deploy"` — the owner runs
    `pnpm run deploy:lambda --stage beta` (pnpm appends args to the last command); always ships a fresh zip.

### `serverless.yml` — create (repo root)
- `service: beyond-horizon-frontier-api`, `frameworkVersion: '3'`.
- `provider`: `name: aws`, `runtime: nodejs22.x`, `region: us-east-1`, `stage: ${opt:stage}` (no default),
  `timeout: 15`, `logRetentionInDays: 14` (comment: cutover value, lower after S9b), `environment: ${file(./deploy/${self:custom.envFile.${sls:stage}})}`.
- `custom.envFile` map (Design). `custom.serverless-offline`: nothing beyond defaults (port 3000, URL
  `http://localhost:3000/local/...`).
- `package: { artifact: .lambda/api.zip }`.
- `functions.api`: `handler: dist/lambda.handler`; `events`: `- http: ANY /` and `- http: ANY /{proxy+}`.
- `plugins: [serverless-offline]`.
- Header comment: deploy only via `pnpm run deploy:lambda --stage <beta|production>`; `local` is for offline only.

### `deploy/env.aws.yml` — create
`NODE_ENV: production` literal; every other key `${ssm:/beyond-horizon-frontier/${sls:stage}/<KEY>}`:
`MONGO_CONNECTION`, `MONGO_USER`, `MONGO_PWD`, `MONGO_HOST`, `MONGO_DB_NAME`, `FRONTEND_URI`, `TEST_FRONTEND_URI`,
`DOMAIN_URI`, `JWT_KEY`, `ONE_TIME_JWT_KEY`, `RESEND_API_KEY`, `MAILER_MAIL`. No `MONGO_URI`, no `PORT`. Comment: which
four are SecureString. No values in the repo.

### `deploy/env.local.yml` — create
Every key the schema reads, dummy/local only: `MONGO_URI: mongodb://127.0.0.1:27017/?replicaSet=rs0`,
`MONGO_DB_NAME: budget-master-offline`, the three origins `http://localhost:4100/4101/4102`, `NODE_ENV: test`,
`JWT_KEY` / `ONE_TIME_JWT_KEY` distinct dummies, `RESEND_API_KEY: ''`, `MAILER_MAIL: ''`. Comment: never deployed;
`NODE_ENV=test` arms the localhost-only Mongo guard.

### `scripts/package-lambda.sh` — create (bash, `set -euo pipefail`, run from repo root)
1. Require `pnpm`, `node`, `python3` (`command -v`, clear error).
2. `pnpm run build`.
3. `rm -rf .lambda && mkdir -p .lambda/app`; copy only `dist/`, `package.json`, `pnpm-lock.yaml` into it (never `cp .`
   — that's what keeps `.env`, `src`, `test` out). Remove `.lambda/app/dist/scripts`, and `*.map`, `*.d.ts`,
   `*.tsbuildinfo` under `dist`.
4. In `.lambda/app`: `pnpm install --prod --frozen-lockfile --ignore-scripts --config.node-linker=hoisted`
   (flat `node_modules`, no symlinks into `.pnpm`; no build scripts needed: no native prod deps). Then remove
   `pnpm-lock.yaml`, `node_modules/.bin`, `node_modules/.modules.yaml`, and any `.env*` file shipped inside third-party
   packages (inert, but CA3 says none).
5. `python3 -I -m zipfile -c .lambda/api.zip .lambda/app/dist .lambda/app/node_modules .lambda/app/package.json`
   (top-level arcnames `dist/`, `node_modules/`, `package.json`).
6. Checks on the zip (fail with a message, exit 1):
   - listing (`python3 -I -m zipfile -l`) has no entry matching `(^|/)\.env`, none starting `src/`, `test/`,
     `dist/scripts/`; has `package.json` and `dist/lambda.js`;
   - extract to `.lambda/check` and, from that dir, `env -i PATH="$PATH" <CI's dummy env> node --input-type=module -e
     "const m = await import('./dist/lambda.js'); if (typeof m.handler !== 'function') process.exit(1)"` — proves the
     unzipped package loads under Node ESM with its own `node_modules` and no `.env`, without connecting anywhere.
7. Print the zip size (unzipped size too) and `ok`.
Edge cases: the hoisted install must resolve exactly the lockfile (`--frozen-lockfile`); pnpm 10 (CI) and 11 (local)
both accept `--config.node-linker`; zip timestamps from pnpm's store are ≥ 1980 (python's zipfile refuses older).

### `.gitignore` — modify
Add `/.lambda` and `/.serverless`.

### `.github/workflows/ci.yml` — modify
After `pnpm run build` (job `verify`): `- run: pnpm run package:lambda` (no AWS: builds + checks the zip). The existing
`app.module.js` import step stays.

### Success criteria
- `pnpm run package:lambda` exits 0 and prints `ok`; `.lambda/api.zip` exists (automatic, also in CI).
- Manual, no AWS: `pnpm exec osls print --stage local` resolves the config (env from `env.local.yml`, artifact path,
  two `http` events) with no credentials prompt; `pnpm exec osls print` without `--stage` fails on `opt:stage`. Don't run
  `print` / `package` / `deploy` for `beta` / `production` (they resolve `${ssm:…}`).
- Manual offline (CA1/CA2 on the real plugin): start a local replica set (CI's `docker run -d --name mongo -p
  27017:27017 mongo:8 --replSet rs0 --bind_ip_all` + `rs.initiate` block), `pnpm run offline:lambda`, then `curl -i`
  against `http://localhost:3000/local`: `GET /` (and `/local` with no trailing slash) → `Hello World!`; `POST /users`
  (an `@example.invalid` email) → 201; `POST /auth` → first `Set-Cookie` `accessToken=` bare JWT; `GET /account-actions`
  with that cookie → 200, without → 401 envelope; `GET /nope` → 404 envelope; preflight `OPTIONS /auth` with
  `Origin: http://localhost:4100` + `Access-Control-Request-Headers: authorization` → 204 allowing it; 11 ×
  `POST /users/forgot-password` with varying `X-Forwarded-For` → the 11th is 429 (bucket = offline's `127.0.0.1`
  `sourceIp`). Compare with Phase 1's e2e expectations. Clean up: `DELETE /users` with the cookie → 200, then
  `docker rm -f mongo`.

## Phase 3 — docs + owner runbook (CA4)

### `ai-skills/REPO_CONTEXT.md` — modify
- Overview: add S9a (Lambda handler + deploy config; deploy itself is S9b). Tech stack: `@codegenie/serverless-express`
  4.17.1, osls 3.78.0 + serverless-offline 13.10.1 (dev), Node 22 Lambda runtime.
- Current Structure: `src/lambda.ts` (+ spec), `test/lambda.e2e-spec.ts`, `serverless.yml`, `deploy/env.*.yml`,
  `scripts/package-lambda.sh`, `.lambda/` (gitignored output).
- "Does not exist yet": drop "`trust proxy` (S9)"; state `trust proxy` is **deliberately off** (Q1).
- Operator scripts: `dist/scripts` is excluded from the Lambda zip.
- Notes: replace the "S9 must set trust proxy" bullet with: `req.ip` on Lambda = API Gateway `sourceIp`; never enable
  `trust proxy` (it would make the IP bucket client-controlled); replace the "no deployment config" bullet.
- Branching & Release: CI's `verify` also runs `pnpm run package:lambda`.
- New section **AWS Lambda** (what exists: handler, stages `local` / `beta` / `production`, env files, SSM prefix,
  package script and its checks, offline command, why no bundler and why the artifact) and **Owner runbook (S9b)**,
  numbered, each step with the command or console place:
  0. Find the live legacy stack: Vercel project → env `NEXT_PUBLIC_BACKEND_URI` (`7xrrj66eka` = `budget-master-api`,
     `t4ry6x0fc2` = `budget-master-test-api`). Write it down: it is the rollback target. Don't touch either stack.
  1. Secrets (Critical H1): new `JWT_KEY`, `ONE_TIME_JWT_KEY` (e.g. `openssl rand -base64 48`), a new Resend API key,
     and a **new least-privilege Atlas DB user** for the new stack (its user/password go to SSM). Do **not** rotate
     or change the shared legacy user's password: the legacy stacks keep using it, so the rollback in step 10 keeps
     working. Atlas network access `0.0.0.0/0` (Q5). Rotating `JWT_KEY` logs every user out once.
  2. Resend: verify the `beyond-horizon-frontier` domain, pick `MAILER_MAIL` on it (Q9: needed before beta, which runs
     `NODE_ENV=production`).
  3. SSM per stage (`beta`, `production`) under `/beyond-horizon-frontier/<stage>/`: the four secrets as
     **SecureString**, the rest as String: `MONGO_CONNECTION` (`mongodb+srv`), `MONGO_USER`, `MONGO_HOST` (full Atlas
     host), `MONGO_DB_NAME`, `FRONTEND_URI` (today `https://next-budget-master.vercel.app`), `TEST_FRONTEND_URI`
     (beta: `http://localhost:3000` for the local old-next smoke), `DOMAIN_URI` (the new domain's origin), exact
     origins, no trailing slash. Enter secret values without leaving them in shell history.
  4. AWS credentials for the deploy (an IAM user/profile allowed to deploy CloudFormation / Lambda / API Gateway / S3 /
     Logs and read those SSM parameters), exported as `AWS_PROFILE`.
  5. Before the prod switch: S8b — Atlas snapshot, `node dist/scripts/db-indexes.cli.js` then `--apply --db=<name>`
     (creates the `ratelimits` TTL index; without it the collection grows forever), data-repair report / `--apply`.
  6. Beta: `pnpm run deploy:lambda --stage beta`; note the printed URL (`…/beta`).
  7. Smoke (beta shares the prod DB, D16): old-next run locally with `NEXT_PUBLIC_BACKEND_URI=<beta URL>`: login,
     accounts, records, transfer, budgets, forgot-password to an `.invalid` address; then `DELETE /users` for the smoke
     user (cascades). If the browser blocks responses on CORP, apply the agreed helmet fallback in a PR. Any other
     failure → fix in a PR before step 8.
  8. Production: `pnpm run deploy:lambda --stage production`; URL `https://<id>.execute-api.us-east-1.amazonaws.com/production`.
  9. Switch: Vercel `NEXT_PUBLIC_BACKEND_URI` = the new prod URL, **redeploy** (it's inlined at build), verify login +
     one read + one write on the Vercel URL. (Vercel's own `GET /` 500 is old-next's, not the backend.)
  10. Rollback: Vercel env back to the step-0 URL + redeploy; legacy stacks and their Atlas user were never touched.
     Keep the old Resend key and the legacy Atlas user until the switch is verified.
  11. After verification: lower `logRetentionInDays` from 14 (cutover value) in `serverless.yml` via a PR and redeploy;
     revoke the old Resend key; remove the legacy Atlas user only when the legacy stacks are decommissioned (later).

### `CLAUDE.md` — modify
Commands block: add `pnpm run package:lambda` (build + zip + checks, no AWS) and `pnpm run offline:lambda` (local Mongo
only); one line that deploys are the owner's (`deploy:lambda`, see REPO_CONTEXT runbook).

### Success criteria
- Manual inspection: each CA4 item appears as a runbook step with its command or console location; every command named
  in the docs exists (`package:lambda`, `offline:lambda`, `deploy:lambda`, the S8b scripts).

## Test coverage areas

- Unit: bootstrap caching, retry after a failed bootstrap, root-path rewrite, no `listen`.
- E2E: Lambda vs `main.ts`-path parity on one route per controller plus `/`, auth cookie / Bearer, 401 / 404 / 400
  envelopes, CORS preflight, helmet headers; forgot-password IP bucket keyed on `sourceIp` with spoofed
  `X-Forwarded-For`; one Nest bootstrap across all invocations.
- Package: zip contents and Node-ESM load of the unzipped package (script self-check, CI).
- Manual: offline run on the real plugin; `osls print --stage local` without credentials.

## AC Coverage Summary

| CA | Phase(s) | Automatic / manual | Coverage |
|---|---|---|---|
| 1 — offline serves every route like `main.ts` | 1, 2 | automatic (e2e: real handler vs harness, one route per controller + `/`, errors, CORS, cookies) + manual (offline curl list) | full: "every route" is one route per controller plus the single `ANY /{proxy+}` catch-all into the same Express app; not every route individually |
| 2 — spoofed `X-Forwarded-For` ignored | 1, 2 | automatic (e2e via handler, `sourceIp`-keyed bucket) + manual (offline) | full |
| 3 — package has no `.env*`, loads under Node ESM | 2 | automatic (`pnpm run package:lambda` self-checks, also in CI) | full |
| 4 — runbook lists every owner step | 3 | manual (inspection) | full (execution is S9b) |

## Decisions (beyond the research)

- Prebuilt zip via `package.artifact` + our script (hoisted prod install in a staging dir, `python3 -m zipfile`)
  instead of osls packaging; osls never runs `npm ls` on the pnpm tree.
- `local` stage selected by a `custom.envFile` map, so offline / `print` never resolve SSM; `provider.stage` has no
  default; unknown stages fail.
- `NODE_ENV=test` for offline to reuse the localhost-only Mongo guard.
- All config per stage in SSM (secrets SecureString, the rest String) except `NODE_ENV`.
- Names: service `beyond-horizon-frontier-api`, SSM prefix `/beyond-horizon-frontier/<stage>/`.
- Bootstrap promise cached and cleared on rejection; legacy's empty-path rewrite kept.
- Package also drops `*.map`, `*.d.ts`, `node_modules/.bin`; third-party `.env*` files are deleted.
- CI runs `pnpm run package:lambda`.
- New scripts `package:lambda`, `offline:lambda`, `deploy:lambda`; `deploy` (`nest deploy`) left as is.
- New Atlas DB user for the new stack, shared legacy password untouched, so rollback to legacy keeps working (approved Q4).
- `logRetentionInDays: 14` instead of legacy 1 during the cutover, lowered after S9b (approved Q3).

## Assumptions

- `serverless-offline@13.10.1` loads under osls 3.78 (peer is `serverless ^3.2`; it uses the CLI instance it's given,
  no `serverless/lib` imports found in its source) and imports an ESM handler (it loads handlers with `import()`). If it
  doesn't, CA1/CA2 still hold through the e2e; the offline step becomes the gap to report.
- osls 3 resolves `${file(./deploy/${self:custom.envFile.${sls:stage}})}` lazily (only the chosen file) and `print`
  needs no credentials for `local`. Verified in Phase 2's manual step, not before.
- pnpm `install --prod --config.node-linker=hoisted` in a dir with only `package.json` + lockfile reproduces the prod
  tree (~110 MB unzipped, under the 250 MB limit).
- The adapter detects the hand-built event as API Gateway v1 (`httpMethod` + `requestContext`, no `elb`/`version: '2.0'`).
- Legacy values (`us-east-1`, `timeout: 15`, default memory) are fine for S9b.

## Open questions — resolved (owner, 2026-10-25)

1. **Names:** service `beyond-horizon-frontier-api`, stacks `-beta` / `-production`, SSM prefix
   `/beyond-horizon-frontier/<stage>/` — approved.
2. **Non-secret config** (cluster host, CORS origins, …) in SSM as plain String — approved.
3. **`logRetentionInDays: 14`** during the cutover (legacy 1); the runbook lowers it after S9b — approved.
4. **Mongo credentials:** a new least-privilege Atlas DB user for the new stack; the shared legacy password stays
   untouched so the legacy rollback keeps working — approved, runbook step 1 says so.
5. **CI step** `pnpm run package:lambda` — approved.
6. **Plan:** approved as written (3 phases), run-all.

## Implementation checklist

- [x] Phase 1 — handler + unit + e2e (parity, `X-Forwarded-For`)
- [x] Phase 2 — `serverless.yml`, env files, package script, scripts, `.gitignore`, CI step
- [x] Phase 2 manual — `osls print --stage local` (ok; without `--stage` fails on `opt`), offline curl list (Mongo via
  `MongoMemoryReplSet` on 127.0.0.1:27017, no docker). Offline-only gaps: login → 500 `Invalid cookie value` (hapi in
  serverless-offline 13.10.1), `OPTIONS` answered by offline (200) not the app; covered by the e2e. See
  `memories/repo/lambda-handler-followup.md`.
- [x] Phase 3 — `REPO_CONTEXT.md` (AWS Lambda + runbook), `CLAUDE.md`
