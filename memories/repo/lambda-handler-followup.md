# lambda-handler (S9a) follow-ups (2026-10-25)

- serverless-offline 13.10.1: `POST /auth` → 500 `Invalid cookie value` (offline hands the whole `Set-Cookie`, attributes
  included, to hapi's `h.state`; `disableCookieValidation` only affects request cookies). Offline-only, API Gateway is
  not affected; e2e proves the handler's cookie. Retry with 13.10.2 once it is > 2 weeks old (released 2026-10-19).
- serverless-offline answers `OPTIONS` itself (200 + its own CORS headers), so offline can't show the app's 204
  preflight. Real REST `ANY` passes OPTIONS to the Lambda (e2e covers the handler's 204).
- `pnpm add serverless-offline` auto-installed its peer `serverless@3.40.0` (dev only; `node_modules/.bin/serverless`
  is that one, scripts use `osls`). Optionally block it (pnpm `peerDependencyRules` / `auto-install-peers=false`).
- Adding osls made pnpm resolve mongodb's optional peer `@aws-sdk/credential-providers`, so the prod zip now carries
  `@aws-sdk` + `@smithy` (~14 MB unzipped, inert unless MONGODB-AWS auth). Size is fine (133 MB < 250 MB).
- `pnpm exec` ran osls on Node 26 locally (pnpm 11 runtime), not the shell's Node 22; CI uses Node 22.
