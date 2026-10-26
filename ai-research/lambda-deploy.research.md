# Research: S9 — lambda-deploy

**Branch:** `feat/lambda-deploy` (from `main` v0.13.0) · **Date:** 2026-10-25 · **Type:** epic-sized story, full research

Sources: `~/projects/notes/budget-master/be-refactor.md` (S9, D5, D14–D16, D18, E1.F1, E3.M1–M6, E8.Q5/Q6, E8a/E8b
gates, Security findings), `general-notes.md` (backend URLs, deploy notes), `Backend.md`, `be-refactor-next-clients.md`,
`be-refactor-security-audit.md` H1; legacy `be-budgt-master` `main` + `origin/develop` (`serverless.yml`, `lambda.ts`,
`package.json`); legacy `node_modules/@codegenie/serverless-express@4.16.0` source; old-next clone (`main` 2e02a8f);
npm registry (`pnpm view`, tarballs of `serverless@3.40.0`, `osls@3.78.0`, `osls@4.4.0`). Nothing installed, nothing
deployed, no AWS/serverless command run, no `.env` read.

## 1. Story

Run the new backend on AWS Lambda behind API Gateway with the same routes as the legacy deploy, prove it locally,
deploy a beta stage, smoke-test it with old-next, then switch prod. The legacy backend stays deployable until prod is
switched and verified.

## 2. Proposed split (owner decides)

Code and ops are separable, and every deploy step is the owner's (agent has no AWS access).

| Story | Content | Order |
|---|---|---|
| **S9a — lambda-handler** | handler + cached bootstrap, `serverless.yml`, offline run, packaging, `req.ip` decision, secret refs in config, owner runbook in `REPO_CONTEXT.md` | 1st, a normal PR |
| **S9b — lambda-cutover** | owner: secrets in the store, deploy `beta`, old-next smoke, deploy `production`, Vercel switch, verify; any fix found during smoke | 2nd; may end with no code (docs/tracker only) |

ACs:
- **S9a:** 1. The ESM handler bootstraps once per container through `configureApp` + `init()` (no `listen`) and
  reuses it on later invocations. 2. A local offline run (serverless-offline, local Mongo, never prod) serves `ANY /`
  and `ANY /{proxy+}` like `main.ts` for a sample: `GET /` `Hello World!`, `POST /auth/` (first `Set-Cookie` bare JWT),
  a 401 and a 404 envelope, a CORS preflight 204 that allows `Authorization`. 3. In Lambda, `req.ip` is API Gateway's
  `sourceIp`, and a client-sent `X-Forwarded-For` doesn't move the forgot-password IP bucket. 4. The package has only
  `dist/` (without `dist/scripts`, specs, maps if dropped), production `node_modules`, `package.json`; no `.env*`,
  `src/`, `test/`. 5. Secrets come from a secret store per stage, not from a `.env` on the deploy machine or in the zip.
- **S9b:** 1. `beta` deployed; old-next smoke (login, accounts, records, transfer, budgets, forgot-password to an
  `.invalid` address) passes, created data cleaned up. 2. `production` deployed, old-next switched, verified; rollback
  path written down. 3. Legacy stacks untouched until 2.

## 3. Legacy deploy (what "same" means)

- `serverless.yml` (main and develop identical except names/runtime): `provider.stage: production`, `region: us-east-1`,
  `timeout: 15`, `logRetentionInDays: 1`, function `api`, `handler: dist/lambda.handler`, events `http` (= **REST API
  v1**) `ANY /` and `ANY {proxy+}`, plugins `serverless-jetpack`, `serverless-offline`. No `environment:` block, no
  `useDotenv`, no `package:` patterns.
  - main: service/stack/api `budget-master-api`, `frameworkVersion: '3'`, `nodejs18.x`.
  - develop (4bf9de6, 2025-06-10): `budget-master-test-api`, `nodejs22.x`, no `frameworkVersion`.
- Two live URLs (`general-notes.md:133-134`): prod `https://7xrrj66eka.execute-api.us-east-1.amazonaws.com/production`,
  test `https://t4ry6x0fc2.execute-api.us-east-1.amazonaws.com/production` ("do not hit root, it will break").
  REST URLs carry the stage as a path prefix; Express sees paths without it.
- Handler (`main:src/lambda.ts`, `develop:lambda.ts`): `@codegenie/serverless-express` `configure({ app: expressApp })`
  after `app.init()`, cached in a module variable; develop also rewrites an empty `event.path` to `/` (the root bug,
  `Backend.md`: `ee.on is not a function`, serverless-offline#1832).
- Deploy: `"deploy": "bun run build && sls deploy"` from the owner's old machine; a global `sls`, version unknown.
  `general-notes.md:251-253`: "only works with node v16.20.2 … serverless 4 gives internal error" (historical).
- **D5, how env reached Lambda (inference, owner to confirm):** with no `environment:` and no `useDotenv`, serverless v3
  does **not** exclude `.env` from the zip (`serverless@3.40.0` `package-service.js:59`: `.env*` is excluded only when
  `useDotenv` is set), and legacy reads it at runtime (`app.module.ts` `envFilePath: '.env'`, `dotenv.config()` in
  `main.ts`/`public.decorator.ts`). So the secrets most likely shipped **inside the zip**. If the Lambda console shows
  no env vars on the function, that's confirmed.
- Express 5 already runs on Lambda in prod: legacy main is Nest 11 / `@nestjs/platform-express` 11 with
  `@codegenie/serverless-express` 4.16.

## 4. New repo today

- `src/main.ts`: `NestFactory.create` → `configureApp` → `enableShutdownHooks` → `listen`. `src/configure-app.ts` says
  "Never calls listen/init (Lambda uses init)". No `lambda.ts`, no `serverless.yml`, no AWS deps. `package.json`
  `deploy` = `nest deploy` (`@nestjs/mau`, unrelated to AWS; REPO_CONTEXT notes it).
- ESM: `"type": "module"`, `nodenext`, relative imports end in `.js`. `nest build` (tsc) → `dist/` mirroring `src/`
  (`dist/main.js`, `dist/scripts/*.js`, 88 KB). CI Node 22; local Node 22.16, pnpm 11.28.
- `src/constants.ts` reads `../package.json` via `import.meta.url` at import time: the handler must sit so that
  `package.json` is one level up from `dist/constants.js`, i.e. the zip must keep `package.json` at the root and
  `dist/` unbundled (a single-file bundle elsewhere breaks this).
- Config: `ConfigModule.forRoot({ envFilePath: '.env', … })`; real env vars win over the file. Joi `envSchema`
  (`src/config.ts`): Mongo (`MONGO_URI` or `MONGO_CONNECTION`/`MONGO_USER`/`MONGO_PWD`/**`MONGO_HOST`**),
  `MONGO_DB_NAME`, `FRONTEND_URI`, `TEST_FRONTEND_URI`, `DOMAIN_URI` (exact origins, no trailing slash), `NODE_ENV`,
  `JWT_KEY`, `ONE_TIME_JWT_KEY`, `RESEND_API_KEY` + `MAILER_MAIL` (required non-empty when `NODE_ENV=production`).
  A missing key fails the cold start (`Config validation error`).
- Mongo: `serverSelectionTimeoutMS: 5000`, `retryAttempts` 2, `retryDelay` 1000, default pool size (S1 review N4
  flagged pool sizing for Lambda, never decided). `autoIndex` off outside test.
- Forgot-password IP bucket: `user.controller.ts:44` passes `req.ip`. REPO_CONTEXT says S9 must set `trust proxy`.
- Prod deps (`pnpm list --prod`): 201 packages, ~110 MB unzipped (largest: es-toolkit, rxjs, libphonenumber-js,
  prettier and prismjs via `@react-email/components`, react-dom). Full `node_modules` (with dev) 240 MB. pnpm uses the
  isolated symlinked layout (no `.npmrc`).

## 5. Findings that change the plan

1. **`trust proxy` is not needed and would weaken the limit.** `@codegenie/serverless-express` builds the request with
   `remoteAddress = requestContext.identity.sourceIp` (REST, `event-sources/utils.js:47`) or
   `requestContext.http.sourceIp` (HTTP API, `api-gateway-v2.js:43`), so Express's `req.ip` with the default
   `trust proxy: false` is already the client IP API Gateway saw. Turning `trust proxy` on makes `req.ip` come from
   `X-Forwarded-For`, which the client can pre-fill (API Gateway appends to it; an edge-optimized REST endpoint also
   appends a CloudFront hop). Forgot-password is called from the browser (old-next `LoginCard.utils.ts:17-22`), so
   `sourceIp` is the user's IP. Login is called from old-next's Vercel server (`src/app/api/route.ts`) and is limited
   per email only (E8.Q6), so it is unaffected. This contradicts the E8a hand-off wording: owner question Q1.
2. **pnpm vs serverless packaging.** serverless v3/osls 3 exclude dev deps by parsing `npm ls` output
   (`zip-service.js:22`) and zip `node_modules` by glob; with pnpm's `.pnpm` store + symlinks that is unreliable (dev
   deps in `.pnpm`, symlinks). Legacy avoided it with bun (hoisted). The plan needs a pnpm-aware step (e.g. a hoisted
   production install in a staging dir, or `node-linker=hoisted`, or bundling) and an AC that inspects the zip.
3. **Bundling with esbuild is higher risk than shipping `dist/` + prod `node_modules`:** Nest's optional
   `require`s (microservices/websockets), CJS deps inside an ESM bundle, the `../package.json` read (§4), and react-email.
   Size (~110 MB unzipped, limit 250 MB; deployed through S3) and cold start don't force bundling.
4. **`.env` must never be packaged** (§3 D5 inference): the new config would still read `/var/task/.env` if present.
   Explicit package excludes (`.env*`, `src/`, `test/`, `dist/scripts/`, `coverage/`, `ai-*`, `memories/`) are needed.
5. **`@codegenie/serverless-express@5.0.0` requires Node ≥ 24** (`engines`). With Node 22 the line is 4.x
   (`4.17.1`, 2025-12-07, Node ≥ 18). Its CJS default export is `configure` (`index.js`: `module.exports = configure`),
   so an ESM default import works (CI's Node-ESM import check pattern applies).
6. **Node 22 on Lambda is deprecated on 2027-04-30** (AWS runtime schedule as I know it, not re-checked here; ~6 months from today). `nodejs24.x` exists.
   Owner question Q3.
7. **Atlas IP access list vs Lambda.** A non-VPC Lambda has no fixed egress IP, so Atlas must allow `0.0.0.0/0`, which
   conflicts with the Critical finding's "restrict the Atlas IP access list". Fixed egress needs VPC + NAT gateway
   (~US$32/month+) or Atlas PrivateLink (paid tier). Owner question Q5.
8. **Vercel `GET /` 500 is not the backend.** old-next's `/` (`src/app/page.tsx`) only decodes its own `session`
   cookie with `SESSION_SECRET_KEY` (`auth.lib.ts:30-45`) and never calls the backend; the 500 is a Vercel-side
   problem (env/SSR), outside S9. It does block a smoke through the Vercel prod URL, so the beta smoke should use old-next
   run locally (or a Vercel preview) with its origin in `TEST_FRONTEND_URI`.
9. **Switching = Vercel env + rebuild.** old-next reads `NEXT_PUBLIC_BACKEND_URI` (inlined at build) in ~20 places,
   from the browser and from its `/api` routes, and appends paths (`/auth/`, `/account-actions/`, …). A new API URL
   (or a custom domain) needs the Vercel env changed **and a redeploy**; rollback is the same in reverse. Which legacy
   URL Vercel uses today is unknown (Q2).
10. **S8b dependency:** the `ratelimits` TTL index and the other prod indexes exist only after the owner runs
    `node dist/scripts/db-indexes.cli.js --apply`. Without the TTL index, `ratelimits` grows unbounded in prod. Do it
    before the prod switch.

## 6. Options (recommendation in bold)

| Area | Options | Notes |
|---|---|---|
| Deploy CLI | serverless v3 (`3.40.0`, last release 2024-12-17, frozen; runtime enum stops at `nodejs20.x`, so `nodejs22.x` only passes as a validation warning) · serverless v4 (`4.45.0`, needs a Serverless account/login + license, free under US$2M revenue; owner saw "internal error") · **osls 3.x** (`3.78.0`, MIT, Bref-maintained v3 fork, no login, knows `nodejs22.x`/`24.x`, same `serverless.yml`) · osls 4.x (`4.4.0`, documented v4 breaking changes) · SAM / CDK (new toolchain + new template, most change) | osls 3 = legacy config with the least change |
| Adapter | **`@codegenie/serverless-express@4.17.1`** (same as legacy, Express 5 proven in prod) · `@vendia/serverless-express` (old name, last 2023) · `serverless-http@4.0.0` · `@h4ad/serverless-adapter` (last 2024, heavy peer list) | |
| Endpoint | **REST API (`http` events)**: same as legacy, same `/production` stage-prefixed URL shape, payload v1 with `multiValueHeaders` (first `Set-Cookie` kept), API Gateway throttling available as the E8.Q5 backstop · HTTP API: cheaper, payload v2 (`cookies[]`), URL without stage prefix · Function URL: no throttling/stages, different event | |
| Packaging | **`dist/` + hoisted prod `node_modules` + `package.json`** (§5.2) · esbuild bundle (§5.3) · `serverless-jetpack` (legacy; `0.12.0`, trace mode, pnpm support unverified) | |
| Offline | `serverless-offline` `13.x` (peer `serverless ^3.2`) vs `14.x` (peer `^4`); legacy ran 14.4 on v3. ESM handler support and the root-path bug (§3) must be checked in the plan. Latest 13.10.2/14.8.4 are 6 days old: pin an older patch (≥ 2 weeks) |
| Secrets | **SSM Parameter Store SecureString, resolved at deploy (`${ssm:…}`) into Lambda env vars**: no code change, free tier, but values are visible in the Lambda console to IAM users · Secrets Manager / Parameter Store fetched at cold start: values not in Lambda config, but new code, IAM policy, cost (~US$0.40/secret/month for Secrets Manager), slower cold start | Q4 |
| Switch | **new API URL per stage + Vercel env change + redeploy** · API Gateway custom domain on `beyond-horizon-frontier` with base-path mapping flipped between stacks (ACM cert, DNS; owner) | custom domain can come later |

Bundle/cold start: ~110 MB unzipped deps is fine for the 250 MB limit; cold start is dominated by Nest init + the
Atlas connection (5 s server-selection budget), well within API Gateway's 29 s and legacy's 15 s Lambda timeout.
Memory size: legacy uses the default (1024 MB in serverless v3); more memory = more CPU = faster cold start.

## 7. Integration points and constraints

- Stage/stack names must differ from `budget-master-api` and `budget-master-test-api` so legacy stays deployable
  (S9 AC3). Stages `beta` and `production`; both point at the **same prod DB** (D16, only one DB), so the beta smoke
  creates real data and must clean up (`.invalid` emails, delete by id).
- JWT: same `{sub}` HS256 payload. Sharing `JWT_KEY` with legacy keeps sessions across the switch; rotating it (Critical
  finding) logs everyone out once (old-next gets 401 and re-logs). Rotating `MONGO_PWD` breaks legacy unless it's
  redeployed with the new value: the rotation and the switch should be sequenced.
- CORS: exact origins from the three `*_URI` keys. With `budget-master.space` suspended, old-next's live origin is
  `https://next-budget-master.vercel.app`; the new `beyond-horizon-frontier` domain and a local old-next
  (`http://localhost:3000`) for the smoke must be among the three values. Login goes server-to-server (no CORS).
- Mail: `NODE_ENV=production` requires non-empty `RESEND_API_KEY` + `MAILER_MAIL`; the address must be on the new
  domain once verified in Resend (E3 ops). Until then a beta could run `NODE_ENV=production` only with a sender that
  Resend accepts.
- `enableShutdownHooks` is irrelevant on Lambda; `configureApp` is shared and must stay the only app setup.
- Helmet defaults (CORP `same-origin`) are unverified against old-next in a real browser: the E8a fallback
  (`crossOriginResourcePolicy: 'cross-origin'`) is the agreed fix if the smoke fails.
- `logRetentionInDays: 1` in legacy makes post-incident debugging hard; value is the owner's call.

## 8. Owner-only steps (agent can't do them)

1. Rotate `MONGO_PWD`, `JWT_KEY`, `ONE_TIME_JWT_KEY`, `RESEND_API_KEY` (Critical H1) and store them per stage in the
   chosen secret store; decide the Atlas IP access list (Q5).
2. Verify `beyond-horizon-frontier` in Resend, choose `MAILER_MAIL`; set `MONGO_HOST` and the three CORS origins.
3. Run S8b: Atlas snapshot → `db-indexes --apply` → data-repair report/`--apply` (before the prod switch).
4. AWS credentials/IAM; `package`/`deploy --stage beta`; smoke with old-next (local or Vercel preview); cleanup.
5. `deploy --stage production`; set Vercel `NEXT_PUBLIC_BACKEND_URI`, redeploy, verify; rollback = previous URL +
   redeploy. Investigate the Vercel `GET /` 500 (old-next, not backend).
6. Optional: API Gateway custom domain + DNS on the new domain. Later: decommission the legacy stacks.

Note: `serverless package` resolves `${ssm:…}` variables, so it also needs AWS credentials. The agent can only test
packaging/offline with a stage or flag that doesn't resolve remote variables.

## 9. Open questions (with recommendation)

- **Q1 `trust proxy`:** the E8a hand-off asks for it, but §5.1 shows `req.ip` is already `sourceIp`. *Rec:* leave
  `trust proxy` off; S9a adds a test that a spoofed `X-Forwarded-For` doesn't change `req.ip` in the Lambda path, and
  REPO_CONTEXT drops the "must set trust proxy" note.
- **Q2 Which legacy stack serves old-next today** (`7xrrj66eka` = `budget-master-api` or `t4ry6x0fc2` =
  `budget-master-test-api`)? Prod has develop's account contract, so possibly the test stack. *Rec:* owner reads it from
  Vercel's `NEXT_PUBLIC_BACKEND_URI`; that URL is the rollback target.
- **Q3 Node 22 vs 24:** *Rec:* Node 22 now (tracker, CI, local all 22; adapter 4.17.1), and a follow-up bump to
  `nodejs24.x` before 2027-04-30.
- **Q4 Secret store:** *Rec:* SSM Parameter Store SecureString, resolved at deploy time; runtime fetch only if the
  owner wants secrets out of the Lambda console.
- **Q5 Atlas network access:** *Rec:* keep `0.0.0.0/0` with the rotated, least-privilege DB user for now (VPC/NAT
  costs more than the app); revisit if the budget allows.
- **Q6 Deploy CLI:** *Rec:* osls 3.x (drop-in for the legacy `serverless.yml`, no login, maintained). v4 only if the
  owner wants the Serverless account.
- **Q7 Endpoint type:** *Rec:* REST API like legacy (same URL shape, throttling backstop); HTTP API only if cost matters.
- **Q8 Split:** *Rec:* S9a (code) → S9b (owner cutover), as in §2.
- **Q9 Beta `NODE_ENV`:** `production` requires working Resend values. *Rec:* `production` on both stages once the
  domain is verified; until then beta without forgot-password delivery is acceptable for the smoke.

## 10. Assumptions

- Region `us-east-1` and one Lambda function `api`, same as legacy.
- The beta and prod stages share the prod DB (D16); no separate test DB.
- old-next stays unchanged except its Vercel env value.
- The owner deploys from his machine (no CI deploy job in S9); a deploy workflow is out of scope unless asked.
- Package versions as of 2026-10-25 (`pnpm view`); the plan pins versions ≥ 2 weeks old.
