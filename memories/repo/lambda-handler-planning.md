# lambda-handler (S9a) planning notes (2026-10-25, approved)

- Package is a prebuilt zip (`package.artifact: .lambda/api.zip`) from `scripts/package-lambda.sh`: staging dir with only
  `dist/` + `package.json` + lockfile, `pnpm install --prod --config.node-linker=hoisted`, zipped with
  `python3 -m zipfile` (`zip` isn't installed locally). osls never packages the pnpm tree itself.
- Env per stage via `${file(./deploy/${self:custom.envFile.${sls:stage}})}`: `local` → `env.local.yml` (no SSM, no AWS),
  `beta`/`production` → `env.aws.yml` (`${ssm:/beyond-horizon-frontier/${sls:stage}/KEY}`). `provider.stage` has no default.
- Offline uses `NODE_ENV=test` so `assertTestMongoUri` blocks any non-localhost Mongo; every key is set so `.env` can't leak in.
- `trust proxy` stays off (Q1): the adapter puts API Gateway `sourceIp` on the socket, so `req.ip` is already the client.
- E2E grabs the handler's Nest app with `vi.spyOn(NestFactory, 'create')` (calls through) for teardown and the one-bootstrap assert.
- Approved: logRetentionInDays 14 for the cutover (lower after S9b); new Atlas user for the new stack, legacy password untouched for rollback.
