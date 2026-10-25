# Repository Context - be-beyond-horizon-frontier

**Last Updated:** 2026-10-25

Architecture and conventions for the be-beyond-horizon-frontier NestJS backend.

> Sections marked _(planned)_ describe intended conventions, not existing code. Update this document as modules land.

## Overview

Backend for Budget Master. Today it is the unmodified `nest new` starter: one controller returning `Hello World!`.

_(planned)_ It is the rewrite of the legacy backend `be-budgt-master` (sibling checkout `../be-budgt-master`) (MongoDB/mongoose, JWT cookie auth, AWS Lambda). The existing frontend's HTTP contract must keep working — no breaking API changes. The plan and progress live outside this repo, in `~/projects/notes/budget-master/be-refactor.md` (local notes, not in this repo).

**Tech Stack:**

- NestJS 12 (`@nestjs/core` 12.2), Express platform (`@nestjs/platform-express`)
- TypeScript 6, ESM (`"type": "module"`, `module`/`moduleResolution: nodenext`, `strict: true`)
- pnpm (`pnpm-lock.yaml`; CI pins pnpm 10, Node 22)
- Vitest 4 (unit + e2e), supertest for e2e
- oxlint (lint), Prettier (format)

## Current Structure

```
src/
├── main.ts                 # bootstrap; top-level await; listens on process.env.PORT ?? 3000
├── app.module.ts           # root module: AppController + AppService, no imports
├── app.controller.ts       # GET /
├── app.controller.spec.ts
└── app.service.ts
test/
└── app.e2e-spec.ts
vitest.config.ts            # unit: **/*.spec.ts
vitest.config.e2e.ts        # e2e: **/*.e2e-spec.ts
oxlint.json                 # no-explicit-any off, no-floating-promises warn
```

Does **not** exist yet — don't assume it: feature modules, `ConfigModule` / `.env` / env validation, database, auth, guards, pipes, interceptors, exception filters, OpenAPI docs, CORS, cookie parsing, path aliases (`tsconfig.json` has no `paths`). No global pipes/filters/guards are registered in `main.ts`.

## Controllers and API Routes

| Controller      | Route   | Guards | Purpose                               |
| --------------- | ------- | ------ | ------------------------------------- |
| `AppController` | `GET /` | none   | Starter route, returns `Hello World!` |

## Testing Structure

- **Unit tests:** `*.spec.ts` co-located with source — `pnpm test` (`vitest run`, config `vitest.config.ts`)
- **E2E tests:** `test/*.e2e-spec.ts` — `pnpm run test:e2e` (config `vitest.config.e2e.ts`)
- **Coverage:** `pnpm run test:cov` → `coverage/` (`@vitest/coverage-v8`)
- Both configs use `globals: true` and `vite-tsconfig-paths`.

## Branching & Release

- PRs target `main` (no `develop`). Feature branches are named `feat/<topic>`.
- `check-label.yml`: every PR needs a `major`, `minor` or `patch` label.
- `ci.yml`: on PRs to and pushes to `main` — `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run build`, `pnpm test`. E2E is not run in CI.
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

- No environment example file; the only env var read is `PORT`.
- `package.json` has a `deploy` script (`nest deploy`, with `@nestjs/mau` installed), but there is no deployment config or deploy workflow in the repo. _(planned)_ deployment target is not decided here; check the external plan.
- `dist/` and `*.tsbuildinfo` are build output (gitignored).
