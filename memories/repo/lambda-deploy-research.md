# S9 lambda-deploy — research notes

- `@codegenie/serverless-express` sets the fake socket's `remoteAddress` to API Gateway's `sourceIp`, so `req.ip` is the client IP with Express's default `trust proxy: false`. Enabling `trust proxy` makes `req.ip` come from the client-controllable `X-Forwarded-For`.
- `@codegenie/serverless-express@5` needs Node ≥ 24; on Node 22 use 4.x. Its CJS default export is `configure`.
- serverless v3 packages `.env` into the zip unless `useDotenv` is set (legacy did this, D5). The new `ConfigModule` would also read `/var/task/.env`: exclude `.env*` explicitly.
- serverless v3/osls exclude dev deps via `npm ls`: unreliable with pnpm's symlinked `node_modules`; legacy deployed with bun (hoisted).
- `src/constants.ts` reads `../package.json` from `import.meta.url`: keep `dist/` unbundled with `package.json` at the zip root.
- serverless v3 (3.40.0) runtime enum stops at `nodejs20.x`; osls 3.x knows `nodejs22.x`/`24.x`. Node 22 Lambda deprecation: 2027-04-30.
- old-next's Vercel `GET /` 500 never calls the backend (only its session cookie).
